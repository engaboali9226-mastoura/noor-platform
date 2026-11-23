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
  account_id text NOT NULL, user_id text NOT NULL
);
REVOKE ALL ON auth.users, public.noor_sessions,
  public.noor_entitlement_grants, public.noor_authentication_account_linkages
  FROM PUBLIC,anon,authenticated,service_role;

\i tools/data-foundation/r386/g1-noor-session-transaction-fence.sql

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
  ('https://localhost/auth/v1','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','g1-account-a','synthetic-r386-s3-g1-a'),
  ('https://localhost/auth/v1','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','g1-account-b','synthetic-r386-s3-g1-b');

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

DO $$
BEGIN
 IF noor_r386_candidate.g1_assert_committable_noor_owner('g1-a-device-one','synthetic-r386-s3-g1-a') <> 'synthetic-r386-s3-g1-a'
   OR noor_r386_candidate.g1_assert_committable_noor_owner('g1-a-device-two','synthetic-r386-s3-g1-a') <> 'synthetic-r386-s3-g1-a'
   OR noor_r386_candidate.g1_assert_committable_noor_owner('g1-b-device-one','synthetic-r386-s3-g1-b') <> 'synthetic-r386-s3-g1-b'
 THEN RAISE EXCEPTION 'R386_G1_TWO_DEVICE_OWNER_BIND_FAILED'; END IF;
 RAISE NOTICE 'R386_G1_LIVE_NOOR_TABLE_NAMES_TWO_DEVICE_PASS';
END $;

-- This is the actual R386 S3 SQL commit function, in the SAME transaction as
-- the persisted NOOR session/grant/owner fence. Both are server-authorized,
-- not a browser-selected owner or separate service_role API write.
INSERT INTO noor_r386_candidate.s3_enrollment(owner_id,shadow_enabled) VALUES
  ('synthetic-r386-s3-g1-a',true),('synthetic-r386-s3-g1-b',true);
DO $
DECLARE
  a text:='synthetic-r386-s3-g1-a';
  b text:='synthetic-r386-s3-g1-b';
  empty_state jsonb:='{"historicalEvents":[],"notificationHistory":[],"fridayMosqueVisits":[],"locations":[],"prayerPolicies":[],"personalDays":[],"islamicContexts":[],"definitions":[],"dailyExecution":[],"outbox":[]}'::jsonb;
  digest_a text:=repeat('a',64);
  digest_b text:=repeat('b',64);
  response_a jsonb;
  response_b jsonb;
BEGIN
  IF noor_r386_candidate.g1_assert_committable_noor_owner('g1-a-device-one',a)<>a
  THEN RAISE EXCEPTION 'R386_G1_FENCE_OWNER_A'; END IF;
  response_a:=noor_r386_candidate.s3_commit(a,'g1-receipt-a',false,0,
    empty_state,empty_state,'k1',digest_a,jsonb_build_object('k1',digest_a));
  IF response_a->>'kind'<>'committed' OR response_a#>>'{receipt,revision}'<>'0'
  THEN RAISE EXCEPTION 'R386_G1_FENCED_S3_COMMIT_A'; END IF;

  IF noor_r386_candidate.g1_assert_committable_noor_owner('g1-b-device-one',b)<>b
  THEN RAISE EXCEPTION 'R386_G1_FENCE_OWNER_B'; END IF;
  response_b:=noor_r386_candidate.s3_commit(b,'g1-receipt-b',false,0,
    empty_state,empty_state,'k1',digest_b,jsonb_build_object('k1',digest_b));
  IF response_b->>'kind'<>'committed' OR response_b#>>'{receipt,revision}'<>'0'
  THEN RAISE EXCEPTION 'R386_G1_FENCED_S3_COMMIT_B'; END IF;
  IF (SELECT count(*) FROM noor_r386_candidate.command_receipt WHERE owner_id=a)<>1
    OR (SELECT count(*) FROM noor_r386_candidate.command_receipt WHERE owner_id=b)<>1
  THEN RAISE EXCEPTION 'R386_G1_CROSS_OWNER_RECEIPT_DRIFT'; END IF;
  RAISE NOTICE 'R386_G1_NOOR_FENCE_AND_S3_COMMIT_SAME_SQL_TRANSACTION_PASS';
END $;

SELECT noor_r386_candidate.g1_expect_rejection('g1-a-device-one','synthetic-r386-s3-g1-b','R386_G1_LINKAGE_DENIED');
SELECT noor_r386_candidate.g1_expect_rejection('g1-no-such-session','synthetic-r386-s3-g1-a','R386_G1_NOOR_SESSION_DENIED');
SELECT noor_r386_candidate.g1_expect_rejection('g1-expired','synthetic-r386-s3-g1-a','R386_G1_NOOR_SESSION_DENIED');

-- Simulate revocation AFTER an earlier successful NOOR application check.
UPDATE public.noor_sessions SET revoked_at_epoch_ms=1 WHERE id='g1-a-device-one';
SELECT noor_r386_candidate.g1_expect_rejection('g1-a-device-one','synthetic-r386-s3-g1-a','R386_G1_NOOR_SESSION_DENIED');
UPDATE public.noor_sessions SET revoked_at_epoch_ms=NULL WHERE id='g1-a-device-one';

UPDATE public.noor_entitlement_grants SET revoked_at_epoch_ms=1 WHERE id='grant-a';
SELECT noor_r386_candidate.g1_expect_rejection('g1-a-device-two','synthetic-r386-s3-g1-a','R386_G1_GRANT_DENIED');
UPDATE public.noor_entitlement_grants SET revoked_at_epoch_ms=NULL WHERE id='grant-a';

-- Old cookie must also fail if the linked Auth principal is soft deleted.
UPDATE auth.users SET deleted_at=clock_timestamp()
 WHERE id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
SELECT noor_r386_candidate.g1_expect_rejection('g1-a-device-one','synthetic-r386-s3-g1-a','R386_G1_AUTH_USER_DENIED');
UPDATE auth.users SET deleted_at=NULL
 WHERE id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

-- Erasure has a transaction-level owner lock shared with the write guard.
INSERT INTO noor_r386_candidate.g1_owner_erasure_tombstone(owner_id) VALUES('synthetic-r386-s3-g1-a');
SELECT noor_r386_candidate.g1_expect_rejection('g1-a-device-one','synthetic-r386-s3-g1-a','R386_G1_ERASED_OWNER_DENIED');
SELECT noor_r386_candidate.g1_expect_rejection('g1-a-device-two','synthetic-r386-s3-g1-a','R386_G1_ERASED_OWNER_DENIED');
DO $$
BEGIN
 IF noor_r386_candidate.g1_assert_committable_noor_owner('g1-b-device-one','synthetic-r386-s3-g1-b') <> 'synthetic-r386-s3-g1-b'
 THEN RAISE EXCEPTION 'R386_G1_OTHER_ACCOUNT_CHANGED'; END IF;
 RAISE NOTICE 'R386_G1_COMMIT_FENCE_REVOKE_GRANT_AUTH_ERASE_OWNER_ISOLATION_PASS';
END $$;

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
    OR to_regclass('noor_r386_candidate.g1_owner_erasure_tombstone') IS NOT NULL
    OR to_regprocedure('noor_r386_candidate.g1_assert_committable_noor_owner(text,text)') IS NOT NULL
 THEN RAISE EXCEPTION 'R386_G1_FENCE_ROLLBACK_FAILED'; END IF;
 RAISE NOTICE 'R386_G1_FENCE_COMPLETE_TRANSACTION_ROLLBACK_PASS';
END $$;
