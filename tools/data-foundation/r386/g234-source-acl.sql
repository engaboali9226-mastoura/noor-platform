DO $$ BEGIN
 IF to_regclass('pg_temp.noor_r386_g1_managed_install') IS NULL
 THEN RAISE EXCEPTION 'R386_G234_DISPOSABLE_REQUIRED'; END IF;
END $$;
GRANT SELECT ON noor_r386_candidate.g234_scope TO noor_r386_s3_tx,noor_r386_g1_guard;
CREATE POLICY g234_scope_read ON noor_r386_candidate.g234_scope
 FOR SELECT TO noor_r386_s3_tx,noor_r386_g1_guard USING(true);
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['s3_enrollment','owner_scope','event_history','delivery_outbox','checkpoint','command_receipt']
 LOOP
  EXECUTE format('ALTER POLICY r386_s3_trusted_scope ON noor_r386_candidate.%I USING (owner_id IN (SELECT owner_id FROM noor_r386_candidate.g234_scope)) WITH CHECK (owner_id IN (SELECT owner_id FROM noor_r386_candidate.g234_scope))',t);
 END LOOP;
END $$;
GRANT USAGE ON SCHEMA public TO noor_r386_s3_tx;
GRANT SELECT(user_id,schema_version,revision,state),INSERT(user_id,schema_version,revision,state,updated_at),
 UPDATE(revision,state,updated_at) ON public.noor_personal_foundations TO noor_r386_s3_tx;
CREATE POLICY g234_actual_source_select ON public.noor_personal_foundations FOR SELECT TO noor_r386_s3_tx
 USING(user_id IN (SELECT owner_id FROM noor_r386_candidate.g234_scope));
CREATE POLICY g234_actual_source_insert ON public.noor_personal_foundations FOR INSERT TO noor_r386_s3_tx
 WITH CHECK(user_id IN (SELECT owner_id FROM noor_r386_candidate.g234_scope));
CREATE POLICY g234_actual_source_update ON public.noor_personal_foundations FOR UPDATE TO noor_r386_s3_tx
 USING(user_id IN (SELECT owner_id FROM noor_r386_candidate.g234_scope))
 WITH CHECK(user_id IN (SELECT owner_id FROM noor_r386_candidate.g234_scope));
GRANT SELECT(owner_id,shadow_enabled,rollback_only) ON noor_r386_candidate.s3_enrollment TO noor_r386_g1_guard;
CREATE POLICY g234_guard_enrollment_read ON noor_r386_candidate.s3_enrollment
 FOR SELECT TO noor_r386_g1_guard USING(owner_id IN (SELECT owner_id FROM noor_r386_candidate.g234_scope));

-- Check the executing role in the trigger WHEN expression, before entering
-- the restricted definer. Only the existing S3 transaction owner can write an
-- enrolled source. The caller cannot bypass this by choosing its own role.
CREATE FUNCTION noor_r386_candidate.g234_prevent_split_source_save()
RETURNS trigger LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 PERFORM pg_advisory_xact_lock(386017,hashtext(NEW.user_id));
 IF EXISTS(SELECT 1 FROM noor_r386_candidate.s3_enrollment e
   WHERE e.owner_id=NEW.user_id AND (e.shadow_enabled OR e.rollback_only))
 THEN RAISE EXCEPTION 'R386_G234_NONATOMIC_SOURCE_DENIED'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER g234_atomic_source_only BEFORE INSERT OR UPDATE ON public.noor_personal_foundations
 FOR EACH ROW WHEN (current_user <> 'noor_r386_s3_tx')
 EXECUTE FUNCTION noor_r386_candidate.g234_prevent_split_source_save();
REVOKE ALL ON FUNCTION noor_r386_candidate.g234_prevent_split_source_save()
 FROM PUBLIC,anon,authenticated,service_role,noor_r386_g1_writer,noor_r386_s3_tx;
GRANT CREATE ON SCHEMA noor_r386_candidate TO noor_r386_g1_guard;
ALTER FUNCTION noor_r386_candidate.g234_prevent_split_source_save() OWNER TO noor_r386_g1_guard;
REVOKE CREATE ON SCHEMA noor_r386_candidate FROM noor_r386_g1_guard;
DO $$ DECLARE r text; BEGIN
 FOREACH r IN ARRAY ARRAY['anon','authenticated','service_role','noor_r386_g1_writer'] LOOP
  IF has_table_privilege(r,'noor_r386_candidate.g234_scope','SELECT,INSERT,UPDATE,DELETE')
   OR has_function_privilege(r,'noor_r386_candidate.s3_commit(text,text,boolean,bigint,jsonb,jsonb,text,text,jsonb,text[])','EXECUTE')
   OR pg_has_role(r,'noor_r386_s3_tx','MEMBER')
  THEN RAISE EXCEPTION 'R386_G234_ROLE_LEAK'; END IF;
 END LOOP;
END $$;
