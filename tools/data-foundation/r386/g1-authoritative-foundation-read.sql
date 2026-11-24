-- NOOR R386 G1: default-OFF, ISOLATED-ONLY read of the ACTUAL authoritative
-- public.noor_personal_foundations row, guarded by a persisted NOOR session.
-- Run inside the G1 disposable PostgreSQL 17 regression transaction only.
-- No DML, shadow promotion, reconciliation or production migration.
-- Do not confuse this read boundary with approved live source migration.

DO $g1_preflight$
BEGIN
  IF to_regclass('public.noor_personal_foundations') IS NULL
    OR NOT EXISTS(
      SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='public' AND c.relname='noor_personal_foundations'
        AND c.relrowsecurity
    )
    OR to_regprocedure('noor_r386_candidate.g1_assert_committable_noor_owner(text,text)') IS NULL
    OR to_regrole('noor_r386_g1_guard') IS NULL
    OR to_regrole('noor_r386_g1_writer') IS NULL
  THEN RAISE EXCEPTION 'R386_G1_AUTH_SOURCE_PREFLIGHT_DENIED'; END IF;
END $g1_preflight$;

-- FOR SHARE locks the original source row for the duration of the read
-- transaction. It NEVER obtains an UPDATE/DELETE entry point for the writer.
GRANT SELECT(user_id,schema_version,revision,state),UPDATE(revision)
  ON public.noor_personal_foundations TO noor_r386_g1_guard;
CREATE POLICY g1_guard_foundation_select ON public.noor_personal_foundations
  FOR SELECT TO noor_r386_g1_guard USING(true);
CREATE POLICY g1_guard_foundation_lock ON public.noor_personal_foundations
  FOR UPDATE TO noor_r386_g1_guard USING(true) WITH CHECK(true);

CREATE FUNCTION noor_r386_candidate.g1_authorized_operational_read(
  p_session_id text, p_server_owner_id text
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY INVOKER
SET search_path=pg_catalog AS $g1$
DECLARE v record;
BEGIN
  IF noor_r386_candidate.g1_assert_committable_noor_owner(
    p_session_id,p_server_owner_id
  ) IS DISTINCT FROM p_server_owner_id THEN
    RAISE EXCEPTION 'R386_G1_OPERATIONAL_OWNER_DENIED';
  END IF;
  SELECT user_id,schema_version,revision,state INTO v
  FROM public.noor_personal_foundations
  WHERE user_id=p_server_owner_id
  FOR SHARE;
  IF NOT FOUND THEN
    RETURN '{"existed":false,"revision":0,"state":null}'::jsonb;
  END IF;
  IF v.schema_version IS DISTINCT FROM 1
    OR v.revision IS NULL OR v.revision<0
    OR jsonb_typeof(v.state) IS DISTINCT FROM 'object'
    OR v.user_id IS DISTINCT FROM p_server_owner_id
  THEN RAISE EXCEPTION 'R386_G1_OPERATIONAL_SOURCE_CORRUPT'; END IF;
  RETURN jsonb_build_object(
    'existed',true,'revision',v.revision,'state',v.state
  );
END $g1$;

REVOKE ALL ON FUNCTION
  noor_r386_candidate.g1_authorized_operational_read(text,text)
  FROM PUBLIC,anon,authenticated,service_role,noor_r386_g1_writer;
GRANT CREATE ON SCHEMA noor_r386_candidate TO noor_r386_g1_guard;
ALTER FUNCTION noor_r386_candidate.g1_authorized_operational_read(text,text)
  OWNER TO noor_r386_g1_guard;
REVOKE CREATE ON SCHEMA noor_r386_candidate FROM noor_r386_g1_guard;
ALTER FUNCTION noor_r386_candidate.g1_authorized_operational_read(text,text)
  SECURITY DEFINER;
GRANT EXECUTE ON FUNCTION noor_r386_candidate.g1_authorized_operational_read(text,text)
  TO noor_r386_g1_writer;

DO $g1_acl$
DECLARE role_name text;
BEGIN
 FOREACH role_name IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
   IF has_function_privilege(role_name,
     'noor_r386_candidate.g1_authorized_operational_read(text,text)','EXECUTE')
   THEN RAISE EXCEPTION 'R386_G1_OPERATIONAL_READ_PUBLIC_ACCESS'; END IF;
 END LOOP;
 IF has_table_privilege('noor_r386_g1_writer','public.noor_personal_foundations','SELECT,INSERT,UPDATE,DELETE')
   OR has_function_privilege('noor_r386_g1_writer',
     'noor_r386_candidate.g1_assert_committable_noor_owner(text,text)','EXECUTE')
   OR NOT has_function_privilege('noor_r386_g1_writer',
     'noor_r386_candidate.g1_authorized_operational_read(text,text)','EXECUTE')
 THEN RAISE EXCEPTION 'R386_G1_OPERATIONAL_READ_ROLE_VIOLATION'; END IF;
 RAISE NOTICE 'R386_G1_OPERATIONAL_SOURCE_RESTRICTED_WRAPPER_PASS';
END $g1_acl$;
