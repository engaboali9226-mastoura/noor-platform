-- R386 G1 disposable managed fixture candidate. DO NOT run on production/R219.
-- Requires the exact Work f4369fe fixture marker in its open install transaction.
-- Assumes default synthetic provider session-control settings; non-default timeout
-- and single-session policies must be independently inventoried before rollout.
DO $$ BEGIN
  IF to_regclass('pg_temp.noor_r386_g1_managed_install') IS NULL
    OR to_regclass('auth.sessions') IS NULL
    OR to_regclass('auth.refresh_tokens') IS NULL
    OR EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='noor_sessions' AND column_name='originating_auth_session_id')
    OR NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='noor_r386_g1_guard'
      AND NOT rolcanlogin AND NOT rolsuper AND NOT rolbypassrls)
  THEN RAISE EXCEPTION 'R386_G1_DISPOSABLE_BINDING_REQUIRED'; END IF;
END $$;

-- No FK to auth.sessions: deletion of a provider session must not be blocked.
-- Missing referenced sessions are deliberately denied, not recreated.
ALTER TABLE public.noor_sessions ADD COLUMN originating_auth_session_id uuid;
CREATE INDEX g1_originating_auth_session_idx ON public.noor_sessions(originating_auth_session_id);
GRANT SELECT(originating_auth_session_id) ON public.noor_sessions TO noor_r386_g1_guard;
-- Prepare on a nonempty R385 database without invalidating old sessions.
CREATE TABLE noor_r386_candidate.g234_session_binding_state(
 singleton boolean PRIMARY KEY CHECK(singleton), active boolean NOT NULL
);
INSERT INTO noor_r386_candidate.g234_session_binding_state VALUES(true,false);
ALTER TABLE noor_r386_candidate.g234_session_binding_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE noor_r386_candidate.g234_session_binding_state FORCE ROW LEVEL SECURITY;
REVOKE ALL ON noor_r386_candidate.g234_session_binding_state FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON noor_r386_candidate.g234_session_binding_state TO noor_r386_g1_guard;
CREATE POLICY g234_binding_read ON noor_r386_candidate.g234_session_binding_state FOR SELECT TO noor_r386_g1_guard USING(true);
-- Separate manual activation after the new runtime is ready. Never backfill
-- a guessed provider session ID or resurrect old revoked sessions.
CREATE FUNCTION noor_r386_candidate.g234_activate_bound_sessions()
RETURNS bigint LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path=pg_catalog AS $$
DECLARE n bigint;
BEGIN
 IF current_user<>'postgres' OR current_setting('transaction_isolation')<>'read committed'
 THEN RAISE EXCEPTION 'R386_RELEASE_ACTIVATION_DENIED'; END IF;
 LOCK TABLE public.noor_sessions IN SHARE ROW EXCLUSIVE MODE;
 UPDATE public.noor_sessions SET revoked_at_epoch_ms=greatest(created_at_epoch_ms,floor(extract(epoch FROM clock_timestamp())*1000)::bigint)
 WHERE originating_auth_session_id IS NULL AND revoked_at_epoch_ms IS NULL;
 GET DIAGNOSTICS n=ROW_COUNT;
 UPDATE noor_r386_candidate.g234_session_binding_state SET active=true WHERE singleton;
 IF NOT FOUND THEN RAISE EXCEPTION 'R386_RELEASE_ACTIVATION_STATE_DENIED'; END IF;
 RETURN n;
END $$;
REVOKE ALL ON FUNCTION noor_r386_candidate.g234_activate_bound_sessions() FROM PUBLIC,anon,authenticated,service_role,noor_r386_g1_writer,noor_r386_g1_guard;

-- Disposable proof of a narrow provider-owned boundary, installed by postgres.
-- No grants on provider tables or schema, no provider-table policy changes.
DO $$ BEGIN
  IF current_user <> 'postgres'
    OR NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname=current_user AND NOT rolsuper AND rolbypassrls)
    OR NOT has_schema_privilege(current_user,'auth','USAGE')
    OR has_schema_privilege('noor_r386_g1_guard','auth','USAGE')
  THEN RAISE EXCEPTION 'R386_G1_HOSTED_INSTALLER_PRECONDITION'; END IF;
END $$;

CREATE FUNCTION noor_r386_candidate.g1_assert_live_managed_auth_session(p_session uuid,p_owner uuid)
RETURNS void LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=pg_catalog AS $g1$
BEGIN
  IF p_session IS NULL OR p_owner IS NULL THEN
    RAISE EXCEPTION 'R386_G1_MANAGED_SESSION_DENIED';
  END IF;
  PERFORM u.id FROM auth.users u WHERE u.id=p_owner AND u.deleted_at IS NULL FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'R386_G1_AUTH_USER_DENIED'; END IF;
  -- Row lock serializes against provider deletion, and not_after is checked
  -- rather than assuming that presence alone proves all session validity.
  PERFORM s.id FROM auth.sessions s WHERE s.id=p_session AND s.user_id=p_owner
    AND (s.not_after IS NULL OR s.not_after>clock_timestamp()) FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'R386_G1_MANAGED_SESSION_DENIED'; END IF;
  -- Covers refresh-token-reuse termination where all refresh tokens are
  -- revoked. No token value is read. Locking the active row makes concurrent
  -- rotation/revocation fail closed (serialization/deadlock errors retry).
  PERFORM r.id FROM auth.refresh_tokens r
    WHERE r.session_id=p_session AND r.revoked IS FALSE
    ORDER BY r.id LIMIT 1 FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'R386_G1_MANAGED_SESSION_DENIED'; END IF;
END $g1$;

CREATE FUNCTION noor_r386_candidate.g1_require_originating_auth_on_insert()
RETURNS trigger LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=pg_catalog AS $g1$
DECLARE v_owner uuid; l record; a record; n integer:=0;
BEGIN
  IF NEW.originating_auth_session_id IS NULL THEN
    IF EXISTS(SELECT 1 FROM noor_r386_candidate.g234_session_binding_state WHERE singleton AND NOT active) THEN RETURN NEW; END IF;
    RAISE EXCEPTION 'R386_RELEASE_BOUND_SESSION_REQUIRED';
  END IF;
  -- Preliminary resolution is not authority. Recheck all persisted linkages
  -- under the same owner lock and row locks after acquiring it.
  SELECT user_id INTO v_owner FROM public.noor_authentication_account_linkages
    WHERE account_id=NEW.account_id ORDER BY user_id LIMIT 1;
  IF NOT FOUND OR v_owner IS NULL THEN
    RAISE EXCEPTION 'R386_G1_MANAGED_LINKAGE_DENIED';
  END IF;
  PERFORM pg_advisory_xact_lock(386017,hashtext(v_owner::text));
  IF EXISTS(SELECT 1 FROM noor_r386_candidate.g1_owner_erasure_tombstone
    WHERE owner_id=v_owner::text) THEN RAISE EXCEPTION 'R386_G1_ERASED_OWNER_DENIED'; END IF;
  FOR l IN SELECT issuer,subject,user_id FROM public.noor_authentication_account_linkages
    WHERE account_id=NEW.account_id FOR SHARE
  LOOP
    n:=n+1;
    IF l.user_id IS DISTINCT FROM v_owner OR l.subject IS DISTINCT FROM v_owner::text OR l.issuer IS NULL
      THEN RAISE EXCEPTION 'R386_G1_MANAGED_LINKAGE_DENIED'; END IF;
  END LOOP;
  IF n=0 THEN RAISE EXCEPTION 'R386_G1_MANAGED_LINKAGE_DENIED'; END IF;
  PERFORM noor_r386_candidate.g1_assert_live_managed_auth_session(NEW.originating_auth_session_id,v_owner);
  RETURN NEW;
END $g1$;

CREATE FUNCTION noor_r386_candidate.g1_reject_auth_binding_mutation()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $g1$
BEGIN
  IF NEW.originating_auth_session_id IS DISTINCT FROM OLD.originating_auth_session_id
    OR NEW.id IS DISTINCT FROM OLD.id OR NEW.account_id IS DISTINCT FROM OLD.account_id
  THEN RAISE EXCEPTION 'R386_G1_MANAGED_BINDING_IMMUTABLE'; END IF;
  RETURN NEW;
END $g1$;

REVOKE ALL ON FUNCTION
  noor_r386_candidate.g1_assert_live_managed_auth_session(uuid,uuid),
  noor_r386_candidate.g1_require_originating_auth_on_insert(),
  noor_r386_candidate.g1_reject_auth_binding_mutation()
  FROM PUBLIC,anon,authenticated,service_role,noor_r386_g1_writer;
GRANT CREATE ON SCHEMA noor_r386_candidate TO noor_r386_g1_guard;
GRANT EXECUTE ON FUNCTION noor_r386_candidate.g1_assert_live_managed_auth_session(uuid,uuid) TO noor_r386_g1_guard;
ALTER FUNCTION noor_r386_candidate.g1_require_originating_auth_on_insert() OWNER TO noor_r386_g1_guard;
ALTER FUNCTION noor_r386_candidate.g1_reject_auth_binding_mutation() OWNER TO noor_r386_g1_guard;
REVOKE CREATE ON SCHEMA noor_r386_candidate FROM noor_r386_g1_guard;

CREATE TRIGGER g1_session_originating_auth_insert
  BEFORE INSERT ON public.noor_sessions FOR EACH ROW
  EXECUTE FUNCTION noor_r386_candidate.g1_require_originating_auth_on_insert();
CREATE TRIGGER g1_session_originating_auth_immutable
  BEFORE UPDATE OF originating_auth_session_id,id,account_id ON public.noor_sessions
  FOR EACH ROW EXECUTE FUNCTION noor_r386_candidate.g1_reject_auth_binding_mutation();

-- Preserve original guard and owner/ACL; add provider-session check only in the isolate.
CREATE OR REPLACE FUNCTION noor_r386_candidate.g1_assert_committable_noor_owner(p_session_id text, p_server_owner_id text
) RETURNS text
LANGUAGE plpgsql VOLATILE SECURITY INVOKER
SET search_path = pg_catalog AS $$
DECLARE
  s record;
  g record;
  l record;
  a record;
  grant_count integer := 0;
  linkage_count integer := 0;
  observed_ms bigint;
BEGIN
  IF p_session_id IS NULL OR length(p_session_id) NOT BETWEEN 1 AND 256
    OR p_server_owner_id IS NULL OR length(p_server_owner_id) NOT BETWEEN 1 AND 512
    OR current_user IN ('anon','authenticated','service_role')
  THEN RAISE EXCEPTION 'R386_G1_TRUSTED_OWNER_DENIED'; END IF;

  -- First acquire a transaction-scoped owner lock. The erasure tombstone
  -- insertion acquires the SAME lock, so erasure cannot race a trusted write.
  PERFORM pg_catalog.pg_advisory_xact_lock(386017, pg_catalog.hashtext(p_server_owner_id));
  IF EXISTS (
    SELECT 1 FROM noor_r386_candidate.g1_owner_erasure_tombstone t
    WHERE t.owner_id=p_server_owner_id
  ) THEN RAISE EXCEPTION 'R386_G1_ERASED_OWNER_DENIED'; END IF;

  -- Lock the live NOOR session row until the caller commits. An admin
  -- revocation UPDATE of this session cannot pass this lock mid-mutation.
  SELECT id,account_id,created_at_epoch_ms,expires_at_epoch_ms,revoked_at_epoch_ms,originating_auth_session_id
    INTO s FROM public.noor_sessions
    WHERE id=p_session_id FOR SHARE;
  observed_ms := floor(extract(epoch FROM clock_timestamp())*1000)::bigint;
  IF NOT FOUND OR s.revoked_at_epoch_ms IS NOT NULL
    OR s.created_at_epoch_ms>observed_ms OR s.expires_at_epoch_ms<=observed_ms
  THEN RAISE EXCEPTION 'R386_G1_NOOR_SESSION_DENIED'; END IF;

  -- The exact application grant is also locked; a concurrent revocation
  -- serializes against the SQL mutation instead of racing a stale check.
  FOR g IN SELECT id,granted_at_epoch_ms,revoked_at_epoch_ms
    FROM public.noor_entitlement_grants
    WHERE account_id=s.account_id AND action='access'
      AND resource_type='application' AND resource_id='noor-personal'
    FOR SHARE
  LOOP
    grant_count := grant_count+1;
    IF g.revoked_at_epoch_ms IS NOT NULL OR g.granted_at_epoch_ms>observed_ms
    THEN RAISE EXCEPTION 'R386_G1_GRANT_DENIED'; END IF;
  END LOOP;
  IF grant_count<>1 THEN RAISE EXCEPTION 'R386_G1_GRANT_DENIED'; END IF;

  -- Resolve the owner from persisted NOOR account linkages, not a client
  -- claim. Every linkage must agree with the already server-derived UserId
  -- and point to an existing, non-deleted managed Auth identity.
  FOR l IN SELECT issuer,subject,account_id,user_id
    FROM public.noor_authentication_account_linkages
    WHERE account_id=s.account_id FOR SHARE
  LOOP
    linkage_count := linkage_count+1;
    IF l.user_id::text IS DISTINCT FROM p_server_owner_id
      OR l.subject IS DISTINCT FROM l.user_id::text OR l.issuer IS NULL
    THEN RAISE EXCEPTION 'R386_G1_LINKAGE_DENIED'; END IF;
  END LOOP;
  IF linkage_count=0 THEN RAISE EXCEPTION 'R386_G1_LINKAGE_DENIED'; END IF;

  -- The originating provider session must survive through the same SQL transaction.
  PERFORM noor_r386_candidate.g1_assert_live_managed_auth_session(
    s.originating_auth_session_id,p_server_owner_id::uuid);

  -- Caller's SQL adapter MUST execute all operational/candidate writes on
  -- the same transaction after this guard, and then commit. A separate
  -- service_role API request is NOT transactionally protected by this result.
  RETURN p_server_owner_id;
END $$;

DO $$ BEGIN
  IF has_function_privilege('noor_r386_g1_writer',
    'noor_r386_candidate.g1_assert_live_managed_auth_session(uuid,uuid)','EXECUTE')
    OR has_table_privilege('noor_r386_g1_writer','auth.sessions','SELECT,UPDATE,DELETE')
    OR has_table_privilege('noor_r386_g1_writer','auth.refresh_tokens','SELECT,UPDATE,DELETE')
    OR has_column_privilege('noor_r386_g1_guard','auth.refresh_tokens','token','SELECT')
    OR has_column_privilege('noor_r386_g1_guard','auth.refresh_tokens','token','UPDATE')
  THEN RAISE EXCEPTION 'R386_G1_MANAGED_SESSION_PRIVILEGE_LEAK'; END IF;
END $$;

DO $acl$
DECLARE r text; t text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_roles o ON o.oid=p.proowner
      WHERE p.oid='noor_r386_candidate.g1_assert_live_managed_auth_session(uuid,uuid)'::regprocedure
        AND p.prosecdef AND o.rolname='postgres' AND NOT o.rolsuper)
    OR NOT has_function_privilege('noor_r386_g1_guard',
        'noor_r386_candidate.g1_assert_live_managed_auth_session(uuid,uuid)','EXECUTE')
    OR has_schema_privilege('noor_r386_g1_guard','auth','USAGE')
    OR has_schema_privilege('noor_r386_g1_writer','auth','USAGE')
    OR has_schema_privilege('noor_r386_g1_guard','noor_r386_candidate','CREATE')
    OR pg_has_role('noor_r386_g1_writer','noor_r386_g1_guard','MEMBER')
    OR pg_has_role('noor_r386_g1_guard','postgres','MEMBER')
  THEN RAISE EXCEPTION 'R386_G1_HOSTED_HELPER_ACL_MISMATCH'; END IF;
  FOREACH r IN ARRAY ARRAY['anon','authenticated','service_role','noor_r386_g1_writer'] LOOP
    IF has_function_privilege(r,'noor_r386_candidate.g1_assert_live_managed_auth_session(uuid,uuid)','EXECUTE')
    THEN RAISE EXCEPTION 'R386_G1_HOSTED_HELPER_PUBLIC_ACCESS'; END IF;
  END LOOP;
  FOREACH t IN ARRAY ARRAY['auth.users','auth.sessions','auth.refresh_tokens'] LOOP
    IF has_any_column_privilege('noor_r386_g1_guard',t,'SELECT,UPDATE,INSERT,REFERENCES')
      OR has_table_privilege('noor_r386_g1_guard',t,'DELETE,TRUNCATE,TRIGGER')
      OR has_any_column_privilege('noor_r386_g1_writer',t,'SELECT,UPDATE,INSERT,REFERENCES')
      OR has_table_privilege('noor_r386_g1_writer',t,'DELETE,TRUNCATE,TRIGGER')
    THEN RAISE EXCEPTION 'R386_G1_HOSTED_RAW_AUTH_ACCESS'; END IF;
  END LOOP;
END $acl$;
