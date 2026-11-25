-- Dedicated disposable PostgreSQL fixture only.
DO $$ BEGIN IF current_database()<>'noor_r386_synthetic' OR to_regclass('noor_r386_lab.synthetic_source') IS NULL OR to_regclass('public.noor_personal_foundations') IS NOT NULL THEN RAISE EXCEPTION 'R386_PERF_DISPOSABLE_ONLY'; END IF; END $$;
SET statement_timeout='180s';
CREATE TEMP TABLE perf_input AS
WITH params AS (SELECT 'synthetic-r386-s3-performance'::text AS u),
days AS (SELECT i,('2026-10-01'::date+i-1)::text AS d FROM generate_series(1,32) i),
execs AS (SELECT i,1+((i-1)%32) AS day,1+((i-1)/32) AS def FROM generate_series(1,1049) i),
records AS (SELECT jsonb_build_object('id','exec-'||e.i,'userId',u,'definitionId','def-'||e.def,'definitionRevisionId','rev-'||e.def,'personalDayId','day-'||e.day,'scheduleOccurrenceKey',d.d,'kind','Habit','status',CASE WHEN e.i<=1000 THEN 'Completed' ELSE 'Planned' END,'version',CASE WHEN e.i<=1000 THEN 2 ELSE 1 END,'eligibility',jsonb_build_object('weight',5,'definitionRevisionId','rev-'||e.def)) AS rec,e.i FROM execs e JOIN days d ON d.i=e.day CROSS JOIN params),
events AS (
 SELECT i, 'HabitOccurrenceMaterialized' AS t,'HabitOccurrence' AS agg,'exec-'||i AS aid, 1 AS ver,'day-'||day AS did,jsonb_build_object('definitionId','def-'||def,'definitionRevisionId','rev-'||def,'materializationKey','material-'||i) AS payload FROM execs
 UNION ALL SELECT 1049+i,'ExecutionCompleted','DailyExecutionInstance','exec-'||i,2,'day-'||day,jsonb_build_object('definitionId','def-'||def,'executionStatus','Completed') FROM execs WHERE i<=1000
 UNION ALL SELECT 2049+i,'TodayReconciled','PersonalDay','day-'||(1+((i-1)%32)),1,'day-'||(1+((i-1)%32)),jsonb_build_object('definitionsEvaluated',33,'duplicatesPrevented',0,'instancesCreated',0,'instancesUpdated',0,'restored',0,'suppressed',0) FROM generate_series(1,223) i
), envelope AS (SELECT i,jsonb_build_object('id','event-'||i,'idempotencyKey','key-'||i,'eventType',t,'eventVersion',1,'aggregateType',agg,'aggregateId',aid,'aggregateVersion',ver,'userId',u,'occurredAt','2026-10-15T10:00:00.000Z','correlationId','corr-'||i,'privacyClassification','PersonalOperationalData','personalDayId',did,'payload',payload,'deliveryState','Pending') AS rec FROM events CROSS JOIN params)
SELECT u AS owner_id,jsonb_build_object('historicalEvents','[]'::jsonb,'notificationHistory','[]'::jsonb,'fridayMosqueVisits','[]'::jsonb,'locations','[]'::jsonb,'prayerPolicies','[]'::jsonb,'islamicContexts','[]'::jsonb,
'personalDays',(SELECT jsonb_agg(jsonb_build_object('id','day-'||i,'userId',u,'boundary',jsonb_build_object('localDate',d,'timeZone','Asia/Riyadh','startAt',d||'T00:00:00.000Z','endAt',(d::date+1)::text||'T00:00:00.000Z')) ORDER BY i) FROM days),
'definitions',(SELECT jsonb_agg(jsonb_build_object('id','def-'||i,'userId',u,'kind','Habit','revisionId','rev-'||i) ORDER BY i) FROM generate_series(1,33) i),
'dailyExecution',(SELECT jsonb_agg(rec ORDER BY i) FROM records), 'outbox',(SELECT jsonb_agg(rec ORDER BY i) FROM envelope)) AS state FROM params;
DO $$DECLARE p text; s jsonb; result jsonb; empty_state jsonb:='{"historicalEvents":[],"notificationHistory":[],"fridayMosqueVisits":[],"locations":[],"prayerPolicies":[],"personalDays":[],"islamicContexts":[],"definitions":[],"dailyExecution":[],"outbox":[]}'::jsonb; k text:='perf-key'; dg text:=repeat('a',64); BEGIN
 SELECT owner_id,state INTO p,s FROM perf_input;
 IF jsonb_array_length(s->'outbox')<>2272 OR jsonb_array_length(s->'dailyExecution')<>1049 OR jsonb_array_length(s->'personalDays')<>32 THEN RAISE EXCEPTION 'R386_PERF_FIXTURE_SIZE'; END IF;
 INSERT INTO noor_r386_candidate.s3_enrollment(owner_id,shadow_enabled) VALUES(p,true);
 result:=noor_r386_candidate.s3_commit(p,'perf-seed',false,0,empty_state,s,k,dg,jsonb_build_object(k,dg),ARRAY[]::text[]);
 IF result->>'kind'<>'committed' THEN RAISE EXCEPTION 'R386_PERF_SEED_FAILED'; END IF;
END$$;
SELECT 'PERF_INITIAL_EVENTS='||jsonb_array_length(state->'outbox') FROM perf_input;
SELECT 'PERF_INITIAL_EXECUTIONS='||jsonb_array_length(state->'dailyExecution') FROM perf_input;
SELECT 'PERF_INITIAL_DAYS='||jsonb_array_length(state->'personalDays') FROM perf_input;
-- Each measurement is its own committed transaction, not a no-op or a replay.
CREATE TEMP TABLE perf_times(sample int,ms numeric);
CREATE FUNCTION pg_temp.measure_save(n int) RETURNS void LANGUAGE plpgsql AS $$
DECLARE p text; s jsonb; next_s jsonb; rev bigint; t timestamptz; elapsed numeric; result jsonb; k text:='perf-key'; dg text:=repeat('b',64); idx int; ev jsonb; rec jsonb; BEGIN
 SELECT owner_id INTO p FROM perf_input;
 SELECT revision,state INTO rev,s FROM noor_r386_lab.synthetic_source WHERE owner_id=p;
 idx:=1000+n; -- first three Planned executions, zero-based index below
 rec:=s->'dailyExecution'->(idx-1);
 IF rec->>'status'<>'Planned' THEN RAISE EXCEPTION 'R386_PERF_BAD_SAMPLE'; END IF;
 rec:=rec||jsonb_build_object('status','Completed','version',2);
 ev:=jsonb_build_object('id','perf-new-event-'||n,'idempotencyKey','perf-new-key-'||n,'eventType','ExecutionCompleted','eventVersion',1,'aggregateType','DailyExecutionInstance','aggregateId',rec->>'id','aggregateVersion',2,'userId',p,'occurredAt','2026-11-01T10:00:00.000Z','correlationId','perf-corr-'||n,'privacyClassification','PersonalOperationalData','personalDayId',rec->>'personalDayId','payload',jsonb_build_object('definitionId',rec->>'definitionId','executionStatus','Completed'),'deliveryState','Pending');
 next_s:=jsonb_set(s,ARRAY['dailyExecution',(idx-1)::text],rec);
 next_s:=jsonb_set(next_s,ARRAY['outbox'],(next_s->'outbox')||jsonb_build_array(ev));
 t:=clock_timestamp();
 result:=noor_r386_candidate.s3_commit(p,'perf-save-'||n,true,rev,s,next_s,k,dg,jsonb_build_object(k,dg),ARRAY[]::text[]);
 elapsed:=round((extract(epoch FROM clock_timestamp()-t)*1000)::numeric,2);
 IF result->>'kind'<>'committed' OR (result->'receipt'->>'revision')::bigint<>rev+1 THEN RAISE EXCEPTION 'R386_PERF_COMMIT_FAILED'; END IF;
 INSERT INTO perf_times VALUES(n,elapsed);
END$$;
SELECT pg_temp.measure_save(1);
SELECT pg_temp.measure_save(2);
SELECT pg_temp.measure_save(3);
SELECT 'PERF_SAMPLE_'||sample||'_MS='||ms FROM perf_times ORDER BY sample;
SELECT 'PERF_MAX_MS='||max(ms) FROM perf_times;
DO $$DECLARE p text; s jsonb; r bigint; BEGIN
 SELECT owner_id INTO p FROM perf_input;
 SELECT revision,state INTO r,s FROM noor_r386_lab.synthetic_source WHERE owner_id=p;
 IF r<>4 OR jsonb_array_length(s->'outbox')<>2275 THEN RAISE EXCEPTION 'R386_PERF_REVISION'; END IF;
 PERFORM noor_r386_candidate.s3_matches(p,s->'outbox');
 IF (SELECT count(*) FROM noor_r386_candidate.command_receipt WHERE owner_id=p)<>4 THEN RAISE EXCEPTION 'R386_PERF_RECEIPTS'; END IF;
 IF (SELECT count(*) FROM noor_r386_candidate.s4_fact WHERE owner_id=p AND fact_kind='execution-transition' AND sub_id LIKE 'perf-new-event-%')<>3 THEN RAISE EXCEPTION 'R386_PERF_FACTS'; END IF;
END$$;
SELECT 'PERF_PARITY=PASS';
-- Exact parity must reject valid-shaped but divergent records, not just duplicates.
DO $$DECLARE p text; events jsonb; v jsonb; x jsonb; i int; expected text; caught boolean; BEGIN
 SELECT owner_id INTO p FROM perf_input;
 SELECT state->'outbox' INTO events FROM noor_r386_lab.synthetic_source WHERE owner_id=p;
 PERFORM noor_r386_candidate.s3_matches(p,events);
 FOR i IN 1..6 LOOP
  expected:='R386_S3_SHADOW_DRIFT';
  CASE i
   WHEN 1 THEN v:=events-0;
   WHEN 2 THEN v:=jsonb_set(events,'{0,deliveryState}','"Delivered"'::jsonb);
   WHEN 3 THEN v:=jsonb_set(events,'{0,idempotencyKey}','"different-valid-key"'::jsonb);
   WHEN 4 THEN v:=jsonb_set(events,'{0,payload,materializationKey}','"different-materialization"'::jsonb);
   WHEN 5 THEN x:=(events->0)||jsonb_build_object('id','extra-perf-event','idempotencyKey','extra-perf-key'); v:=events||jsonb_build_array(x);
   WHEN 6 THEN v:=events||jsonb_build_array(events->0); expected:='R386_S2_DUPLICATE_SOURCE';
  END CASE;
  caught:=false;
  BEGIN
   PERFORM noor_r386_candidate.s3_matches(p,v);
  EXCEPTION WHEN raise_exception THEN
   IF SQLERRM<>expected THEN RAISE; END IF;
   caught:=true;
  END;
  IF NOT caught THEN RAISE EXCEPTION 'R386_PERF_PARITY_NEGATIVE_FAILED'; END IF;
 END LOOP;
 -- Change order only: validated set is still identical.
 SELECT jsonb_agg(e ORDER BY ord DESC) INTO v FROM jsonb_array_elements(events) WITH ORDINALITY q(e,ord);
 PERFORM noor_r386_candidate.s3_matches(p,v);
END$$;
SELECT 'PARITY_NEGATIVE_TESTS=PASS';
DO $$ BEGIN IF (SELECT max(ms) FROM perf_times)>5000 THEN RAISE EXCEPTION 'R386_PERF_LATENCY_BUDGET'; END IF; END$$;
SELECT 'PERF_LATENCY_GATE=PASS';
