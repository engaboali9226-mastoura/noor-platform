-- R386 V4 function-only apply; explicit reviewed operator use only.
-- Preserves source, receipts, enrollment, roles and ACLs.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '20s';
DO $guard$ DECLARE c integer; BEGIN
 SELECT count(*) INTO c FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='noor_r386_candidate' AND (
 (p.proname='s3_commit' AND md5(p.prosrc)='01f275f54650151b887820d9f85928d0' AND pg_get_userbyid(p.proowner)='noor_r386_s3_tx' AND p.prosecdef=true AND p.provolatile='v' AND p.proconfig=ARRAY['search_path=pg_catalog'] AND p.proacl::text='{noor_r386_s3_tx=X/noor_r386_s3_tx,noor_r386_s3_executor=X/noor_r386_s3_tx,noor_r386_g1_guard=X/noor_r386_s3_tx}') OR
 (p.proname='s3_matches' AND md5(p.prosrc)='5f9da1bf6b9950fbb5313f64652a476f' AND pg_get_userbyid(p.proowner)='postgres' AND p.prosecdef=false AND p.provolatile='v' AND p.proconfig=ARRAY['search_path=pg_catalog'] AND p.proacl::text='{postgres=X/postgres,noor_r386_s3_tx=X/postgres}') OR
 (p.proname='s4_extract' AND md5(p.prosrc)='65c2df617add5da7343d42f0c46628dd' AND pg_get_userbyid(p.proowner)='postgres' AND p.prosecdef=false AND p.provolatile='s' AND p.proconfig=ARRAY['search_path=pg_catalog'] AND p.proacl::text='{postgres=X/postgres,noor_r386_s3_tx=X/postgres}') OR
 (p.proname='s4_capture' AND md5(p.prosrc)='aceb83605b83a21bf6d2353121ba2b48' AND pg_get_userbyid(p.proowner)='postgres' AND p.prosecdef=false AND p.provolatile='v' AND p.proconfig=ARRAY['search_path=pg_catalog'] AND p.proacl::text='{postgres=X/postgres,noor_r386_s3_tx=X/postgres}'));
 IF c<>4 THEN RAISE EXCEPTION 'R386_V4_PIN_MISMATCH'; END IF;
END $guard$;

CREATE OR REPLACE FUNCTION noor_r386_candidate.s3_commit(
 p_owner text,p_request text,p_expected_exists boolean,p_expected_revision bigint,
 p_before jsonb,p_after jsonb,p_key_id text,p_digest text,p_fingerprints jsonb,
 p_delete_refs text[] DEFAULT ARRAY[]::text[])
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE enrollment noor_r386_candidate.s3_enrollment%ROWTYPE;
 prior noor_r386_candidate.command_receipt%ROWTYPE;
 cp noor_r386_candidate.checkpoint%ROWTYPE;
 v_exists boolean; v_revision bigint; v_state jsonb; v_next bigint;
 v_empty constant jsonb:='{"historicalEvents":[],"notificationHistory":[],"fridayMosqueVisits":[],"locations":[],"prayerPolicies":[],"personalDays":[],"islamicContexts":[],"definitions":[],"dailyExecution":[],"outbox":[]}'::jsonb;
 v_changed boolean; v_time timestamptz;
 v_before_events jsonb; v_after_events jsonb; v_after_ids jsonb;
BEGIN
 IF NOT noor_r386_candidate.valid_id(p_owner) OR NOT EXISTS(SELECT 1 FROM noor_r386_candidate.g234_scope WHERE owner_id=p_owner)
 OR p_request IS NULL OR p_request !~ '^[A-Za-z0-9_-]{1,128}$'
 OR p_key_id IS NULL OR p_key_id !~ '^[A-Za-z0-9_-]{1,128}$'
 OR p_digest IS NULL OR p_digest !~ '^[0-9a-f]{64}$'
 OR p_expected_exists IS NULL OR p_expected_revision IS NULL
 OR p_expected_revision NOT BETWEEN 0 AND 9007199254740991
 OR (NOT p_expected_exists AND p_expected_revision<>0)
 OR jsonb_typeof(p_fingerprints) IS DISTINCT FROM 'object'
 OR p_delete_refs IS NULL
 THEN RAISE EXCEPTION 'R386_S3_INPUT'; END IF;
 IF (SELECT count(*) FROM jsonb_each(p_fingerprints)) NOT BETWEEN 1 AND 8
 OR p_fingerprints->>p_key_id IS DISTINCT FROM p_digest
 OR EXISTS(SELECT 1 FROM jsonb_each(p_fingerprints) f WHERE f.key !~ '^[A-Za-z0-9_-]{1,128}$'
 OR jsonb_typeof(f.value)<>'string' OR (f.value#>>'{}') !~ '^[0-9a-f]{64}$')
 OR EXISTS(SELECT 1 FROM unnest(p_delete_refs) x WHERE NOT noor_r386_candidate.valid_id(x))
 THEN RAISE EXCEPTION 'R386_S3_INPUT'; END IF;

 -- Enrollment serializes first insert and absent-state receipts. Source lock
 -- precedes candidate owner lock, preserving S2 lock order.
 SELECT * INTO enrollment FROM noor_r386_candidate.s3_enrollment WHERE owner_id=p_owner FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'R386_S3_NOT_ENROLLED'; END IF;
 SELECT revision,state INTO v_revision,v_state FROM public.noor_personal_foundations WHERE user_id=p_owner FOR UPDATE;
 v_exists:=FOUND;
 IF NOT v_exists THEN v_revision:=0; v_state:=v_empty; END IF;
 PERFORM 1 FROM noor_r386_candidate.owner_scope WHERE owner_id=p_owner FOR UPDATE;
 SELECT * INTO prior FROM noor_r386_candidate.command_receipt WHERE owner_id=p_owner AND request_id=p_request;
 IF FOUND THEN
  IF NOT(p_fingerprints ? prior.key_id) THEN RAISE EXCEPTION 'R386_RECEIPT_KEY_UNAVAILABLE'; END IF;
  IF encode(prior.digest,'hex') IS DISTINCT FROM p_fingerprints->>prior.key_id THEN RAISE EXCEPTION 'R386_RECEIPT_COLLISION'; END IF;
  RETURN jsonb_build_object('kind','replay','receipt',jsonb_build_object('keyId',prior.key_id,'digest',encode(prior.digest,'hex'),'revision',prior.committed_revision));
 END IF;
 IF NOT enrollment.shadow_enabled AND NOT enrollment.rollback_only THEN RAISE EXCEPTION 'R386_S3_SHADOW_DISABLED'; END IF;
 IF v_exists IS DISTINCT FROM p_expected_exists OR v_revision IS DISTINCT FROM p_expected_revision
 OR v_state IS DISTINCT FROM p_before THEN RETURN '{"kind":"conflict"}'::jsonb; END IF;
 IF jsonb_typeof(p_after) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'R386_S3_STATE'; END IF;
 v_before_events:=v_state->'outbox'; v_after_events:=p_after->'outbox';
 PERFORM noor_r386_candidate.s2_validate(p_owner,v_after_events);
 SELECT coalesce(jsonb_object_agg(n->>'id',true),'{}'::jsonb) INTO v_after_ids FROM jsonb_array_elements(v_after_events) y(n);
 -- First integration of an existing source requires the completed S2 copy.
 -- After integration, reject legacy writes/drift rather than silently overwrite.
 IF NOT enrollment.rollback_only THEN
 IF enrollment.last_revision IS NULL AND v_exists THEN
  SELECT * INTO cp FROM noor_r386_candidate.checkpoint WHERE owner_id=p_owner;
  IF NOT FOUND OR NOT cp.verified OR cp.source_revision<>v_revision OR cp.source_digest IS DISTINCT FROM sha256(convert_to((v_state->'outbox')::text,'UTF8'))
  THEN RAISE EXCEPTION 'R386_S3_BACKFILL_REQUIRED'; END IF;
 ELSIF enrollment.last_revision IS NOT NULL AND enrollment.last_revision<>v_revision
 THEN RAISE EXCEPTION 'R386_S3_LEGACY_DRIFT'; END IF;
 PERFORM noor_r386_candidate.s3_matches(p_owner,v_state->'outbox');
 END IF;

 -- Erasure refs are server-derived pre-deletion IDs, never client input.
 -- Require all and only matching events removed; reject key reuse or
 -- immutable content change even when mutable delivery state changes.
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(v_before_events) x(e)
 WHERE ((v_after_ids ? (e->>'id')) IS NOT TRUE) IS DISTINCT FROM
 (e->>'aggregateId'=ANY(p_delete_refs) OR EXISTS(SELECT 1 FROM jsonb_each(e->'payload') f
 WHERE jsonb_typeof(f.value)='string' AND (f.value#>>'{}')=ANY(p_delete_refs))))
 THEN RAISE EXCEPTION 'R386_S3_ERASURE_SCOPE'; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(v_after_events) x(e)
 WHERE e->>'aggregateId'=ANY(p_delete_refs) OR EXISTS(SELECT 1 FROM jsonb_each(e->'payload') f
 WHERE jsonb_typeof(f.value)='string' AND (f.value#>>'{}')=ANY(p_delete_refs)))
 THEN RAISE EXCEPTION 'R386_S3_ERASURE_SCOPE'; END IF;
 -- s2_validate above has already proved unique, non-null event IDs and keys.
 -- Build both maps once; preserve the original OR-match rejection semantics.
 IF EXISTS(WITH maps AS MATERIALIZED (
  SELECT coalesce(jsonb_object_agg(n->>'id',n-'deliveryState'),'{}'::jsonb) AS by_id,
   coalesce(jsonb_object_agg(n->>'idempotencyKey',n-'deliveryState'),'{}'::jsonb) AS by_key
  FROM jsonb_array_elements(v_after_events) y(n))
 SELECT 1 FROM jsonb_array_elements(v_before_events) x(e) CROSS JOIN maps
 WHERE ((by_id ? (e->>'id')) AND (e-'deliveryState') IS DISTINCT FROM by_id->(e->>'id'))
 OR ((by_key ? (e->>'idempotencyKey')) AND (e-'deliveryState') IS DISTINCT FROM by_key->(e->>'idempotencyKey')))
 THEN RAISE EXCEPTION 'R386_S3_IMMUTABLE_EVENT'; END IF;

 v_changed:=v_state IS DISTINCT FROM p_after;
 v_next:=v_revision+CASE WHEN v_changed THEN 1 ELSE 0 END;
 IF v_next>9007199254740991 THEN RAISE EXCEPTION 'R386_S3_REVISION_OVERFLOW'; END IF;
 INSERT INTO noor_r386_candidate.owner_scope VALUES(p_owner) ON CONFLICT DO NOTHING;
 IF v_changed THEN
  IF v_exists THEN UPDATE public.noor_personal_foundations SET revision=v_next,state=p_after,updated_at=clock_timestamp() WHERE user_id=p_owner AND schema_version=1;
  ELSE INSERT INTO public.noor_personal_foundations(user_id,schema_version,revision,state,updated_at) VALUES(p_owner,1,v_next,p_after,clock_timestamp()); END IF;
  IF NOT enrollment.rollback_only THEN
  DELETE FROM noor_r386_candidate.event_history h WHERE owner_id=p_owner
  AND NOT (v_after_ids ? h.event_id);
  INSERT INTO noor_r386_candidate.event_history(owner_id,event_id,event_key,first_seen_revision,record)
  SELECT p_owner,e->>'id',e->>'idempotencyKey',v_next,e-'deliveryState'
  FROM jsonb_array_elements(v_after_events) x(e)
  WHERE NOT EXISTS(SELECT 1 FROM noor_r386_candidate.event_history h WHERE h.owner_id=p_owner AND h.event_id=e->>'id');
  INSERT INTO noor_r386_candidate.delivery_outbox(owner_id,event_id,state)
  SELECT p_owner,e->>'id',e->>'deliveryState' FROM jsonb_array_elements(v_after_events) x(e)
  ON CONFLICT(owner_id,event_id) DO UPDATE SET state=excluded.state
  WHERE noor_r386_candidate.delivery_outbox.state IS DISTINCT FROM excluded.state;
  ELSIF cardinality(p_delete_refs)>0 THEN
   -- A paused shadow may retain historical copies not in the current source.
   -- Authorized privacy erasure must still remove matching retained copies.
   PERFORM noor_r386_candidate.erase_references(p_owner,p_delete_refs);
  END IF;
 END IF;
 IF NOT enrollment.rollback_only THEN
  PERFORM noor_r386_candidate.s3_matches(p_owner,v_after_events);
 END IF;
 -- Retire pre-integration cursor, not source. Retain receipts indefinitely
 -- until a replay horizon and late-ID rejection are approved.
 DELETE FROM noor_r386_candidate.checkpoint WHERE owner_id=p_owner;
 IF NOT enrollment.rollback_only THEN
  UPDATE noor_r386_candidate.s3_enrollment SET last_revision=v_next WHERE owner_id=p_owner;
 END IF;
 v_time:=clock_timestamp();
 INSERT INTO noor_r386_candidate.command_receipt VALUES(p_owner,p_request,p_key_id,decode(p_digest,'hex'),v_next,v_time,'9999-12-31 00:00:00+00');
 RETURN jsonb_build_object('kind','committed','receipt',jsonb_build_object('keyId',p_key_id,'digest',p_digest,'revision',v_next));
END $$;

CREATE OR REPLACE FUNCTION noor_r386_candidate.s3_matches(p_owner text,p_events jsonb)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $$
DECLARE expected_history jsonb; expected_delivery jsonb;
 actual_history jsonb; actual_delivery jsonb; history_count bigint; delivery_count bigint;
BEGIN
 PERFORM noor_r386_candidate.s2_validate(p_owner,p_events);
 SELECT coalesce(jsonb_object_agg(e->>'id',jsonb_build_array(e->>'idempotencyKey',e-'deliveryState')),'{}'::jsonb),
        coalesce(jsonb_object_agg(e->>'id',to_jsonb(e->>'deliveryState')),'{}'::jsonb)
 INTO expected_history,expected_delivery FROM jsonb_array_elements(p_events) x(e);
 SELECT count(*),coalesce(jsonb_object_agg(h.event_id,jsonb_build_array(h.event_key,h.record)),'{}'::jsonb)
 INTO history_count,actual_history FROM noor_r386_candidate.event_history h WHERE h.owner_id=p_owner;
 SELECT count(*),coalesce(jsonb_object_agg(d.event_id,to_jsonb(d.state)),'{}'::jsonb)
 INTO delivery_count,actual_delivery FROM noor_r386_candidate.delivery_outbox d WHERE d.owner_id=p_owner;
 IF history_count<>jsonb_array_length(p_events) OR delivery_count<>jsonb_array_length(p_events)
 OR actual_history IS DISTINCT FROM expected_history OR actual_delivery IS DISTINCT FROM expected_delivery
 THEN RAISE EXCEPTION 'R386_S3_SHADOW_DRIFT'; END IF;
END $$;

CREATE OR REPLACE FUNCTION noor_r386_candidate.s4_extract(p_owner text,p_state jsonb)
RETURNS TABLE(fact_kind text,entity_id text,sub_id text,definition_id text,record jsonb)
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path=pg_catalog AS $$
DECLARE e jsonb; d jsonb; day jsonb; a jsonb; session jsonb; pol jsonb; prayer jsonb; context jsonb; mapping record; k text;
 due text; zone text; performed text; recovery text; kind text; status text; w numeric; ver numeric; mode text; timing text;
 policy_id text; share_matrix jsonb; idx jsonb;
 defs jsonb; execs jsonb; days jsonb; contexts jsonb; defmap jsonb; execmap jsonb; daymap jsonb;
 zone_cache jsonb:='{}'::jsonb; zone_key text;
BEGIN
 defs:=p_state->'definitions'; execs:=p_state->'dailyExecution'; days:=p_state->'personalDays'; contexts:=p_state->'islamicContexts';
 IF jsonb_typeof(defs) IS DISTINCT FROM 'array'
 OR jsonb_typeof(execs) IS DISTINCT FROM 'array'
 OR jsonb_typeof(days) IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'R386_S4_COLLECTION'; END IF;
 IF EXISTS(SELECT 1 FROM (
 SELECT value e FROM jsonb_array_elements(defs)
 UNION ALL SELECT value FROM jsonb_array_elements(execs)
 UNION ALL SELECT value FROM jsonb_array_elements(days)) allrows
 WHERE jsonb_typeof(allrows.e) IS DISTINCT FROM 'object' OR allrows.e->>'userId' IS DISTINCT FROM p_owner
 OR NOT noor_r386_candidate.valid_id(allrows.e->>'id') OR jsonb_typeof(allrows.e->'id') IS DISTINCT FROM 'string')
 THEN RAISE EXCEPTION 'R386_S4_OWNER'; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(defs) q(v) GROUP BY (v->>'id') COLLATE "C" HAVING count(*)>1)
 OR EXISTS(SELECT 1 FROM jsonb_array_elements(execs) q(v) GROUP BY (v->>'id') COLLATE "C" HAVING count(*)>1)
 OR EXISTS(SELECT 1 FROM jsonb_array_elements(days) q(v) GROUP BY (v->>'id') COLLATE "C" HAVING count(*)>1)
 THEN RAISE EXCEPTION 'R386_S4_DUPLICATE'; END IF;
 -- Only build the maps after the existing shape, owner and duplicate checks.
 SELECT coalesce(jsonb_object_agg(value->>'id',value),'{}'::jsonb) INTO defmap FROM jsonb_array_elements(defs);
 SELECT coalesce(jsonb_object_agg(value->>'id',value),'{}'::jsonb) INTO execmap FROM jsonb_array_elements(execs);
 SELECT coalesce(jsonb_object_agg(value->>'id',value),'{}'::jsonb) INTO daymap FROM jsonb_array_elements(days);
 FOR e IN SELECT value FROM jsonb_array_elements(execs) LOOP
  d:=defmap->(e->>'definitionId');
  IF d IS NULL OR d->>'kind' IS DISTINCT FROM e->>'kind' THEN RAISE EXCEPTION 'R386_S4_DEFINITION_LINK'; END IF;
  day:=daymap->(e->>'personalDayId');
  IF day IS NULL THEN RAISE EXCEPTION 'R386_S4_DAY_LINK'; END IF;
  due:=noor_r386_candidate.s4_date(e->'scheduleOccurrenceKey');
  IF due IS DISTINCT FROM noor_r386_candidate.s4_date(day->'boundary'->'localDate') THEN RAISE EXCEPTION 'R386_S4_DAY_LINK'; END IF;
  zone_key:=(day->'boundary'->'timeZone')::text;
  IF zone_cache ? zone_key THEN zone:=zone_cache->>zone_key;
  ELSE zone:=noor_r386_candidate.s4_zone(day->'boundary'->'timeZone'); zone_cache:=zone_cache||jsonb_build_object(zone_key,zone); END IF;
  performed:=noor_r386_candidate.s4_date(e->'completionDateR367',false);
  recovery:=noor_r386_candidate.s4_date(e->'recoveredOnR331',false);
  kind:=e->>'kind'; status:=e->>'status';
  IF kind IS NULL OR kind NOT IN ('Habit','Task') OR status IS NULL OR status NOT IN ('Planned','InProgress','Pending','Completed','Deferred','Cancelled','Skipped','Missed','Suppressed')
  THEN RAISE EXCEPTION 'R386_S4_STATUS'; END IF;
  w:=noor_r386_candidate.s4_number(e->'eligibility'->'weight',0,9007199254740991,false);
  IF w=0 THEN RAISE EXCEPTION 'R386_S4_WEIGHT'; END IF;
  ver:=noor_r386_candidate.s4_number(e->'version',1,9007199254740991);
  IF ver<>trunc(ver) THEN RAISE EXCEPTION 'R386_S4_VERSION'; END IF;
  fact_kind:='execution'; entity_id:=noor_r386_candidate.s4_id(e->'id'); sub_id:='-'; definition_id:=noor_r386_candidate.s4_id(e->'definitionId');
  record:=jsonb_build_object('executionVersion',ver,'definitionRevisionId',noor_r386_candidate.s4_id(e->'definitionRevisionId'),
   'eligibilityRevisionId',noor_r386_candidate.s4_id(e->'eligibility'->'definitionRevisionId',false),
   'dayId',noor_r386_candidate.s4_id(e->'personalDayId'),'dueDate',due,'dueTimeZone',zone,'kind',kind,'status',status,
   'performedDate',performed,'performedTimeZone',NULL,'legacyRecoveryDate',recovery,
   'performanceSource',CASE WHEN performed IS NOT NULL THEN 'completionDateR367' ELSE 'Unknown' END,
   'observedEligibilityWeight',w,'weightSource',CASE WHEN w IS NULL THEN 'Unknown' ELSE 'ExecutionEligibilityObserved' END,
   'historicalWeight',NULL,'historicalPolicyVersion',NULL,'policySource','CurrentEvaluatorObserved','scoringPolicyVersion',CASE WHEN d?'sessionPlan' THEN 'SessionR285R286' WHEN performed IS NOT NULL THEN 'R367' WHEN recovery IS NOT NULL THEN 'R331' ELSE 'R331Normal' END,
   'nonAchievement',d?'beveragePlan' OR coalesce(d->'countdownPlan'->>'kind','task') IN ('event','appointment'),
   'sessionPlanObserved',d?'sessionPlan');
  RETURN NEXT;
 END LOOP;
 FOR d IN SELECT value FROM jsonb_array_elements(defs) LOOP
  IF d?'activityLog' AND jsonb_typeof(d->'activityLog') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'R386_S4_ACTIVITY'; END IF;
  FOR a IN SELECT value FROM jsonb_array_elements(coalesce(d->'activityLog','[]'::jsonb)) LOOP
   e:=execmap->(a->>'executionId');
   IF e IS NULL OR e->>'definitionId' IS DISTINCT FROM d->>'id' THEN RAISE EXCEPTION 'R386_S4_ACTIVITY_LINK'; END IF;
   performed:=noor_r386_candidate.s4_date(a->'achievementDateR367',false);
   recovery:=noor_r386_candidate.s4_date(a->'performedOnR331',false);
   IF a?'taskSessionId' AND d->>'kind'<>'Task' THEN RAISE EXCEPTION 'R386_S4_ACTIVITY_LINK'; END IF;
   fact_kind:='activity'; entity_id:=noor_r386_candidate.s4_id(a->'id'); sub_id:=noor_r386_candidate.s4_id(d->'id'); definition_id:=sub_id;
   record:=jsonb_build_object('executionId',noor_r386_candidate.s4_id(a->'executionId'),
    'sessionId',noor_r386_candidate.s4_id(a->'taskSessionId',false),'dueDate',noor_r386_candidate.s4_date(e->'scheduleOccurrenceKey'),
    'activityLocalDate',noor_r386_candidate.s4_date(a->'localDate'),'recordedAt',noor_r386_candidate.s4_instant(a->'at'),
    'performedDate',performed,'performedTimeZone',NULL,'legacyRecoveryDate',recovery,
    'performanceSource',CASE WHEN performed IS NULL THEN 'Unknown' ELSE 'achievementDateR367' END,
    'recordedSessionDayCredit',noor_r386_candidate.s4_number(a->'sessionDayCredit',0,1,false),
    'recordedSessionAchievementShare',noor_r386_candidate.s4_number(a->'sessionAchievementShare',0,1,false),
    'scoringPolicyVersion',CASE WHEN a?'taskSessionId' THEN CASE WHEN performed IS NOT NULL THEN 'SessionR367' WHEN recovery IS NOT NULL THEN 'SessionR331' ELSE 'SessionR285R286' END ELSE NULL END);
   RETURN NEXT;
  END LOOP;
  IF d?'sessionPlan' AND jsonb_typeof(d->'sessionPlan'->'sessions') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'R386_S4_SESSION'; END IF;
  FOR session IN SELECT value FROM jsonb_array_elements(coalesce(d->'sessionPlan'->'sessions','[]'::jsonb)) LOOP
   IF d->>'kind'<>'Task' THEN RAISE EXCEPTION 'R386_S4_SESSION'; END IF;
   fact_kind:='session'; entity_id:=noor_r386_candidate.s4_id(session->'id'); sub_id:=noor_r386_candidate.s4_id(d->'id'); definition_id:=sub_id;
   record:=jsonb_build_object('definitionRevisionId',noor_r386_candidate.s4_id(d->'revisionId'),
    'scheduledDate',noor_r386_candidate.s4_date(session->'scheduledDate',false),
    'target',noor_r386_candidate.s4_number(session->'target',0,1000000000,false),
    'recordedCompletedAt',noor_r386_candidate.s4_instant(session->'completedAt',false),
    'sessionRevision',noor_r386_candidate.s4_number(session->'revision',0,9007199254740991),
    'scoringPolicyVersion','SessionR285R286');
   RETURN NEXT;
  END LOOP;
 END LOOP;
 FOR day IN SELECT value FROM jsonb_array_elements(days) LOOP
  due:=noor_r386_candidate.s4_date(day->'boundary'->'localDate');
  zone_key:=(day->'boundary'->'timeZone')::text;
  IF zone_cache ? zone_key THEN zone:=zone_cache->>zone_key;
  ELSE zone:=noor_r386_candidate.s4_zone(day->'boundary'->'timeZone'); zone_cache:=zone_cache||jsonb_build_object(zone_key,zone); END IF;
  pol:=day->'prayerScoreSnapshotR334'; policy_id:=NULL; share_matrix:=NULL;
  context:=NULL;
  IF jsonb_typeof(contexts)='array' AND (SELECT count(*) FROM jsonb_array_elements(contexts) q(v) WHERE v->>'personalDayId'=day->>'id')=1 THEN
   SELECT v INTO context FROM jsonb_array_elements(contexts) q(v) WHERE v->>'personalDayId'=day->>'id' AND v->'prayerTimes'->>'localDate'=due;
  END IF;
  IF pol IS NOT NULL THEN
   policy_id:=noor_r386_candidate.s4_id(pol->'policyId');
   share_matrix:='{}'::jsonb;
   FOREACH mode IN ARRAY ARRAY['group','excused','unexcused'] LOOP
    idx:='{}'::jsonb;
    FOREACH timing IN ARRAY ARRAY['ontime','late'] LOOP
     idx:=idx||jsonb_build_object(timing,noor_r386_candidate.s4_number(pol->'shares'->mode->timing,0,1));
    END LOOP;
    share_matrix:=share_matrix||jsonb_build_object(mode,idx);
   END LOOP;
   FOREACH k IN ARRAY ARRAY['fajr','dhuhr','asr','maghrib','isha'] LOOP
    w:=noor_r386_candidate.s4_number(pol->'weights'->k,1,9007199254740991);
    IF w<>trunc(w) THEN RAISE EXCEPTION 'R386_S4_PRAYER_WEIGHT'; END IF;
    fact_kind:='prayer-policy'; entity_id:=noor_r386_candidate.s4_id(day->'id'); sub_id:=k; definition_id:=NULL;
    record:=jsonb_build_object('dueDate',due,'dueTimeZone',zone,'policyId',policy_id,
     'effectiveFromDate',noor_r386_candidate.s4_date(pol->'effectiveFromDate'),'weight',w,'shares',share_matrix,'scheduledAt',noor_r386_candidate.s4_instant(context->'prayerTimes'->k,false),'scoringPolicyVersion','R334');
    RETURN NEXT;
   END LOOP;
   IF jsonb_typeof(pol->'legacyHabitKeys') IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'R386_S4_PRAYER_ALIAS'; END IF;
   FOR mapping IN SELECT key,value FROM jsonb_each(pol->'legacyHabitKeys') LOOP
    IF jsonb_typeof(mapping.value)<>'string' OR (mapping.value#>>'{}') NOT IN ('fajr','dhuhr','asr','maghrib','isha')
    THEN RAISE EXCEPTION 'R386_S4_PRAYER_ALIAS'; END IF;
    -- A deleted definition may still be named by an old day policy. Never
    -- recreate a candidate reference after authorized definition deletion.
    IF NOT (defmap ? mapping.key) THEN CONTINUE; END IF;
    fact_kind:='prayer-alias'; entity_id:=noor_r386_candidate.s4_id(day->'id'); sub_id:=noor_r386_candidate.s4_id(to_jsonb(mapping.key)); definition_id:=sub_id;
    record:=jsonb_build_object('dueDate',due,'policyId',policy_id,'prayerKey',mapping.value,'scoringPolicyVersion','R334');
    RETURN NEXT;
   END LOOP;
  END IF;
  IF day?'prayerRecordsR331' AND jsonb_typeof(day->'prayerRecordsR331') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'R386_S4_PRAYER'; END IF;
  FOR prayer IN SELECT value FROM jsonb_array_elements(coalesce(day->'prayerRecordsR331','[]'::jsonb)) LOOP
   k:=prayer->>'key'; mode:=prayer->>'mode'; timing:=prayer->>'timing';
   IF k IS NULL OR k NOT IN ('fajr','dhuhr','asr','maghrib','isha') OR mode IS NULL OR mode NOT IN ('group','excused','unexcused')
   OR timing IS NULL OR timing NOT IN ('ontime','late') THEN RAISE EXCEPTION 'R386_S4_PRAYER'; END IF;
   fact_kind:='prayer-record'; entity_id:=noor_r386_candidate.s4_id(day->'id'); sub_id:=k; definition_id:=NULL;
   record:=jsonb_build_object('dueDate',due,'dueTimeZone',zone,'recordedAt',noor_r386_candidate.s4_instant(prayer->'recordedAt'),
    'performedDate',NULL,'performedTimeZone',NULL,'performanceSource','Unknown','policyId',policy_id,
    'recordedMode',mode,'recordedTiming',timing,'scoringPolicyVersion',CASE WHEN policy_id IS NOT NULL THEN 'R334' ELSE NULL END);
   RETURN NEXT;
  END LOOP;
 END LOOP;
END $$;

CREATE OR REPLACE FUNCTION noor_r386_candidate.s4_capture()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $$
DECLARE enabled boolean; rolled boolean; facts jsonb; prior_events jsonb:='[]'::jsonb;
 prior_ids jsonb; current_ids jsonb; fact_ids jsonb; current_events jsonb; current_days jsonb;
BEGIN
 IF current_user<>'noor_r386_s3_tx' THEN RETURN NEW; END IF;
 SELECT shadow_enabled,rollback_only INTO enabled,rolled FROM noor_r386_candidate.s3_enrollment WHERE owner_id=NEW.user_id;
 IF NOT FOUND OR (NOT enabled AND NOT rolled) THEN RAISE EXCEPTION 'R386_S4_SCOPE'; END IF;
 IF TG_OP='UPDATE' THEN
  prior_events:=OLD.state->'outbox';
  IF NEW.user_id IS DISTINCT FROM OLD.user_id OR NEW.revision<>OLD.revision+1 THEN RAISE EXCEPTION 'R386_S4_REVISION'; END IF;
 ELSIF NEW.revision<>1 THEN RAISE EXCEPTION 'R386_S4_REVISION'; END IF;
 -- In rollback do not capture or validate analytics. Still erase all historical
 -- facts whose owning source entity was deleted, including activity/prayer rows.
 -- No stale facts are served (there is no analytics endpoint).
 IF rolled THEN
  DELETE FROM noor_r386_candidate.s4_fact f WHERE f.owner_id=NEW.user_id AND (
   (f.definition_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(NEW.state->'definitions') d WHERE d->>'id'=f.definition_id))
   OR (f.fact_kind IN ('execution','execution-transition') AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(NEW.state->'dailyExecution') e WHERE e->>'id'=f.entity_id))
   OR (f.fact_kind='activity' AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(NEW.state->'definitions') d CROSS JOIN LATERAL jsonb_array_elements(coalesce(d->'activityLog','[]'::jsonb)) a WHERE d->>'id'=f.definition_id AND a->>'id'=f.entity_id))
   OR (f.fact_kind='session' AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(NEW.state->'definitions') d CROSS JOIN LATERAL jsonb_array_elements(coalesce(d->'sessionPlan'->'sessions','[]'::jsonb)) s WHERE d->>'id'=f.definition_id AND s->>'id'=f.entity_id))
   OR (f.fact_kind LIKE 'prayer-%' AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(NEW.state->'personalDays') d WHERE d->>'id'=f.entity_id))
   OR (f.fact_kind='execution-transition' AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(NEW.state->'outbox') e WHERE e->>'id'=f.sub_id))
   OR (f.fact_kind='prayer-record' AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(NEW.state->'personalDays') d CROSS JOIN LATERAL jsonb_array_elements(coalesce(d->'prayerRecordsR331','[]'::jsonb)) p WHERE d->>'id'=f.entity_id AND p->>'key'=f.sub_id))
  );
  RETURN NEW;
 END IF;
 current_events:=NEW.state->'outbox'; current_days:=NEW.state->'personalDays';
 SELECT coalesce(jsonb_object_agg(e->>'id',true),'{}'::jsonb) INTO prior_ids FROM jsonb_array_elements(prior_events) q(e);
 SELECT coalesce(jsonb_object_agg(e->>'id',true),'{}'::jsonb) INTO current_ids FROM jsonb_array_elements(current_events) q(e);
 SELECT coalesce(jsonb_agg(to_jsonb(x)),'[]'::jsonb) INTO facts FROM noor_r386_candidate.s4_extract(NEW.user_id,NEW.state) x;
 IF EXISTS(SELECT 1 FROM jsonb_to_recordset(facts) AS x(fact_kind text,entity_id text,sub_id text) GROUP BY x.fact_kind,x.entity_id,x.sub_id HAVING count(*)>1)
 THEN RAISE EXCEPTION 'R386_S4_DUPLICATE'; END IF;
 SELECT coalesce(jsonb_object_agg(jsonb_build_array(x.fact_kind,x.entity_id,x.sub_id)::text,true),'{}'::jsonb) INTO fact_ids
 FROM jsonb_to_recordset(facts) AS x(fact_kind text,entity_id text,sub_id text);
 -- A removed entity erases all its fact versions, including derived policy
 -- aliases. Changed retained entities receive a new correction observation.
 DELETE FROM noor_r386_candidate.s4_fact f WHERE f.owner_id=NEW.user_id AND (
  (f.fact_kind<>'execution-transition' AND NOT (fact_ids ? jsonb_build_array(f.fact_kind,f.entity_id,f.sub_id)::text))
  OR (f.fact_kind='execution-transition' AND (
   NOT (fact_ids ? jsonb_build_array('execution',f.entity_id,'-')::text)
   OR NOT (current_ids ? f.sub_id)
  ))
 );
 INSERT INTO noor_r386_candidate.s4_fact(owner_id,fact_kind,entity_id,sub_id,definition_id,source_revision,observation,record)
 SELECT NEW.user_id,x.fact_kind,x.entity_id,x.sub_id,x.definition_id,NEW.revision,
  CASE WHEN prior.source_revision IS NULL THEN 'FirstObserved' ELSE 'Revised' END,x.record
 FROM jsonb_to_recordset(facts) AS x(fact_kind text,entity_id text,sub_id text,definition_id text,record jsonb)
 LEFT JOIN LATERAL(SELECT f.source_revision,f.record,f.definition_id FROM noor_r386_candidate.s4_fact f
  WHERE f.owner_id=NEW.user_id AND (f.fact_kind,f.entity_id,f.sub_id)=(x.fact_kind,x.entity_id,x.sub_id)
  ORDER BY f.source_revision DESC LIMIT 1) prior ON true
 WHERE prior.source_revision IS NULL OR prior.record IS DISTINCT FROM x.record OR prior.definition_id IS DISTINCT FROM x.definition_id;
 -- Capture recording evidence only for NEW execution events in this observed
 -- transaction, tied to the exact final execution version and day. Old events
 -- do not establish the historic weight or actual performed date. A recording
 -- within the due-day boundary identifies the registration civil day only.
 INSERT INTO noor_r386_candidate.s4_fact(owner_id,fact_kind,entity_id,sub_id,definition_id,source_revision,observation,record)
 SELECT NEW.user_id,'execution-transition',x.entity_id,e->>'id',x.definition_id,NEW.revision,'FirstObserved',
  jsonb_build_object('eventType',e->>'eventType','executionVersion',x.record->'executionVersion',
   'recordedAt',e->>'occurredAt','dueDate',x.record->'dueDate','dueTimeZone',x.record->'dueTimeZone',
   'recordedOnDueDate',CASE WHEN (e->>'occurredAt')::timestamptz>=noor_r386_candidate.s4_instant(d->'boundary'->'startAt')::timestamptz
    AND (e->>'occurredAt')::timestamptz<noor_r386_candidate.s4_instant(d->'boundary'->'endAt')::timestamptz
    THEN x.record->'dueDate' ELSE NULL END,
   'performedDate',x.record->'performedDate','performedTimeZone',NULL,'performanceSource',x.record->'performanceSource',
   'legacyRecoveryDate',x.record->'legacyRecoveryDate','weightAtObservedTransition',x.record->'observedEligibilityWeight',
   'scoringRuleAtObservedTransition',x.record->'scoringPolicyVersion','status',x.record->'status')
 FROM (SELECT e FROM jsonb_array_elements(current_events) q(e)
       WHERE e->>'eventType' IN ('ExecutionCompleted','ExecutionMissed','ExecutionCancelled','ExecutionReopened')
       AND NOT (prior_ids ? (e->>'id')) OFFSET 0) q
 JOIN jsonb_to_recordset(facts) AS x(fact_kind text,entity_id text,definition_id text,record jsonb)
 ON x.fact_kind='execution' AND x.entity_id=e->>'aggregateId'
 AND x.record->'executionVersion'=e->'aggregateVersion'
 AND x.record->>'dayId'=e->>'personalDayId'
 AND x.definition_id=e->'payload'->>'definitionId' AND x.record->>'status'=e->'payload'->>'executionStatus'
 JOIN jsonb_array_elements(current_days) z(d) ON d->>'id'=x.record->>'dayId';
 RETURN NEW;
END $$;
DO $guard$ DECLARE c integer; BEGIN
 SELECT count(*) INTO c FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='noor_r386_candidate' AND (
 (p.proname='s3_commit' AND md5(p.prosrc)='987430160ab3129e7e5b51b0070183de' AND pg_get_userbyid(p.proowner)='noor_r386_s3_tx' AND p.prosecdef=true AND p.provolatile='v' AND p.proconfig=ARRAY['search_path=pg_catalog'] AND p.proacl::text='{noor_r386_s3_tx=X/noor_r386_s3_tx,noor_r386_s3_executor=X/noor_r386_s3_tx,noor_r386_g1_guard=X/noor_r386_s3_tx}') OR
 (p.proname='s3_matches' AND md5(p.prosrc)='bb01e3898b413a8e880e16d1d57b0818' AND pg_get_userbyid(p.proowner)='postgres' AND p.prosecdef=false AND p.provolatile='v' AND p.proconfig=ARRAY['search_path=pg_catalog'] AND p.proacl::text='{postgres=X/postgres,noor_r386_s3_tx=X/postgres}') OR
 (p.proname='s4_extract' AND md5(p.prosrc)='fd384654bfd1b77c9c082e05e133433a' AND pg_get_userbyid(p.proowner)='postgres' AND p.prosecdef=false AND p.provolatile='s' AND p.proconfig=ARRAY['search_path=pg_catalog'] AND p.proacl::text='{postgres=X/postgres,noor_r386_s3_tx=X/postgres}') OR
 (p.proname='s4_capture' AND md5(p.prosrc)='efef8197b9474e433a3aece17b03e562' AND pg_get_userbyid(p.proowner)='postgres' AND p.prosecdef=false AND p.provolatile='v' AND p.proconfig=ARRAY['search_path=pg_catalog'] AND p.proacl::text='{postgres=X/postgres,noor_r386_s3_tx=X/postgres}'));
 IF c<>4 THEN RAISE EXCEPTION 'R386_V4_POSTCHECK_MISMATCH'; END IF;
END $guard$;
COMMIT;
