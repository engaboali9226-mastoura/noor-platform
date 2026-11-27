-- Candidate only. Separate hosted readback and authorization required. Execute in a transaction.
DO $r288_guard$ DECLARE p record; BEGIN
 SELECT prosrc,prosecdef,provolatile,proconfig INTO p FROM pg_proc WHERE oid=to_regprocedure('noor_r386_candidate.s4_extract(text,jsonb)');
 IF NOT FOUND OR p.prosecdef OR p.provolatile<>'s' OR p.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog']::text[] OR p.prosrc IS DISTINCT FROM $r288_before$
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
END $r288_before$ THEN RAISE EXCEPTION 'R288_EXTRACTOR_PREDECESSOR_MISMATCH'; END IF;
 END $r288_guard$;
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
   IF a?'taskRecoveryTargetR288' THEN
    IF a?'taskSessionId' OR performed IS NULL OR performed<noor_r386_candidate.s4_date(e->'scheduleOccurrenceKey') THEN RAISE EXCEPTION 'R288_MEASURED_RECOVERY'; END IF;
    w:=noor_r386_candidate.s4_number(a->'taskRecoveryTargetR288',0.000001,1000000000);
    record:=record||jsonb_build_object('scoringPolicyVersion','MeasuredR288','recordedMeasuredBaselineShare',noor_r386_candidate.s4_number(a->'taskRecoveryBaselineR288',0,1),'recordedMeasuredRecoveryShare',noor_r386_candidate.s4_number(a->'amount',0,w)/w*greatest(0.3,1-0.3*(performed::date-noor_r386_candidate.s4_date(e->'scheduleOccurrenceKey')::date)));
   END IF;
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
   IF pol?'sevenCasesR288' AND (pol->'sevenCasesR288' IS DISTINCT FROM 'true'::jsonb OR share_matrix IS DISTINCT FROM '{"group":{"ontime":1,"late":0.5},"excused":{"ontime":1,"late":1},"unexcused":{"ontime":0.75,"late":0.25}}'::jsonb) THEN RAISE EXCEPTION 'R288_PRAYER_POLICY'; END IF;
   FOREACH k IN ARRAY ARRAY['fajr','dhuhr','asr','maghrib','isha'] LOOP
    w:=noor_r386_candidate.s4_number(pol->'weights'->k,1,9007199254740991);
    IF w<>trunc(w) THEN RAISE EXCEPTION 'R386_S4_PRAYER_WEIGHT'; END IF;
    fact_kind:='prayer-policy'; entity_id:=noor_r386_candidate.s4_id(day->'id'); sub_id:=k; definition_id:=NULL;
    record:=jsonb_build_object('dueDate',due,'dueTimeZone',zone,'policyId',policy_id,
     'effectiveFromDate',noor_r386_candidate.s4_date(pol->'effectiveFromDate'),'weight',w,'shares',share_matrix,'scheduledAt',noor_r386_candidate.s4_instant(context->'prayerTimes'->k,false),'scoringPolicyVersion','R334');
    IF pol->'sevenCasesR288'='true'::jsonb THEN record:=record||jsonb_build_object('sevenCasesR288',true,'lateGroupExcusedShare',1); END IF;
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
   IF pol->'sevenCasesR288'='true'::jsonb AND mode='group' AND timing='late' THEN
    IF coalesce(prayer->>'lateGroupExcuse','') NOT IN ('excused','unexcused') THEN RAISE EXCEPTION 'R288_PRAYER_LATE_GROUP_EXCUSE'; END IF;
    record:=record||jsonb_build_object('lateGroupExcuse',prayer->'lateGroupExcuse');
   END IF;
   RETURN NEXT;
  END LOOP;
 END LOOP;
END $$;
