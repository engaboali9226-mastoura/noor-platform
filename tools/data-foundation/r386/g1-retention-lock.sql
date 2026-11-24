-- G1 isolated candidate: an unconditional fail-closed lock on receipt expiry.
-- Load ONLY after S1 regression in the disposable synthetic database.
-- This is not part of production migrations. It does not erase any rows.
CREATE OR REPLACE FUNCTION noor_r386_candidate.expire_receipts(p_owner text,p_cutoff timestamptz)
RETURNS bigint LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $$
BEGIN
 RAISE EXCEPTION 'R386_G1_RECEIPT_PURGE_FORBIDDEN';
END $$;
REVOKE ALL ON FUNCTION noor_r386_candidate.expire_receipts(text,timestamptz)
 FROM PUBLIC,anon,authenticated,service_role;
