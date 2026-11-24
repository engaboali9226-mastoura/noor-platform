-- Disposable managed-runtime composition only; never a production migration.
DO $$ BEGIN
 IF to_regclass('pg_temp.noor_r386_g1_managed_install') IS NULL THEN RAISE EXCEPTION 'R386_RUNTIME_DISPOSABLE_REQUIRED'; END IF;
END $$;
CREATE ROLE noor_r386_g234_scheduler LOGIN PASSWORD NULL NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
GRANT USAGE ON SCHEMA noor_r386_candidate TO noor_r386_g234_scheduler;
CREATE FUNCTION noor_r386_candidate.g234_assert_active_auth_owner(p_owner uuid)
RETURNS void LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 PERFORM id FROM auth.users WHERE id=p_owner AND deleted_at IS NULL FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'R386_RUNTIME_SCHEDULER_AUTH_DENIED'; END IF;
END $$;
CREATE FUNCTION noor_r386_candidate.g234_assert_scheduled_owner(p_owner text)
RETURNS void LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path=pg_catalog AS $$
DECLARE l record; g record; account_key text; n integer:=0; grants integer:=0;
BEGIN
 IF current_setting('transaction_isolation')<>'read committed' OR p_owner IS NULL
 OR p_owner !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
 THEN RAISE EXCEPTION 'R386_RUNTIME_SCHEDULER_CONTEXT_DENIED'; END IF;
 PERFORM pg_advisory_xact_lock(386017,hashtext(p_owner));
 IF NOT EXISTS(SELECT 1 FROM noor_r386_candidate.g234_scope WHERE owner_id=p_owner)
 OR EXISTS(SELECT 1 FROM noor_r386_candidate.g1_owner_erasure_tombstone WHERE owner_id=p_owner)
 OR NOT EXISTS(SELECT 1 FROM noor_r386_candidate.s3_enrollment WHERE owner_id=p_owner AND (shadow_enabled OR rollback_only))
 THEN RAISE EXCEPTION 'R386_RUNTIME_SCHEDULER_SCOPE_DENIED'; END IF;
 FOR l IN SELECT account_id,subject,issuer FROM public.noor_authentication_account_linkages WHERE user_id=p_owner::uuid FOR SHARE LOOP
  n:=n+1;
  IF l.subject IS DISTINCT FROM p_owner OR l.issuer IS NULL OR (account_key IS NOT NULL AND account_key IS DISTINCT FROM l.account_id)
  THEN RAISE EXCEPTION 'R386_RUNTIME_SCHEDULER_LINKAGE_DENIED'; END IF;
  account_key:=l.account_id;
 END LOOP;
 IF n=0 OR EXISTS(SELECT 1 FROM public.noor_authentication_account_linkages WHERE account_id=account_key AND user_id<>p_owner::uuid)
 THEN RAISE EXCEPTION 'R386_RUNTIME_SCHEDULER_LINKAGE_DENIED'; END IF;
 FOR g IN SELECT granted_at_epoch_ms,revoked_at_epoch_ms FROM public.noor_entitlement_grants
  WHERE account_id=account_key AND action='access' AND resource_type='application' AND resource_id='noor-personal' FOR SHARE LOOP
  grants:=grants+1;
  IF g.revoked_at_epoch_ms IS NOT NULL OR g.granted_at_epoch_ms>extract(epoch FROM clock_timestamp())*1000
  THEN RAISE EXCEPTION 'R386_RUNTIME_SCHEDULER_GRANT_DENIED'; END IF;
 END LOOP;
 IF grants<>1 THEN RAISE EXCEPTION 'R386_RUNTIME_SCHEDULER_GRANT_DENIED'; END IF;
 PERFORM noor_r386_candidate.g234_assert_active_auth_owner(p_owner::uuid);
END $$;
CREATE FUNCTION noor_r386_candidate.g234_scheduler_load(p_owner text)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 PERFORM noor_r386_candidate.g234_assert_scheduled_owner(p_owner);
 RETURN noor_r386_candidate.s3_load(p_owner);
END $$;
CREATE FUNCTION noor_r386_candidate.g234_scheduler_lookup(p_owner text,p_request text)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 IF p_request IS NULL OR p_request !~ '^scheduler-[0-9]{12}$' THEN RAISE EXCEPTION 'R386_RUNTIME_SCHEDULER_REQUEST_DENIED'; END IF;
 PERFORM noor_r386_candidate.g234_assert_scheduled_owner(p_owner);
 RETURN noor_r386_candidate.s3_lookup(p_owner,p_request);
END $$;
CREATE FUNCTION noor_r386_candidate.g234_scheduler_commit(p_owner text,p_request text,p_exists boolean,p_revision bigint,p_before jsonb,p_after jsonb,p_key text,p_digest text,p_fingerprints jsonb)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 IF p_request IS NULL OR p_request !~ '^scheduler-[0-9]{12}$' THEN RAISE EXCEPTION 'R386_RUNTIME_SCHEDULER_REQUEST_DENIED'; END IF;
 PERFORM noor_r386_candidate.g234_assert_scheduled_owner(p_owner);
 RETURN noor_r386_candidate.s3_commit(p_owner,p_request,p_exists,p_revision,p_before,p_after,p_key,p_digest,p_fingerprints,ARRAY[]::text[]);
END $$;
REVOKE ALL ON FUNCTION noor_r386_candidate.g234_assert_active_auth_owner(uuid),noor_r386_candidate.g234_assert_scheduled_owner(text),
 noor_r386_candidate.g234_scheduler_load(text),noor_r386_candidate.g234_scheduler_lookup(text,text),
 noor_r386_candidate.g234_scheduler_commit(text,text,boolean,bigint,jsonb,jsonb,text,text,jsonb)
 FROM PUBLIC,anon,authenticated,service_role,noor_r386_g1_writer,noor_r386_g234_scheduler;
GRANT EXECUTE ON FUNCTION noor_r386_candidate.g234_assert_active_auth_owner(uuid) TO noor_r386_g1_guard;
GRANT CREATE ON SCHEMA noor_r386_candidate TO noor_r386_g1_guard;
ALTER FUNCTION noor_r386_candidate.g234_assert_scheduled_owner(text) OWNER TO noor_r386_g1_guard;
ALTER FUNCTION noor_r386_candidate.g234_scheduler_load(text) OWNER TO noor_r386_g1_guard;
ALTER FUNCTION noor_r386_candidate.g234_scheduler_lookup(text,text) OWNER TO noor_r386_g1_guard;
ALTER FUNCTION noor_r386_candidate.g234_scheduler_commit(text,text,boolean,bigint,jsonb,jsonb,text,text,jsonb) OWNER TO noor_r386_g1_guard;
REVOKE CREATE ON SCHEMA noor_r386_candidate FROM noor_r386_g1_guard;
GRANT EXECUTE ON FUNCTION noor_r386_candidate.g234_scheduler_load(text),noor_r386_candidate.g234_scheduler_lookup(text,text),
 noor_r386_candidate.g234_scheduler_commit(text,text,boolean,bigint,jsonb,jsonb,text,text,jsonb) TO noor_r386_g234_scheduler;
DO $$ DECLARE r text; BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='noor_r386_g234_scheduler' AND rolcanlogin AND NOT rolsuper AND NOT rolbypassrls AND NOT rolcreaterole AND NOT rolcreatedb)
 OR pg_has_role('noor_r386_g234_scheduler','noor_r386_g1_guard','MEMBER')
 OR pg_has_role('noor_r386_g234_scheduler','noor_r386_s3_tx','MEMBER')
 OR has_schema_privilege('noor_r386_g234_scheduler','auth','USAGE')
 OR has_any_column_privilege('noor_r386_g234_scheduler','public.noor_personal_foundations','SELECT,INSERT,UPDATE')
 OR has_function_privilege('noor_r386_g234_scheduler','noor_r386_candidate.s3_commit(text,text,boolean,bigint,jsonb,jsonb,text,text,jsonb,text[])','EXECUTE')
 OR has_function_privilege('noor_r386_g234_scheduler','noor_r386_candidate.g234_assert_scheduled_owner(text)','EXECUTE')
 THEN RAISE EXCEPTION 'R386_RUNTIME_SCHEDULER_ROLE_LEAK'; END IF;
 FOREACH r IN ARRAY ARRAY['anon','authenticated','service_role','noor_r386_g1_writer'] LOOP
 IF has_function_privilege(r,'noor_r386_candidate.g234_scheduler_load(text)','EXECUTE')
 OR has_function_privilege(r,'noor_r386_candidate.g234_scheduler_lookup(text,text)','EXECUTE')
 OR has_function_privilege(r,'noor_r386_candidate.g234_scheduler_commit(text,text,boolean,bigint,jsonb,jsonb,text,text,jsonb)','EXECUTE')
 THEN RAISE EXCEPTION 'R386_RUNTIME_SCHEDULER_ENTRYPOINT_LEAK'; END IF;
 END LOOP;
END $$;
