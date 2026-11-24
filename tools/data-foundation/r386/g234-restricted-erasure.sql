-- Disposable G1 erasure port. All entry points are fixed-shape, private
-- SECURITY DEFINER functions owned by the laboratory installer. The LOGIN
-- worker has no raw table access, no auth schema access and no role membership.
-- Not a hosted migration; hosted provider privileges require separate review.
DO $$ BEGIN
 IF to_regclass('pg_temp.noor_r386_g1_managed_install') IS NULL THEN RAISE EXCEPTION 'R386_ERASURE_DISPOSABLE_REQUIRED'; END IF;
END $$;
CREATE ROLE noor_r386_g1_eraser LOGIN PASSWORD NULL NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
GRANT USAGE ON SCHEMA noor_r386_candidate TO noor_r386_g1_eraser;

CREATE FUNCTION noor_r386_candidate.g1_erase_job(p_target uuid,p_erasure uuid,p_account text)
RETURNS noor_r386_candidate.g1_managed_erasure_job
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path=pg_catalog AS $$
DECLARE j noor_r386_candidate.g1_managed_erasure_job%ROWTYPE;
BEGIN
 IF current_setting('transaction_isolation')<>'read committed' THEN RAISE EXCEPTION 'R386_ERASURE_CONTEXT_DENIED'; END IF;
 PERFORM pg_advisory_xact_lock(386017,hashtext(p_target::text));
 SELECT * INTO STRICT j FROM noor_r386_candidate.g1_managed_erasure_job
 WHERE target_id=p_target AND erasure_id=p_erasure AND account_id=p_account AND completed_at IS NULL FOR UPDATE;
 IF NOT EXISTS(SELECT 1 FROM noor_r386_candidate.g1_owner_erasure_tombstone WHERE owner_id=p_target::text)
 OR NOT EXISTS(SELECT 1 FROM noor_r386_candidate.g1_erased_account_digest WHERE account_digest=sha256(convert_to(p_account,'UTF8')))
 THEN RAISE EXCEPTION 'R386_ERASURE_FENCE_DENIED'; END IF;
 RETURN j;
END $$;

CREATE FUNCTION noor_r386_candidate.g1_erase_authorize(p_session text,p_target uuid)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actor record; target record; j noor_r386_candidate.g1_managed_erasure_job%ROWTYPE; now_ms bigint;
BEGIN
 IF current_setting('transaction_isolation')<>'read committed' OR p_target IS NULL OR p_session IS NULL
 OR length(p_session) NOT BETWEEN 16 AND 256 THEN RAISE EXCEPTION 'R386_ERASURE_CONTEXT_DENIED'; END IF;
 SELECT s.originating_auth_session_id,a.auth_user_id INTO STRICT actor
 FROM public.noor_sessions s
 JOIN public.noor_admin_accounts_r271 a ON a.account_id=s.account_id
 JOIN public.noor_authentication_account_linkages l ON l.account_id=s.account_id AND l.user_id=a.auth_user_id
 JOIN auth.users u ON u.id=a.auth_user_id AND u.deleted_at IS NULL
 JOIN auth.sessions p ON p.id=s.originating_auth_session_id AND p.user_id=u.id
 JOIN auth.mfa_factors f ON f.id=p.factor_id AND f.user_id=u.id
 JOIN auth.mfa_amr_claims m ON m.session_id=p.id AND m.authentication_method='totp'
 WHERE s.id=p_session AND s.revoked_at_epoch_ms IS NULL AND s.created_at_epoch_ms<=extract(epoch from clock_timestamp())*1000
 AND s.expires_at_epoch_ms>extract(epoch from clock_timestamp())*1000
 AND a.enabled AND a.role='super_admin' AND a.auth_user_id<>p_target
 AND l.subject=u.id::text AND p.aal::text='aal2' AND f.status::text='verified' AND f.factor_type::text='totp'
 AND m.updated_at BETWEEN clock_timestamp()-interval '5 minutes' AND clock_timestamp()
 FOR SHARE OF s,a,l,u,p,f,m;
 PERFORM noor_r386_candidate.g1_assert_live_managed_auth_session(actor.originating_auth_session_id,actor.auth_user_id);
 SELECT * INTO j FROM noor_r386_candidate.g1_managed_erasure_job WHERE target_id=p_target;
 IF NOT FOUND THEN
  SELECT DISTINCT l.account_id,u.email INTO STRICT target FROM public.noor_authentication_account_linkages l
   JOIN auth.users u ON u.id=l.user_id WHERE u.id=p_target AND l.subject=u.id::text;
  IF target.email IS NULL OR target.email NOT LIKE '%@example.invalid' THEN RAISE EXCEPTION 'R386_ERASURE_SYNTHETIC_TARGET_REQUIRED'; END IF;
  PERFORM noor_r386_candidate.g1_lock_account_key(target.account_id);
  PERFORM pg_advisory_xact_lock(386017,hashtext(p_target::text));
  SELECT * INTO j FROM noor_r386_candidate.g1_managed_erasure_job WHERE target_id=p_target FOR UPDATE;
  IF NOT FOUND THEN
   IF NOT EXISTS(SELECT 1 FROM public.noor_authentication_account_linkages l WHERE l.account_id=target.account_id AND l.user_id=p_target AND l.subject=p_target::text)
    OR EXISTS(SELECT 1 FROM public.noor_authentication_account_linkages l WHERE l.account_id=target.account_id AND l.user_id<>p_target)
    OR EXISTS(SELECT 1 FROM storage.objects WHERE owner_id::text=p_target::text AND
      (bucket_id<>'r386-g1-erasure' OR NOT starts_with(name,p_target::text||'/')))
   THEN RAISE EXCEPTION 'R386_ERASURE_TARGET_SCOPE_DENIED'; END IF;
   INSERT INTO noor_r386_candidate.g1_owner_erasure_tombstone(owner_id) VALUES(p_target::text) ON CONFLICT DO NOTHING;
   INSERT INTO noor_r386_candidate.g1_managed_erasure_job(target_id,erasure_id,account_id,target_email,storage_paths,auth_session_ids,auth_factor_ids)
   VALUES(p_target,gen_random_uuid(),target.account_id,target.email,
     ARRAY(SELECT name FROM storage.objects WHERE owner_id::text=p_target::text AND bucket_id='r386-g1-erasure'),
     ARRAY(SELECT id FROM auth.sessions WHERE user_id=p_target),
     ARRAY(SELECT id FROM auth.mfa_factors WHERE user_id=p_target)) RETURNING * INTO j;
   now_ms:=floor(extract(epoch from clock_timestamp())*1000)::bigint;
   UPDATE public.noor_sessions SET revoked_at_epoch_ms=now_ms WHERE account_id=j.account_id AND revoked_at_epoch_ms IS NULL;
   UPDATE public.noor_entitlement_grants SET revoked_at_epoch_ms=now_ms WHERE account_id=j.account_id AND revoked_at_epoch_ms IS NULL;
   UPDATE public.noor_admin_accounts_r271 SET enabled=false WHERE auth_user_id=p_target;
  END IF;
 END IF;
 j:=noor_r386_candidate.g1_erase_job(p_target,j.erasure_id,j.account_id);
 RETURN jsonb_build_object('ownerId',p_target,'authUserId',p_target,'accountId',j.account_id,'erasureId',j.erasure_id,
 'persistentTombstone',true,'sessionsAndGrantsRevoked',true);
END $$;

CREATE FUNCTION noor_r386_candidate.g1_erase_text(p_text text,p_needles text[])
RETURNS text LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER SET search_path=pg_catalog AS $$
DECLARE n text; at_pos integer; rest text; result text;
BEGIN
 FOREACH n IN ARRAY p_needles LOOP
  IF n IS NULL OR n='' THEN CONTINUE; END IF;
  rest:=p_text; result:='';
  LOOP
   at_pos:=strpos(lower(rest),lower(n)); EXIT WHEN at_pos=0;
   result:=result||substr(rest,1,at_pos-1)||'[erased]';
   rest:=substr(rest,at_pos+length(n));
  END LOOP;
  p_text:=result||rest;
 END LOOP;
 RETURN p_text;
END $$;
CREATE FUNCTION noor_r386_candidate.g1_erase_json(p_doc jsonb,p_needles text[])
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER SET search_path=pg_catalog AS $$
DECLARE result jsonb;
BEGIN
 CASE jsonb_typeof(p_doc)
 WHEN 'string' THEN RETURN to_jsonb(noor_r386_candidate.g1_erase_text(p_doc#>>'{}',p_needles));
 WHEN 'array' THEN
  SELECT coalesce(jsonb_agg(noor_r386_candidate.g1_erase_json(v,p_needles) ORDER BY ord),'[]'::jsonb)
    INTO result FROM jsonb_array_elements(p_doc) WITH ORDINALITY a(v,ord);
 WHEN 'object' THEN
  SELECT coalesce(jsonb_object_agg(k,noor_r386_candidate.g1_erase_json(v,p_needles)),'{}'::jsonb)
    INTO result FROM jsonb_each(p_doc) o(k,v) WHERE noor_r386_candidate.g1_erase_text(k,p_needles)=k;
 ELSE RETURN p_doc;
 END CASE;
 RETURN result;
END $$;

CREATE FUNCTION noor_r386_candidate.g1_erase_step(p_target uuid,p_erasure uuid,p_account text,p_store text,p_delete boolean)
RETURNS bigint LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE j noor_r386_candidate.g1_managed_erasure_job%ROWTYPE; tbl regclass; col text; k text; n bigint; needles text[];
BEGIN
 j:=noor_r386_candidate.g1_erase_job(p_target,p_erasure,p_account);
 IF p_delete IS NULL THEN RAISE EXCEPTION 'R386_ERASURE_STEP_DENIED'; END IF;
 k:=p_target::text; col:='owner_id'; needles:=ARRAY[k,p_account,j.target_email];
 CASE p_store
 WHEN 'storage-objects' THEN
  IF p_delete THEN RAISE EXCEPTION 'R386_ERASURE_STORAGE_API_REQUIRED'; END IF;
  SELECT count(*) INTO n FROM storage.objects WHERE owner_id::text=k OR (bucket_id='r386-g1-erasure' AND name=ANY(j.storage_paths));
  RETURN n;
 WHEN 'admin-audit' THEN
  IF p_delete THEN
   UPDATE public.noor_admin_audit_r271 SET
    actor_auth_user_id=CASE WHEN actor_auth_user_id=p_target THEN NULL ELSE actor_auth_user_id END,
    target_auth_user_id=CASE WHEN target_auth_user_id=p_target THEN NULL ELSE target_auth_user_id END,
    actor_erased=actor_erased OR coalesce(actor_auth_user_id=p_target,false),
    target_erased=target_erased OR coalesce(target_auth_user_id=p_target,false),
    details=noor_r386_candidate.g1_erase_json(details,needles)
   WHERE actor_auth_user_id=p_target OR target_auth_user_id=p_target
     OR EXISTS(SELECT 1 FROM unnest(needles) x WHERE strpos(lower(details::text),lower(x))>0);
  END IF;
  SELECT count(*) INTO n FROM public.noor_admin_audit_r271 WHERE actor_auth_user_id=p_target OR target_auth_user_id=p_target
    OR EXISTS(SELECT 1 FROM unnest(needles) x WHERE strpos(lower(details::text),lower(x))>0);
  RETURN n;
 WHEN 'admin-accounts' THEN tbl:='public.noor_admin_accounts_r271';col:='auth_user_id';
 WHEN 'task-events' THEN tbl:='public.task_events';col:='user_id';
 WHEN 'tasks' THEN tbl:='public.tasks';col:='user_id';
 WHEN 'habit-entries' THEN tbl:='public.habit_entries';col:='user_id';
 WHEN 'habits' THEN tbl:='public.habits';col:='user_id';
 WHEN 'work-teacher-state' THEN tbl:='public.noor_work_teacher_states_r264';col:='user_id';
 WHEN 'personal-foundation' THEN tbl:='public.noor_personal_foundations';col:='user_id';
 WHEN 'private-journal' THEN tbl:='public.noor_private_journal_entries_r221';col:='owner_user_id';
 WHEN 'candidate-analytics' THEN tbl:='noor_r386_candidate.s4_fact';
 WHEN 'candidate-delivery' THEN
  IF p_delete THEN DELETE FROM noor_r386_candidate.event_history WHERE owner_id=k; END IF;
  tbl:='noor_r386_candidate.delivery_outbox';
 WHEN 'candidate-events' THEN tbl:='noor_r386_candidate.event_history';
 WHEN 'candidate-checkpoint' THEN tbl:='noor_r386_candidate.checkpoint';
 WHEN 'candidate-receipts' THEN tbl:='noor_r386_candidate.command_receipt';
 WHEN 'candidate-enrollment' THEN tbl:='noor_r386_candidate.s3_enrollment';
 WHEN 'candidate-owner' THEN
  IF p_delete THEN DELETE FROM noor_r386_candidate.g234_scope WHERE owner_id=k; END IF;
  tbl:='noor_r386_candidate.owner_scope';
 WHEN 'noor-entitlement-grants' THEN tbl:='public.noor_entitlement_grants';col:='account_id';k:=p_account;
 WHEN 'noor-sessions' THEN tbl:='public.noor_sessions';col:='account_id';k:=p_account;
 WHEN 'noor-account-linkages' THEN tbl:='public.noor_authentication_account_linkages';col:='user_id';
 ELSE RAISE EXCEPTION 'R386_ERASURE_STEP_DENIED';
 END CASE;
 -- tbl/col are exclusively the literal allowlist above, never caller SQL.
 IF p_delete THEN EXECUTE format('DELETE FROM %s WHERE %I::text=$1',tbl,col) USING k; END IF;
 EXECUTE format('SELECT count(*) FROM %s WHERE %I::text=$1',tbl,col) INTO n USING k;
 IF p_store='candidate-owner' THEN n:=n+(SELECT count(*) FROM noor_r386_candidate.g234_scope WHERE owner_id=k); END IF;
 RETURN n;
END $$;

CREATE FUNCTION noor_r386_candidate.g1_erase_storage_paths(p_target uuid,p_erasure uuid,p_account text)
RETURNS text[] LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE j noor_r386_candidate.g1_managed_erasure_job%ROWTYPE;
BEGIN
 j:=noor_r386_candidate.g1_erase_job(p_target,p_erasure,p_account);
 RETURN j.storage_paths;
END $$;
CREATE FUNCTION noor_r386_candidate.g1_erase_auth_count(p_target uuid,p_erasure uuid,p_account text)
RETURNS bigint LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE j noor_r386_candidate.g1_managed_erasure_job%ROWTYPE; c record; keys text[]; n bigint; total bigint;
BEGIN
 j:=noor_r386_candidate.g1_erase_job(p_target,p_erasure,p_account);
 SELECT count(*) INTO total FROM auth.users WHERE id=p_target;
 FOR c IN SELECT DISTINCT column_name,table_schema,table_name FROM information_schema.columns
 WHERE table_schema='auth' AND column_name IN ('user_id','session_id','factor_id') AND data_type IN ('uuid','text','character varying')
 LOOP
  keys:=CASE c.column_name WHEN 'user_id' THEN ARRAY[p_target::text] WHEN 'session_id' THEN j.auth_session_ids::text[] ELSE j.auth_factor_ids::text[] END;
  IF cardinality(keys)>0 THEN
   EXECUTE format('SELECT count(*) FROM %I.%I WHERE %I::text=ANY($1)',c.table_schema,c.table_name,c.column_name) INTO n USING keys;
   total:=total+n;
  END IF;
 END LOOP;
 RETURN total;
END $$;
CREATE FUNCTION noor_r386_candidate.g1_erase_verify(p_target uuid,p_erasure uuid,p_account text)
RETURNS boolean LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE j noor_r386_candidate.g1_managed_erasure_job%ROWTYPE; store text; needles text[];
BEGIN
 j:=noor_r386_candidate.g1_erase_job(p_target,p_erasure,p_account);
 needles:=ARRAY[p_target::text,p_account,j.target_email];
 UPDATE auth.audit_log_entries SET payload=noor_r386_candidate.g1_erase_json(payload::jsonb,needles),
  ip_address=CASE WHEN payload->>'actor_id'=p_target::text OR lower(payload->>'actor_username')=lower(j.target_email) THEN '' ELSE ip_address END
 WHERE EXISTS(SELECT 1 FROM unnest(needles) x WHERE strpos(lower(payload::text),lower(x))>0);
 FOREACH store IN ARRAY ARRAY['storage-objects','admin-audit','admin-accounts','task-events','tasks','habit-entries','habits','work-teacher-state','personal-foundation','private-journal','candidate-analytics','candidate-delivery','candidate-events','candidate-checkpoint','candidate-receipts','candidate-enrollment','candidate-owner','noor-entitlement-grants','noor-sessions','noor-account-linkages']
 LOOP
  IF noor_r386_candidate.g1_erase_step(p_target,p_erasure,p_account,store,false)<>0 THEN RAISE EXCEPTION 'R386_ERASURE_DATABASE_RESIDUAL'; END IF;
 END LOOP;
 IF noor_r386_candidate.g1_erase_auth_count(p_target,p_erasure,p_account)<>0 OR EXISTS(
  SELECT 1 FROM auth.audit_log_entries WHERE EXISTS(SELECT 1 FROM unnest(needles) x WHERE strpos(lower(payload::text),lower(x))>0))
 THEN RAISE EXCEPTION 'R386_ERASURE_AUTH_RESIDUAL'; END IF;
 UPDATE noor_r386_candidate.g1_managed_erasure_job SET database_verified_at=coalesce(database_verified_at,clock_timestamp())
 WHERE target_id=p_target AND erasure_id=p_erasure;
 -- Deliberately pending until independent external-retention/restore proof.
 RETURN false;
END $$;

REVOKE ALL ON FUNCTION noor_r386_candidate.g1_erase_job(uuid,uuid,text),noor_r386_candidate.g1_erase_authorize(text,uuid),
 noor_r386_candidate.g1_erase_text(text,text[]),noor_r386_candidate.g1_erase_json(jsonb,text[]),
 noor_r386_candidate.g1_erase_step(uuid,uuid,text,text,boolean),noor_r386_candidate.g1_erase_storage_paths(uuid,uuid,text),
 noor_r386_candidate.g1_erase_auth_count(uuid,uuid,text),noor_r386_candidate.g1_erase_verify(uuid,uuid,text)
 FROM PUBLIC,anon,authenticated,service_role,noor_r386_g1_writer,noor_r386_g234_scheduler,noor_r386_g1_eraser;
GRANT EXECUTE ON FUNCTION noor_r386_candidate.g1_erase_authorize(text,uuid),noor_r386_candidate.g1_erase_step(uuid,uuid,text,text,boolean),
 noor_r386_candidate.g1_erase_storage_paths(uuid,uuid,text),noor_r386_candidate.g1_erase_auth_count(uuid,uuid,text),
 noor_r386_candidate.g1_erase_verify(uuid,uuid,text) TO noor_r386_g1_eraser;
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='noor_r386_g1_eraser' AND rolcanlogin AND NOT rolsuper AND NOT rolbypassrls AND NOT rolcreaterole)
 OR has_schema_privilege('noor_r386_g1_eraser','auth','USAGE')
 OR has_table_privilege('noor_r386_g1_eraser','noor_r386_candidate.g1_managed_erasure_job','SELECT,INSERT,UPDATE,DELETE')
 OR has_any_column_privilege('noor_r386_g1_eraser','public.noor_personal_foundations','SELECT,INSERT,UPDATE,REFERENCES')
 OR has_function_privilege('noor_r386_g1_eraser','noor_r386_candidate.g1_erase_job(uuid,uuid,text)','EXECUTE')
 OR pg_has_role('noor_r386_g1_eraser','noor_r386_g1_guard','MEMBER')
 THEN RAISE EXCEPTION 'R386_ERASURE_ROLE_LEAK'; END IF;
END $$;
