-- Reviewable R386 deployment-candidate extension. No automatic enrollment.
CREATE FUNCTION noor_r386_candidate.g234_session_cohort(p_session text,p_owner text)
RETURNS boolean LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 IF noor_r386_candidate.g1_assert_committable_noor_owner(p_session,p_owner) IS DISTINCT FROM p_owner
 THEN RAISE EXCEPTION 'R386_COHORT_OWNER_DENIED'; END IF;
 RETURN EXISTS(SELECT 1 FROM noor_r386_candidate.s3_enrollment WHERE owner_id=p_owner AND (shadow_enabled OR rollback_only));
END $$;
CREATE FUNCTION noor_r386_candidate.g234_scheduler_cohort(p_owner text)
RETURNS boolean LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 IF p_owner IS NULL OR p_owner !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
 THEN RAISE EXCEPTION 'R386_COHORT_OWNER_DENIED'; END IF;
 PERFORM pg_advisory_xact_lock(386017,hashtext(p_owner));
 IF EXISTS(SELECT 1 FROM noor_r386_candidate.g1_owner_erasure_tombstone WHERE owner_id=p_owner)
 THEN RAISE EXCEPTION 'R386_COHORT_ERASED_OWNER'; END IF;
 RETURN EXISTS(SELECT 1 FROM noor_r386_candidate.s3_enrollment WHERE owner_id=p_owner AND (shadow_enabled OR rollback_only));
END $$;
REVOKE ALL ON FUNCTION noor_r386_candidate.g234_session_cohort(text,text),noor_r386_candidate.g234_scheduler_cohort(text)
 FROM PUBLIC,anon,authenticated,service_role,noor_r386_g1_writer,noor_r386_g234_scheduler;
GRANT CREATE ON SCHEMA noor_r386_candidate TO noor_r386_g1_guard;
ALTER FUNCTION noor_r386_candidate.g234_session_cohort(text,text) OWNER TO noor_r386_g1_guard;
ALTER FUNCTION noor_r386_candidate.g234_scheduler_cohort(text) OWNER TO noor_r386_g1_guard;
REVOKE CREATE ON SCHEMA noor_r386_candidate FROM noor_r386_g1_guard;
GRANT EXECUTE ON FUNCTION noor_r386_candidate.g234_session_cohort(text,text) TO noor_r386_g1_writer;
GRANT EXECUTE ON FUNCTION noor_r386_candidate.g234_scheduler_cohort(text) TO noor_r386_g234_scheduler;
-- Return only readiness and key IDs, never receipts or owner data.
CREATE FUNCTION noor_r386_candidate.g234_runtime_readiness()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT jsonb_build_object('active',(SELECT active FROM noor_r386_candidate.g234_session_binding_state WHERE singleton),
 'keyIds',coalesce((SELECT jsonb_agg(key_id ORDER BY key_id) FROM (SELECT DISTINCT key_id FROM noor_r386_candidate.command_receipt) k),'[]'::jsonb))
$$;
REVOKE ALL ON FUNCTION noor_r386_candidate.g234_runtime_readiness() FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION noor_r386_candidate.g234_runtime_readiness() TO noor_r386_g1_writer,noor_r386_g234_scheduler;

-- Manual operator enrollment after verified bounded backfill. One owner only.
CREATE FUNCTION noor_r386_candidate.g234_enroll_verified(p_owner text,p_revision bigint)
RETURNS boolean LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path=pg_catalog AS $$
DECLARE source record; cp record;
BEGIN
 IF current_user<>'postgres' OR current_setting('transaction_isolation')<>'read committed'
 OR p_owner IS NULL OR p_owner !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
 OR p_revision IS NULL OR p_revision<0
 THEN RAISE EXCEPTION 'R386_COHORT_ENROLLMENT_DENIED'; END IF;
 PERFORM pg_advisory_xact_lock(386017,hashtext(p_owner));
 IF NOT EXISTS(SELECT 1 FROM noor_r386_candidate.g234_session_binding_state WHERE singleton AND active)
 OR NOT EXISTS(SELECT 1 FROM noor_r386_candidate.g234_scope WHERE owner_id=p_owner)
 OR EXISTS(SELECT 1 FROM noor_r386_candidate.g1_owner_erasure_tombstone WHERE owner_id=p_owner)
 OR EXISTS(SELECT 1 FROM noor_r386_candidate.s3_enrollment WHERE owner_id=p_owner)
 OR NOT EXISTS(SELECT 1 FROM public.noor_authentication_account_linkages l JOIN public.noor_entitlement_grants g ON g.account_id=l.account_id
  WHERE l.user_id=p_owner::uuid AND l.subject=p_owner AND g.action='access' AND g.resource_type='application' AND g.resource_id='noor-personal' AND g.revoked_at_epoch_ms IS NULL AND g.granted_at_epoch_ms<=extract(epoch from clock_timestamp())*1000)
 THEN RAISE EXCEPTION 'R386_COHORT_ENROLLMENT_DENIED'; END IF;
 PERFORM noor_r386_candidate.g234_assert_active_auth_owner(p_owner::uuid);
 SELECT revision,state INTO source FROM public.noor_personal_foundations WHERE user_id=p_owner AND schema_version=1 FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'R386_COHORT_SOURCE_REQUIRED'; END IF;
 SELECT * INTO cp FROM noor_r386_candidate.checkpoint WHERE owner_id=p_owner;
 IF NOT FOUND OR NOT cp.verified OR cp.source_revision<>source.revision OR source.revision<>p_revision
 OR cp.source_digest IS DISTINCT FROM sha256(convert_to((source.state->'outbox')::text,'UTF8'))
 THEN RAISE EXCEPTION 'R386_COHORT_BACKFILL_REQUIRED'; END IF;
 PERFORM noor_r386_candidate.s3_matches(p_owner,source.state->'outbox');
 INSERT INTO noor_r386_candidate.s3_enrollment(owner_id,shadow_enabled) VALUES(p_owner,true);
 RETURN true;
END $$;
REVOKE ALL ON FUNCTION noor_r386_candidate.g234_enroll_verified(text,bigint) FROM PUBLIC,anon,authenticated,service_role,noor_r386_g1_writer,noor_r386_g234_scheduler;
