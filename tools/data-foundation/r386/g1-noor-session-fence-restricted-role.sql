-- R386 G1 isolated SQL roles, AFTER S1-S4 and g1-session-transaction-fence.
-- NEVER apply to production/R219 without separate privileged deployment review.
-- PostgreSQL SELECT ... FOR SHARE requires SELECT and UPDATE privilege; the
-- narrow NOLOGIN definer owns the fixed-shape guard. The LOGIN caller gets
-- EXECUTE only, with no public/managed Auth table SELECT or UPDATE.
-- No password or external DB credentials are embedded in this file.

CREATE ROLE noor_r386_g1_guard NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE
  NOINHERIT NOBYPASSRLS;
CREATE ROLE noor_r386_g1_writer LOGIN PASSWORD NULL NOSUPERUSER NOCREATEDB NOCREATEROLE
  NOINHERIT NOBYPASSRLS;

GRANT USAGE ON SCHEMA public,auth,noor_r386_candidate TO noor_r386_g1_guard;
GRANT USAGE ON SCHEMA noor_r386_candidate TO noor_r386_g1_writer;

GRANT SELECT(id,account_id,created_at_epoch_ms,expires_at_epoch_ms,revoked_at_epoch_ms),
      UPDATE(revoked_at_epoch_ms)
  ON public.noor_sessions TO noor_r386_g1_guard;
GRANT SELECT(id,account_id,action,resource_type,resource_id,granted_at_epoch_ms,revoked_at_epoch_ms),
      UPDATE(revoked_at_epoch_ms)
  ON public.noor_entitlement_grants TO noor_r386_g1_guard;
GRANT SELECT(issuer,subject,account_id,user_id), UPDATE(account_id)
  ON public.noor_authentication_account_linkages TO noor_r386_g1_guard;
GRANT SELECT(id,deleted_at), UPDATE(deleted_at)
  ON auth.users TO noor_r386_g1_guard;
GRANT SELECT ON noor_r386_candidate.g1_owner_erasure_tombstone
  TO noor_r386_g1_guard;

-- The real NOOR public tables have RLS enabled, with no permissive
-- browser policies. The guard is NOLOGIN and has no member roles.
-- Explicit guard-only read/update policies are required for row locks;
-- otherwise SELECT FOR SHARE silently sees no session/grants/linkages.
-- This is isolated-only and must be independently audited before managed rollout.
DO $noor_g1$
DECLARE name text;
BEGIN
 FOREACH name IN ARRAY ARRAY[
   'noor_sessions','noor_entitlement_grants','noor_authentication_account_linkages'
 ] LOOP
  IF NOT (SELECT c.relrowsecurity FROM pg_class c JOIN pg_namespace ns
    ON ns.oid=c.relnamespace WHERE ns.nspname='public' AND c.relname=name)
  THEN RAISE EXCEPTION 'R386_G1_SOURCE_RLS_REQUIRED'; END IF;
  EXECUTE format('CREATE POLICY g1_guard_select ON public.%I FOR SELECT TO noor_r386_g1_guard USING (true)',name);
  EXECUTE format('CREATE POLICY g1_guard_lock ON public.%I FOR UPDATE TO noor_r386_g1_guard USING (true) WITH CHECK (true)',name);
 END LOOP;
END $noor_g1$;
CREATE POLICY g1_guard_noor_sessions_read ON public.noor_sessions FOR SELECT TO noor_r386_g1_guard USING (true);
CREATE POLICY g1_guard_noor_grants_read ON public.noor_entitlement_grants FOR SELECT TO noor_r386_g1_guard USING (true);
CREATE POLICY g1_guard_noor_linkages_read ON public.noor_authentication_account_linkages FOR SELECT TO noor_r386_g1_guard USING (true);
CREATE POLICY g1_guard_auth_users_read ON auth.users FOR SELECT TO noor_r386_g1_guard USING (true);
CREATE POLICY g1_guard_tombstone_read
  ON noor_r386_candidate.g1_owner_erasure_tombstone
  FOR SELECT TO noor_r386_g1_guard USING (true);


-- The NOLOGIN guard owns the trusted wrappers. The LOGIN writer gets only
-- those wrapped entrypoints, never S3/raw auth or even the standalone guard.
CREATE FUNCTION noor_r386_candidate.g1_authorized_lookup(
 p_session text,p_owner text,p_request text
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY INVOKER
SET search_path=pg_catalog AS $g1$
BEGIN
 IF noor_r386_candidate.g1_assert_committable_noor_owner(p_session,p_owner)
    IS DISTINCT FROM p_owner
 THEN RAISE EXCEPTION 'R386_G1_OWNER_CONTEXT_CHANGED'; END IF;
 RETURN noor_r386_candidate.s3_lookup(p_owner,p_request);
END $g1$;

CREATE FUNCTION noor_r386_candidate.g1_authorized_commit(
 p_session text,p_owner text,p_request text,p_exists boolean,
 p_revision bigint,p_before jsonb,p_after jsonb,p_key text,
 p_digest text,p_fingerprints jsonb,p_deleted text[]
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY INVOKER
SET search_path=pg_catalog AS $g1$
BEGIN
 IF noor_r386_candidate.g1_assert_committable_noor_owner(p_session,p_owner)
    IS DISTINCT FROM p_owner
 THEN RAISE EXCEPTION 'R386_G1_OWNER_CONTEXT_CHANGED'; END IF;
 RETURN noor_r386_candidate.s3_commit(p_owner,p_request,p_exists,p_revision,
   p_before,p_after,p_key,p_digest,p_fingerprints,p_deleted);
END $g1$;

REVOKE ALL ON FUNCTION
  noor_r386_candidate.g1_authorized_lookup(text,text,text),
  noor_r386_candidate.g1_authorized_commit(text,text,text,boolean,bigint,jsonb,jsonb,text,text,jsonb,text[])
  FROM PUBLIC,anon,authenticated,service_role,noor_r386_g1_writer;

GRANT CREATE ON SCHEMA noor_r386_candidate TO noor_r386_g1_guard;
ALTER FUNCTION noor_r386_candidate.g1_assert_committable_noor_owner(text,text)
 OWNER TO noor_r386_g1_guard;
ALTER FUNCTION noor_r386_candidate.g1_authorized_lookup(text,text,text)
 OWNER TO noor_r386_g1_guard;
ALTER FUNCTION noor_r386_candidate.g1_authorized_commit(text,text,text,boolean,bigint,jsonb,jsonb,text,text,jsonb,text[])
 OWNER TO noor_r386_g1_guard;
REVOKE CREATE ON SCHEMA noor_r386_candidate FROM noor_r386_g1_guard;

ALTER FUNCTION noor_r386_candidate.g1_authorized_lookup(text,text,text)
 SECURITY DEFINER;
ALTER FUNCTION noor_r386_candidate.g1_authorized_commit(text,text,text,boolean,bigint,jsonb,jsonb,text,text,jsonb,text[])
 SECURITY DEFINER;

-- Subroutines may run under the wrapper owner ONLY; never grant to writer.
GRANT EXECUTE ON FUNCTION
  noor_r386_candidate.g1_assert_committable_noor_owner(text,text),
  noor_r386_candidate.s3_lookup(text,text),
  noor_r386_candidate.s3_commit(text,text,boolean,bigint,jsonb,jsonb,text,text,jsonb,text[])
  TO noor_r386_g1_guard;

GRANT EXECUTE ON FUNCTION
  noor_r386_candidate.g1_authorized_lookup(text,text,text),
  noor_r386_candidate.g1_authorized_commit(text,text,text,boolean,bigint,jsonb,jsonb,text,text,jsonb,text[])
  TO noor_r386_g1_writer;

-- The guard is intentionally SECURITY INVOKER. A call from inside the
-- SECURITY DEFINER wrapper executes as the restricted NOLOGIN guard.
DO $g1$
DECLARE rol record; t text;
BEGIN
 SELECT rolcanlogin,rolsuper,rolbypassrls INTO rol
 FROM pg_roles WHERE rolname='noor_r386_g1_writer';
 IF NOT FOUND OR NOT rol.rolcanlogin OR rol.rolsuper OR rol.rolbypassrls
    OR has_schema_privilege('noor_r386_g1_writer','auth','USAGE')
    OR has_table_privilege('noor_r386_g1_writer','auth.users','SELECT,UPDATE,DELETE')
    OR has_table_privilege('noor_r386_g1_writer','public.noor_sessions','SELECT,UPDATE,DELETE')
    OR pg_has_role('noor_r386_g1_writer','noor_r386_g1_guard','MEMBER')
 THEN RAISE EXCEPTION 'R386_G1_WRITER_ROLE_PRIVILEGE_LEAK'; END IF;
 SELECT rolcanlogin,rolsuper,rolbypassrls INTO rol
 FROM pg_roles WHERE rolname='noor_r386_g1_guard';
 IF NOT FOUND OR rol.rolcanlogin OR rol.rolsuper OR rol.rolbypassrls
 THEN RAISE EXCEPTION 'R386_G1_GUARD_ROLE_PRIVILEGE_LEAK'; END IF;
 FOREACH t IN ARRAY ARRAY[
 'noor_r386_candidate.g1_assert_committable_noor_owner(text,text)',
 'noor_r386_candidate.s3_lookup(text,text)',
 'noor_r386_candidate.s3_commit(text,text,boolean,bigint,jsonb,jsonb,text,text,jsonb,text[])'
 ] LOOP
  IF has_function_privilege('noor_r386_g1_writer',t,'EXECUTE')
  THEN RAISE EXCEPTION 'R386_G1_WRITER_RAW_SQL_LEAK'; END IF;
 END LOOP;
 IF NOT has_function_privilege('noor_r386_g1_writer',
     'noor_r386_candidate.g1_authorized_commit(text,text,text,boolean,bigint,jsonb,jsonb,text,text,jsonb,text[])','EXECUTE')
 THEN RAISE EXCEPTION 'R386_G1_WRAPPED_COMMIT_UNREACHABLE'; END IF;
 IF NOT EXISTS(
  SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  JOIN pg_roles owner ON owner.oid=p.proowner
  WHERE n.nspname='noor_r386_candidate'
    AND p.proname IN ('g1_authorized_commit','g1_authorized_lookup')
    AND p.prosecdef AND owner.rolname='noor_r386_g1_guard'
  GROUP BY owner.rolname HAVING count(*)=2
 ) THEN RAISE EXCEPTION 'R386_G1_WRAPPER_PRIVILEGES_UNSAFE'; END IF;
 RAISE NOTICE 'R386_G1_NO_BYPASS_RAW_SQL_WRITER_ACCESS_PASS';
END $g1$;
