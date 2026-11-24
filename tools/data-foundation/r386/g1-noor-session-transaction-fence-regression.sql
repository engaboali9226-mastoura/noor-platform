-- R386 G1 regression for the real NOOR persisted relational table names.
-- Disposable GitHub Actions PostgreSQL 17 only; NOT a production schema import.
-- Every fixture, role change, function and row introduced here is rolled back.
BEGIN;
DO $$
BEGIN
 IF to_regclass('public.noor_sessions') IS NOT NULL
    OR to_regclass('public.noor_entitlement_grants') IS NOT NULL
    OR to_regclass('public.noor_authentication_account_linkages') IS NOT NULL
    OR to_regclass('auth.users') IS NOT NULL
    OR to_regclass('public.noor_personal_foundations') IS NOT NULL
    OR to_regclass('noor_r386_candidate.g1_owner_erasure_tombstone') IS NOT NULL
 THEN RAISE EXCEPTION 'R386_G1_FENCE_REQUIRES_EMPTY_ISOLATED_FIXTURE'; END IF;
END $$;
CREATE SCHEMA auth;
REVOKE ALL ON SCHEMA auth FROM PUBLIC,anon,authenticated,service_role;
CREATE TABLE auth.users(
  id uuid PRIMARY KEY, deleted_at timestamptz
);
CREATE TABLE public.noor_sessions (
  id text PRIMARY KEY, account_id text NOT NULL,
  created_at_epoch_ms bigint NOT NULL,
  expires_at_epoch_ms bigint NOT NULL,
  revoked_at_epoch_ms bigint
);
CREATE TABLE public.noor_entitlement_grants (
  id text PRIMARY KEY, account_id text NOT NULL,
  action text NOT NULL, resource_type text NOT NULL, resource_id text NOT NULL,
  granted_at_epoch_ms bigint NOT NULL, revoked_at_epoch_ms bigint
);
CREATE TABLE public.noor_authentication_account_linkages (
  issuer text NOT NULL, subject text NOT NULL,
  account_id text NOT NULL, user_id uuid NOT NULL
);
-- Exact column names/types for the NOOR authoritative personal data source.
-- This is fictional data inside an uncommitted disposable fixture only.
CREATE TABLE public.noor_personal_foundations(
  user_id text PRIMARY KEY, schema_version integer NOT NULL CHECK(schema_version=1),
  revision bigint NOT NULL CHECK(revision>=0),
  state jsonb NOT NULL CHECK(jsonb_typeof(state)='object'),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
REVOKE ALL ON auth.users, public.noor_sessions,
  public.noor_entitlement_grants, public.noor_authentication_account_linkages,
  public.noor_personal_foundations
  FROM PUBLIC,anon,authenticated,service_role;

-- Precisely mirror the managed source's RLS posture, rather than relying
-- on the superuser's implicit RLS bypass.
ALTER TABLE public.noor_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.noor_entitlement_grants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.noor_authentication_account_linkages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.noor_personal_foundations ENABLE ROW LEVEL SECURITY;
ALTER TABLE auth.users ENABLE ROW LEVEL SECURITY;
\i tools/data-foundation/r386/g1-noor-session-transaction-fence.sql
\i tools/data-foundation/r386/g1-noor-session-fence-restricted-role.sql
\i tools/data-foundation/r386/g1-authoritative-foundation-read.sql

-- S3 is still a synthetic-only candidate: permit exactly these two UUID
-- fixtures in the S3 NOLOGIN transaction role, without permitting arbitrary
-- identifiers or changing pre-existing S3 policy in the repository.
DO $g1_fixture$
DECLARE n text;
BEGIN
 FOREACH n IN ARRAY ARRAY['s3_enrollment','owner_scope','event_history',
    'delivery_outbox','checkpoint','command_receipt'] LOOP
  EXECUTE format('CREATE POLICY g1_two_uuid_fixtures ON noor_r386_candidate.%I FOR ALL TO noor_r386_s3_tx USING (owner_id IN (%L,%L)) WITH CHECK (owner_id IN (%L,%L))',
    n,'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
 END LOOP;
 CREATE POLICY g1_two_uuid_fixtures ON noor_r386_lab.synthetic_source
   FOR ALL TO noor_r386_s3_tx
   USING (owner_id IN ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'))
   WITH CHECK (owner_id IN ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'));
END $g1_fixture$;

\i tools/data-foundation/r386/g1-s3-exact-uuid-fixture.sql

INSERT INTO auth.users(id,deleted_at) VALUES
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',NULL),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',NULL);
INSERT INTO public.noor_sessions VALUES
  ('g1-a-device-one','g1-account-a',0,9999999999999,NULL),
  ('g1-a-device-two','g1-account-a',0,9999999999999,NULL),
  ('g1-b-device-one','g1-account-b',0,9999999999999,NULL),
  ('g1-expired','g1-account-a',0,1,NULL);
INSERT INTO public.noor_entitlement_grants VALUES
  ('grant-a','g1-account-a','access','application','noor-personal',0,NULL),
  ('grant-b','g1-account-b','access','application','noor-personal',0,NULL);
INSERT INTO public.noor_authentication_account_linkages VALUES
  ('https://localhost/auth/v1','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','g1-account-a','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
  ('https://localhost/auth/v1','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','g1-account-b','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');

INSERT INTO public.noor_personal_foundations(user_id,schema_version,revision,state)
VALUES
 ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',1,7,
  '{"definitions":[],"outbox":[],"source":"original-a"}'::jsonb),
 ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',1,11,
  '{"definitions":[],"outbox":[],"source":"original-b"}'::jsonb);

SET ROLE noor_r386_g1_writer;
DO $operational$
DECLARE owner_a text:='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
        owner_b text:='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
        a1 jsonb; a2 jsonb; b jsonb; failure text;
BEGIN
 a1:=noor_r386_candidate.g1_authorized_operational_read('g1-a-device-one',owner_a);
 a2:=noor_r386_candidate.g1_authorized_operational_read('g1-a-device-two',owner_a);
 b:=noor_r386_candidate.g1_authorized_operational_read('g1-b-device-one',owner_b);
 IF a1 IS DISTINCT FROM a2
    OR a1->>'existed' IS DISTINCT FROM 'true'
    OR a1->>'revision' IS DISTINCT FROM '7'
    OR a1#>>'{state,source}' IS DISTINCT FROM 'original-a'
    OR b#>>'{state,source}' IS DISTINCT FROM 'original-b'
    OR b->>'revision' IS DISTINCT FROM '11'
 THEN RAISE EXCEPTION 'R386_G1_ORIGINAL_FOUNDATION_PARITY_FAILED'; END IF;
 BEGIN
   PERFORM noor_r386_candidate.g1_authorized_operational_read('g1-a-device-one',owner_b);
   RAISE EXCEPTION 'R386_G1_CROSS_OWNER_READ_ALLOWED';
 EXCEPTION WHEN OTHERS THEN
   GET STACKED DIAGNOSTICS failure=MESSAGE_TEXT;
   IF failure <> 'R386_G1_LINKAGE_DENIED' THEN
     RAISE EXCEPTION 'R386_G1_WRONG_CROSS_OWNER_DENIAL %',failure;
   END IF;
 END;
 RAISE NOTICE 'R386_G1_AUTH_ORIGINAL_FOUNDATION_TWO_DEVICES_AND_OWNER_ISOLATION_PASS';
END $operational$;
RESET ROLE;

CREATE FUNCTION noor_r386_candidate.g1_expect_rejection(
 p_session text,p_owner text,p_error text
) RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $$
DECLARE actual text;
BEGIN
 BEGIN
  PERFORM noor_r386_candidate.g1_assert_committable_noor_owner(p_session,p_owner);
  RAISE EXCEPTION 'R386_G1_REJECTION_NOT_ENFORCED';
 EXCEPTION WHEN OTHERS THEN
  GET STACKED DIAGNOSTICS actual=MESSAGE_TEXT;
  IF actual IS DISTINCT FROM p_error THEN RAISE EXCEPTION
   'R386_G1_REJECTION_WRONG_CLASS %', actual;
  END IF;
 END;
END $$;

-- The real NOOR linkage owns UUIDs; S3 is deliberately synthetic-only
-- and refuses these IDs. Keep those separate until a true source migration
-- is designed. Verify the actual NOLOGIN guard's locked SQL view first.
SET ROLE noor_r386_g1_guard;
DO $$
BEGIN
 IF noor_r386_candidate.g1_assert_committable_noor_owner('g1-a-device-one','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')<>'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
    OR noor_r386_candidate.g1_assert_committable_noor_owner('g1-a-device-two','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')<>'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
    OR noor_r386_candidate.g1_assert_committable_noor_owner('g1-b-device-one','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb')<>'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
 THEN RAISE EXCEPTION 'R386_G1_UUID_AUTH_OWNER_FENCE_FAILED'; END IF;
 BEGIN
  UPDATE auth.users SET deleted_at=clock_timestamp()
    WHERE id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  RAISE EXCEPTION 'R386_G1_GUARD_AUTH_UPDATE_ALLOWED';
 EXCEPTION WHEN insufficient_privilege THEN NULL;
 END;
 RAISE NOTICE 'R386_G1_REAL_UUID_NOOR_SESSION_OWNER_FENCE_PASS';
END $$;
RESET ROLE;
SET ROLE noor_r386_g1_writer;
DO $g1_deny$
DECLARE actual text;
BEGIN
 BEGIN
  PERFORM noor_r386_candidate.g1_authorized_commit(
   'g1-a-device-one','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','uuid-unenrolled',false,0,
   '{"outbox":[]}'::jsonb,'{"outbox":[]}'::jsonb,
   'k1',repeat('a',64),jsonb_build_object('k1',repeat('a',64)),ARRAY[]::text[]);
  RAISE EXCEPTION 'R386_G1_UNSAFE_UUID_WRITE_ALLOWED';
 EXCEPTION WHEN OTHERS THEN
  GET STACKED DIAGNOSTICS actual=MESSAGE_TEXT;
  IF actual NOT IN ('R386_S3_SCOPE','R386_S3_NOT_ENROLLED')
  THEN RAISE EXCEPTION 'R386_G1_WRONG_UNENROLLED_FAILURE %',actual; END IF;
 END;
 RAISE NOTICE 'R386_G1_REAL_UUID_S3_SYNTHETIC_SCOPE_DENIED_PASS';
END $g1_deny$;
RESET ROLE;
SET ROLE noor_r386_g1_guard;

SELECT noor_r386_candidate.g1_expect_rejection('g1-a-device-one','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','R386_G1_LINKAGE_DENIED');
SELECT noor_r386_candidate.g1_expect_rejection('g1-no-such-session','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','R386_G1_NOOR_SESSION_DENIED');
SELECT noor_r386_candidate.g1_expect_rejection('g1-expired','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','R386_G1_NOOR_SESSION_DENIED');

RESET ROLE;

-- Simulate revocation AFTER an earlier successful NOOR application check.
UPDATE public.noor_sessions SET revoked_at_epoch_ms=1 WHERE id='g1-a-device-one';
SET ROLE noor_r386_g1_writer;
DO $revoked_read$
DECLARE error_text text;
BEGIN
 BEGIN
  PERFORM noor_r386_candidate.g1_authorized_operational_read(
   'g1-a-device-one','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
  RAISE EXCEPTION 'R386_G1_REVOKED_OPERATIONAL_READ_ALLOWED';
 EXCEPTION WHEN OTHERS THEN
  GET STACKED DIAGNOSTICS error_text=MESSAGE_TEXT;
  IF error_text <> 'R386_G1_NOOR_SESSION_DENIED'
  THEN RAISE EXCEPTION 'R386_G1_OPERATIONAL_READ_DENIAL_MISMATCH %',error_text; END IF;
 END;
 RAISE NOTICE 'R386_G1_REVOKED_SESSION_OPERATIONAL_READ_DENIED_PASS';
END $revoked_read$;
RESET ROLE;
SET ROLE noor_r386_g1_guard;
SELECT noor_r386_candidate.g1_expect_rejection('g1-a-device-one','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','R386_G1_NOOR_SESSION_DENIED');
RESET ROLE;
UPDATE public.noor_sessions SET revoked_at_epoch_ms=NULL WHERE id='g1-a-device-one';

UPDATE public.noor_entitlement_grants SET revoked_at_epoch_ms=1 WHERE id='grant-a';
SET ROLE noor_r386_g1_guard;
SELECT noor_r386_candidate.g1_expect_rejection('g1-a-device-two','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','R386_G1_GRANT_DENIED');
RESET ROLE;
UPDATE public.noor_entitlement_grants SET revoked_at_epoch_ms=NULL WHERE id='grant-a';

-- Old cookie must also fail if the linked Auth principal is soft deleted.
UPDATE auth.users SET deleted_at=clock_timestamp()
 WHERE id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
SET ROLE noor_r386_g1_guard;
SELECT noor_r386_candidate.g1_expect_rejection('g1-a-device-one','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','R386_G1_AUTH_USER_DENIED');
RESET ROLE;
UPDATE auth.users SET deleted_at=NULL
 WHERE id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

-- Erasure has a transaction-level owner lock shared with the write guard.
INSERT INTO noor_r386_candidate.g1_owner_erasure_tombstone(owner_id) VALUES('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
SET ROLE noor_r386_g1_guard;
SELECT noor_r386_candidate.g1_expect_rejection('g1-a-device-one','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','R386_G1_ERASED_OWNER_DENIED');
SELECT noor_r386_candidate.g1_expect_rejection('g1-a-device-two','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','R386_G1_ERASED_OWNER_DENIED');
DO $$
BEGIN
 IF noor_r386_candidate.g1_assert_committable_noor_owner('g1-b-device-one','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb') <> 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
 THEN RAISE EXCEPTION 'R386_G1_OTHER_ACCOUNT_CHANGED'; END IF;
 RAISE NOTICE 'R386_G1_COMMIT_FENCE_REVOKE_GRANT_AUTH_ERASE_OWNER_ISOLATION_PASS';
END $$;
RESET ROLE;

-- The forbidden app/browser roles get no entry point into the fence or tombstones.
DO $$
DECLARE name text;
BEGIN
 FOREACH name IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
  IF has_function_privilege(name,'noor_r386_candidate.g1_assert_committable_noor_owner(text,text)','EXECUTE')
    OR has_table_privilege(name,'noor_r386_candidate.g1_owner_erasure_tombstone','SELECT,INSERT,UPDATE,DELETE,TRUNCATE')
  THEN RAISE EXCEPTION 'R386_G1_FENCE_PRIVILEGE_LEAK'; END IF;
 END LOOP;
 RAISE NOTICE 'R386_G1_FENCE_BROWSER_AND_SERVICE_ROLE_DENIAL_PASS';
END $$;

ROLLBACK;
DO $$
BEGIN
 IF to_regclass('public.noor_sessions') IS NOT NULL
    OR to_regclass('public.noor_entitlement_grants') IS NOT NULL
    OR to_regclass('public.noor_authentication_account_linkages') IS NOT NULL
    OR to_regclass('auth.users') IS NOT NULL
    OR to_regclass('public.noor_personal_foundations') IS NOT NULL
    OR to_regclass('noor_r386_candidate.g1_owner_erasure_tombstone') IS NOT NULL
    OR to_regprocedure('noor_r386_candidate.g1_assert_committable_noor_owner(text,text)') IS NOT NULL
    OR to_regprocedure('noor_r386_candidate.g1_authorized_operational_read(text,text)') IS NOT NULL
 THEN RAISE EXCEPTION 'R386_G1_FENCE_ROLLBACK_FAILED'; END IF;
 RAISE NOTICE 'R386_G1_FENCE_COMPLETE_TRANSACTION_ROLLBACK_PASS';
END $$;
