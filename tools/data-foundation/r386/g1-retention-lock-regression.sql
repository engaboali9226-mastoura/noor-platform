-- Run after G1 retention-lock installation, on an isolated, disposable database.
BEGIN;
INSERT INTO noor_r386_candidate.owner_scope(owner_id) VALUES('synthetic-r386-g1-retention');
INSERT INTO noor_r386_candidate.command_receipt
 (owner_id,request_id,key_id,digest,committed_revision,committed_at,retain_until)
VALUES ('synthetic-r386-g1-retention','synthetic-request','synthetic-key',decode(repeat('ab',32),'hex'),0,
 clock_timestamp(),'9999-12-31 00:00:00+00');
DO $$
DECLARE message text;
BEGIN
 BEGIN
  PERFORM noor_r386_candidate.expire_receipts('synthetic-r386-g1-retention',clock_timestamp());
  RAISE EXCEPTION 'R386_G1_PURGE_UNEXPECTEDLY_ALLOWED';
 EXCEPTION WHEN OTHERS THEN
  GET STACKED DIAGNOSTICS message=MESSAGE_TEXT;
  IF message<>'R386_G1_RECEIPT_PURGE_FORBIDDEN' THEN RAISE; END IF;
 END;
 IF (SELECT count(*) FROM noor_r386_candidate.command_receipt
       WHERE owner_id='synthetic-r386-g1-retention' AND request_id='synthetic-request')<>1
 THEN RAISE EXCEPTION 'R386_G1_RECEIPT_LOST'; END IF;
END $$;
SELECT 'R386_G1_RECEIPT_RETENTION_LOCK_PASS';
ROLLBACK;
