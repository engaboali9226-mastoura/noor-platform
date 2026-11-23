-- R386 G1 isolated candidate: real NOOR relational session -> owner fence.
-- Not a production migration. Must run ONLY in reviewed isolated schema,
-- with a trusted server PostgreSQL transaction that performs the subsequent
-- source/candidate write on the SAME connection before COMMIT.
-- The browser never supplies the expected owner or invokes this function.
-- SECURITY INVOKER: no grant to anon/authenticated/service_role. No RLS bypass.

CREATE TABLE noor_r386_candidate.g1_owner_erasure_tombstone (
  owner_id text PRIMARY KEY CHECK (length(owner_id) BETWEEN 1 AND 512),
  recorded_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE noor_r386_candidate.g1_owner_erasure_tombstone ENABLE ROW LEVEL SECURITY;
ALTER TABLE noor_r386_candidate.g1_owner_erasure_tombstone FORCE ROW LEVEL SECURITY;
REVOKE ALL ON noor_r386_candidate.g1_owner_erasure_tombstone
  FROM PUBLIC, anon, authenticated, service_role;

-- Serialize erasure-tombstone insertion with any trusted G1 mutation guard.
-- Do not use this table as a substitute for the approved all-store erasure.
CREATE FUNCTION noor_r386_candidate.g1_lock_tombstone_insert()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER
SET search_path = pg_catalog AS $$
BEGIN
  PERFORM pg_catalog.pg_advisory_xact_lock(386017, pg_catalog.hashtext(NEW.owner_id));
  RETURN NEW;
END $$;
CREATE TRIGGER g1_tombstone_owner_lock
  BEFORE INSERT OR UPDATE OF owner_id ON noor_r386_candidate.g1_owner_erasure_tombstone
  FOR EACH ROW EXECUTE FUNCTION noor_r386_candidate.g1_lock_tombstone_insert();

CREATE FUNCTION noor_r386_candidate.g1_assert_committable_noor_owner(
  p_session_id text, p_server_owner_id text
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
  SELECT id,account_id,created_at_epoch_ms,expires_at_epoch_ms,revoked_at_epoch_ms
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
    IF l.user_id IS DISTINCT FROM p_server_owner_id
      OR l.subject IS NULL OR l.issuer IS NULL
    THEN RAISE EXCEPTION 'R386_G1_LINKAGE_DENIED'; END IF;
    SELECT id,deleted_at INTO a FROM auth.users
      WHERE id::text=l.subject FOR SHARE;
    IF NOT FOUND OR a.deleted_at IS NOT NULL
    THEN RAISE EXCEPTION 'R386_G1_AUTH_USER_DENIED'; END IF;
  END LOOP;
  IF linkage_count=0 THEN RAISE EXCEPTION 'R386_G1_LINKAGE_DENIED'; END IF;

  -- Caller's SQL adapter MUST execute all operational/candidate writes on
  -- the same transaction after this guard, and then commit. A separate
  -- service_role API request is NOT transactionally protected by this result.
  RETURN p_server_owner_id;
END $$;

REVOKE ALL ON FUNCTION
  noor_r386_candidate.g1_assert_committable_noor_owner(text,text),
  noor_r386_candidate.g1_lock_tombstone_insert()
  FROM PUBLIC, anon, authenticated, service_role;
