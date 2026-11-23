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

-- Role-specific visibility only: do not grant any permissions to browser or
-- service_role. These policies require independently reviewed RLS on managed
-- application tables in an actual isolated schema before deployment.
CREATE POLICY g1_guard_tombstone_read
  ON noor_r386_candidate.g1_owner_erasure_tombstone
  FOR SELECT TO noor_r386_g1_guard USING (true);

-- The guard role requires temporary CREATE solely to own this function.
GRANT CREATE ON SCHEMA noor_r386_candidate TO noor_r386_g1_guard;
ALTER FUNCTION noor_r386_candidate.g1_assert_committable_noor_owner(text,text)
  OWNER TO noor_r386_g1_guard;
REVOKE CREATE ON SCHEMA noor_r386_candidate FROM noor_r386_g1_guard;
ALTER FUNCTION noor_r386_candidate.g1_assert_committable_noor_owner(text,text)
  SECURITY DEFINER;

REVOKE ALL ON FUNCTION noor_r386_candidate.g1_assert_committable_noor_owner(text,text)
  FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION noor_r386_candidate.g1_assert_committable_noor_owner(text,text)
  TO noor_r386_g1_writer;
GRANT EXECUTE ON FUNCTION
  noor_r386_candidate.s3_lookup(text,text),
  noor_r386_candidate.s3_commit(text,text,boolean,bigint,jsonb,jsonb,text,text,jsonb,text[])
  TO noor_r386_g1_writer;

DO $$
DECLARE r record;
BEGIN
 SELECT rolcanlogin,rolsuper,rolbypassrls INTO r
  FROM pg_roles WHERE rolname='noor_r386_g1_writer';
 IF NOT FOUND OR NOT r.rolcanlogin OR r.rolsuper OR r.rolbypassrls
   OR has_schema_privilege('noor_r386_g1_writer','auth','USAGE')
   OR has_table_privilege('noor_r386_g1_writer','auth.users','SELECT,UPDATE,DELETE')
   OR has_table_privilege('noor_r386_g1_writer','public.noor_sessions','SELECT,UPDATE,DELETE')
   OR pg_has_role('noor_r386_g1_writer','noor_r386_g1_guard','MEMBER')
 THEN RAISE EXCEPTION 'R386_G1_WRITER_ROLE_PRIVILEGE_LEAK'; END IF;
 SELECT rolcanlogin,rolsuper,rolbypassrls INTO r
  FROM pg_roles WHERE rolname='noor_r386_g1_guard';
 IF NOT FOUND OR r.rolcanlogin OR r.rolsuper OR r.rolbypassrls
 THEN RAISE EXCEPTION 'R386_G1_GUARD_ROLE_PRIVILEGE_LEAK'; END IF;
END $$;
