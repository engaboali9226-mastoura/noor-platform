-- NOOR R386 G1: disposable, synthetic-only lifecycle + transaction proof.
-- Run after S1/S2/S3/S4 schema setup in an isolated PostgreSQL 17 fixture.
-- Does NOT represent managed Supabase authentication or live NOOR wiring.
BEGIN;
CREATE SCHEMA noor_r386_g1_txlab;
REVOKE ALL ON SCHEMA noor_r386_g1_txlab FROM PUBLIC,anon,authenticated,service_role,noor_r386_s3_executor;
CREATE TABLE noor_r386_g1_txlab.linkage(
 account_id text PRIMARY KEY, owner_id text UNIQUE NOT NULL, enabled boolean NOT NULL DEFAULT true
);
CREATE TABLE noor_r386_g1_txlab.sessions(
 session_id text PRIMARY KEY, account_id text NOT NULL, expires_at_epoch_ms bigint NOT NULL,
 revoked_at_epoch_ms bigint
);
CREATE TABLE noor_r386_g1_txlab.grants(
 account_id text NOT NULL, application_id text NOT NULL, revoked boolean NOT NULL DEFAULT false,
 PRIMARY KEY(account_id,application_id)
);
CREATE TABLE noor_r386_g1_txlab.erased_owners(
 owner_id text PRIMARY KEY
);
REVOKE ALL ON ALL TABLES IN SCHEMA noor_r386_g1_txlab FROM PUBLIC,anon,authenticated,service_role,noor_r386_s3_executor;

CREATE FUNCTION noor_r386_g1_txlab.prevent_owner_reissue()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM noor_r386_g1_txlab.erased_owners e WHERE e.owner_id=NEW.owner_id)
 THEN RAISE EXCEPTION 'R386_G1_OWNER_REISSUE_DENIED'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER g1_no_owner_reissue BEFORE INSERT OR UPDATE OF owner_id
ON noor_r386_g1_txlab.linkage FOR EACH ROW
EXECUTE FUNCTION noor_r386_g1_txlab.prevent_owner_reissue();

CREATE FUNCTION noor_r386_g1_txlab.resolve_owner(p_session text,p_now bigint)
RETURNS text LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $$
DECLARE resolved text;
BEGIN
 SELECT l.owner_id INTO resolved
 FROM noor_r386_g1_txlab.sessions s
 JOIN noor_r386_g1_txlab.linkage l ON l.account_id=s.account_id
 JOIN noor_r386_g1_txlab.grants g ON g.account_id=l.account_id
 WHERE s.session_id=p_session AND s.revoked_at_epoch_ms IS NULL
  AND s.expires_at_epoch_ms>p_now AND l.enabled AND NOT g.revoked
  AND g.application_id='noor-personal'
  AND NOT EXISTS(SELECT 1 FROM noor_r386_g1_txlab.erased_owners e WHERE e.owner_id=l.owner_id);
 IF resolved IS NULL THEN RAISE EXCEPTION 'R386_G1_SESSION_OR_OWNER_DENIED'; END IF;
 RETURN resolved;
END $$;
REVOKE ALL ON FUNCTION noor_r386_g1_txlab.resolve_owner(text,bigint),
 noor_r386_g1_txlab.prevent_owner_reissue()
FROM PUBLIC,anon,authenticated,service_role,noor_r386_s3_executor;

DO $$
BEGIN
 IF has_schema_privilege('anon','noor_r386_g1_txlab','USAGE')
 OR has_schema_privilege('authenticated','noor_r386_g1_txlab','USAGE')
 OR has_schema_privilege('service_role','noor_r386_g1_txlab','USAGE')
 OR has_function_privilege('noor_r386_s3_executor','noor_r386_g1_txlab.resolve_owner(text,bigint)','EXECUTE')
 THEN RAISE EXCEPTION 'R386_G1_LAB_PRIVILEGE_LEAK'; END IF;
END $$;

INSERT INTO noor_r386_g1_txlab.linkage(account_id,owner_id)
VALUES ('synthetic-g1-account-a','synthetic-r386-s3-g1-a'),
       ('synthetic-g1-account-b','synthetic-r386-s3-g1-b');
INSERT INTO noor_r386_g1_txlab.grants(account_id,application_id)
VALUES ('synthetic-g1-account-a','noor-personal'),('synthetic-g1-account-b','noor-personal');
INSERT INTO noor_r386_g1_txlab.sessions(session_id,account_id,expires_at_epoch_ms)
VALUES ('synthetic-a-phone','synthetic-g1-account-a',9000),
       ('synthetic-a-desktop','synthetic-g1-account-a',9000),
       ('synthetic-b-phone','synthetic-g1-account-b',9000),
       ('synthetic-expired','synthetic-g1-account-a',500);
INSERT INTO noor_r386_candidate.s3_enrollment(owner_id,shadow_enabled)
VALUES ('synthetic-r386-s3-g1-a',true),('synthetic-r386-s3-g1-b',true);
INSERT INTO noor_r386_candidate.owner_scope(owner_id)
VALUES ('synthetic-r386-s3-g1-a'),('synthetic-r386-s3-g1-b');
INSERT INTO noor_r386_lab.synthetic_source(owner_id,revision,state)
VALUES
 ('synthetic-r386-s3-g1-a',1,'{"historicalEvents":[],"notificationHistory":[],"fridayMosqueVisits":[],"locations":[],"prayerPolicies":[],"personalDays":[],"islamicContexts":[],"definitions":[],"dailyExecution":[],"outbox":[]}'::jsonb),
 ('synthetic-r386-s3-g1-b',1,'{"historicalEvents":[],"notificationHistory":[],"fridayMosqueVisits":[],"locations":[],"prayerPolicies":[],"personalDays":[],"islamicContexts":[],"definitions":[],"dailyExecution":[],"outbox":[]}'::jsonb);
INSERT INTO noor_r386_candidate.command_receipt
 (owner_id,request_id,key_id,digest,committed_revision,committed_at,retain_until)
VALUES
 ('synthetic-r386-s3-g1-a','g1-synthetic-request-a','g1-key',decode(repeat('ab',32),'hex'),1,'2026-11-20T10:00:00Z','9999-12-31 00:00:00+00'),
 ('synthetic-r386-s3-g1-b','g1-synthetic-request-b','g1-key',decode(repeat('cd',32),'hex'),1,'2026-11-20T10:00:00Z','9999-12-31 00:00:00+00');
INSERT INTO noor_r386_candidate.s4_fact
(owner_id,fact_kind,entity_id,sub_id,source_revision,observation,record)
VALUES
 ('synthetic-r386-s3-g1-a','activity','g1-a-fact','g1-a-sub',1,'FirstObserved','{}'::jsonb),
 ('synthetic-r386-s3-g1-b','activity','g1-b-fact','g1-b-sub',1,'FirstObserved','{}'::jsonb);

DO $$
DECLARE a constant text:='synthetic-r386-s3-g1-a';
        b constant text:='synthetic-r386-s3-g1-b';
        total integer;
        failure text;
BEGIN
 -- Trust a verified session, not an owner parameter from the HTTP caller.
 IF noor_r386_g1_txlab.resolve_owner('synthetic-a-phone',1000)<>a
 OR noor_r386_g1_txlab.resolve_owner('synthetic-a-desktop',1000)<>a
 OR noor_r386_g1_txlab.resolve_owner('synthetic-b-phone',1000)<>b
 THEN RAISE EXCEPTION 'R386_G1_SESSION_MAPPING_FAILED'; END IF;
 BEGIN
  PERFORM noor_r386_g1_txlab.resolve_owner('synthetic-expired',1000);
  RAISE EXCEPTION 'R386_G1_EXPIRED_ALLOWED';
 EXCEPTION WHEN OTHERS THEN
  GET STACKED DIAGNOSTICS failure=MESSAGE_TEXT;
  IF failure<>'R386_G1_SESSION_OR_OWNER_DENIED' THEN RAISE; END IF;
 END;
 BEGIN
  PERFORM noor_r386_g1_txlab.resolve_owner('synthetic-nonexistent',1000);
  RAISE EXCEPTION 'R386_G1_FORGED_SESSION_ALLOWED';
 EXCEPTION WHEN OTHERS THEN
  GET STACKED DIAGNOSTICS failure=MESSAGE_TEXT;
  IF failure<>'R386_G1_SESSION_OR_OWNER_DENIED' THEN RAISE; END IF;
 END;
 RAISE NOTICE 'R386_G1_TWO_DEVICE_OWNER_BINDING_PASS';

 -- Force a failure after session revocation and candidate erase. PostgreSQL
 -- must roll back BOTH in the same transaction/subtransaction.
 BEGIN
  UPDATE noor_r386_g1_txlab.sessions SET revoked_at_epoch_ms=1000
   WHERE account_id='synthetic-g1-account-a';
  IF NOT noor_r386_candidate.s3_erase_owner(a) THEN
   RAISE EXCEPTION 'R386_G1_TEST_ERASE_EXPECTED'; END IF;
  RAISE EXCEPTION 'R386_G1_INJECTED_ROLLBACK';
 EXCEPTION WHEN OTHERS THEN
  GET STACKED DIAGNOSTICS failure=MESSAGE_TEXT;
  IF failure<>'R386_G1_INJECTED_ROLLBACK' THEN RAISE; END IF;
 END;
 SELECT count(*) INTO total FROM noor_r386_g1_txlab.sessions
 WHERE account_id='synthetic-g1-account-a' AND revoked_at_epoch_ms IS NULL;
 IF total<>3 OR NOT EXISTS(SELECT 1 FROM noor_r386_candidate.owner_scope WHERE owner_id=a)
 OR NOT EXISTS(SELECT 1 FROM noor_r386_lab.synthetic_source WHERE owner_id=a)
 OR NOT EXISTS(SELECT 1 FROM noor_r386_candidate.command_receipt WHERE owner_id=a)
 OR NOT EXISTS(SELECT 1 FROM noor_r386_candidate.s4_fact WHERE owner_id=a)
 THEN RAISE EXCEPTION 'R386_G1_ERASURE_ATOMIC_ROLLBACK_FAILED'; END IF;
 RAISE NOTICE 'R386_G1_SESSION_AND_ERASURE_ATOMIC_ROLLBACK_PASS';

 -- Authoritative, simulated privileged erasure sequence. This is NOT a
 -- managed Supabase Auth operation and must not be connected to real users.
 UPDATE noor_r386_g1_txlab.sessions SET revoked_at_epoch_ms=1000
  WHERE account_id='synthetic-g1-account-a';
 UPDATE noor_r386_g1_txlab.grants SET revoked=true
  WHERE account_id='synthetic-g1-account-a';
 INSERT INTO noor_r386_g1_txlab.erased_owners VALUES(a);
 DELETE FROM noor_r386_g1_txlab.linkage WHERE account_id='synthetic-g1-account-a';
 IF NOT noor_r386_candidate.s3_erase_owner(a) THEN
  RAISE EXCEPTION 'R386_G1_ERASE_NOT_CONFIRMED'; END IF;
 SELECT
  (SELECT count(*) FROM noor_r386_lab.synthetic_source WHERE owner_id=a)+
  (SELECT count(*) FROM noor_r386_candidate.s3_enrollment WHERE owner_id=a)+
  (SELECT count(*) FROM noor_r386_candidate.owner_scope WHERE owner_id=a)+
  (SELECT count(*) FROM noor_r386_candidate.event_history WHERE owner_id=a)+
  (SELECT count(*) FROM noor_r386_candidate.delivery_outbox WHERE owner_id=a)+
  (SELECT count(*) FROM noor_r386_candidate.command_receipt WHERE owner_id=a)+
  (SELECT count(*) FROM noor_r386_candidate.checkpoint WHERE owner_id=a)+
  (SELECT count(*) FROM noor_r386_candidate.s4_fact WHERE owner_id=a)
 INTO total;
 IF total<>0 THEN RAISE EXCEPTION 'R386_G1_OWNER_RESIDUAL_DATA'; END IF;
 IF (SELECT count(*) FROM noor_r386_g1_txlab.sessions
     WHERE account_id='synthetic-g1-account-a' AND revoked_at_epoch_ms IS NOT NULL)<>3
 OR EXISTS(SELECT 1 FROM noor_r386_g1_txlab.linkage WHERE owner_id=a)
 OR NOT EXISTS(SELECT 1 FROM noor_r386_g1_txlab.erased_owners WHERE owner_id=a)
 THEN RAISE EXCEPTION 'R386_G1_ERASURE_AUTH_PROVENANCE'; END IF;
 FOR total IN 1..2 LOOP
  BEGIN
   PERFORM noor_r386_g1_txlab.resolve_owner(
    CASE WHEN total=1 THEN 'synthetic-a-phone' ELSE 'synthetic-a-desktop' END,1000);
   RAISE EXCEPTION 'R386_G1_STALE_SESSION_ALLOWED';
  EXCEPTION WHEN OTHERS THEN
   GET STACKED DIAGNOSTICS failure=MESSAGE_TEXT;
   IF failure<>'R386_G1_SESSION_OR_OWNER_DENIED' THEN RAISE; END IF;
  END;
 END LOOP;
 RAISE NOTICE 'R386_G1_MULTI_DEVICE_PERMANENT_ERASURE_PASS';

 -- Tombstone prevents a newly created account from reusing the erased owner.
 BEGIN
  INSERT INTO noor_r386_g1_txlab.linkage(account_id,owner_id)
  VALUES ('synthetic-account-reassignment',a);
  RAISE EXCEPTION 'R386_G1_REISSUE_UNEXPECTEDLY_ALLOWED';
 EXCEPTION WHEN OTHERS THEN
  GET STACKED DIAGNOSTICS failure=MESSAGE_TEXT;
  IF failure<>'R386_G1_OWNER_REISSUE_DENIED' THEN RAISE; END IF;
 END;
 IF noor_r386_g1_txlab.resolve_owner('synthetic-b-phone',1000)<>b
 OR NOT EXISTS(SELECT 1 FROM noor_r386_lab.synthetic_source WHERE owner_id=b)
 OR NOT EXISTS(SELECT 1 FROM noor_r386_candidate.command_receipt WHERE owner_id=b)
 OR NOT EXISTS(SELECT 1 FROM noor_r386_candidate.s4_fact WHERE owner_id=b)
 THEN RAISE EXCEPTION 'R386_G1_OTHER_OWNER_AFFECTED'; END IF;
 RAISE NOTICE 'R386_G1_OWNER_NONREUSE_AND_ISOLATION_PASS';

 -- Soft administrative disable must retain data and deny new access.
 UPDATE noor_r386_g1_txlab.linkage SET enabled=false WHERE account_id='synthetic-g1-account-b';
 UPDATE noor_r386_g1_txlab.sessions SET revoked_at_epoch_ms=1000
  WHERE account_id='synthetic-g1-account-b';
 BEGIN
  PERFORM noor_r386_g1_txlab.resolve_owner('synthetic-b-phone',1000);
  RAISE EXCEPTION 'R386_G1_DISABLED_ACCOUNT_ALLOWED';
 EXCEPTION WHEN OTHERS THEN
  GET STACKED DIAGNOSTICS failure=MESSAGE_TEXT;
  IF failure<>'R386_G1_SESSION_OR_OWNER_DENIED' THEN RAISE; END IF;
 END;
 IF NOT EXISTS(SELECT 1 FROM noor_r386_candidate.owner_scope WHERE owner_id=b)
 OR NOT EXISTS(SELECT 1 FROM noor_r386_candidate.command_receipt WHERE owner_id=b)
 THEN RAISE EXCEPTION 'R386_G1_SOFT_DELETE_ERASED_DATA'; END IF;
 RAISE NOTICE 'R386_G1_SOFT_DELETE_RETAIN_DATA_PASS';
END $$;
-- All fictional rows, roles, functions and the lab schema disappear here.
ROLLBACK;
SELECT 'R386_G1_MULTIDEVICE_SQL_LIFECYCLE_PASS';
