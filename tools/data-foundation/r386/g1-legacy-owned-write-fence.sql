-- Disposable direct-owner legacy write fence; never apply to production/R219.
DO $$ BEGIN
  IF to_regclass('pg_temp.noor_r386_g1_managed_install') IS NULL
    OR to_regclass('noor_r386_candidate.g1_owner_erasure_tombstone') IS NULL
  THEN RAISE EXCEPTION 'R386_G1_LEGACY_FIXTURE_REQUIRED'; END IF;
END $$;

-- A volatile, restricted trigger uses the same lock as the existing tombstone.
-- READ COMMITTED is mandatory: a pre-lock repeatable-read snapshot is unsafe.
CREATE FUNCTION noor_r386_candidate.g1_fence_legacy_owner_write()
RETURNS trigger LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=pg_catalog AS $fence$
DECLARE field_name text; raw_owner text; owner_key text;
BEGIN
  IF TG_TABLE_SCHEMA <> 'public' OR TG_OP NOT IN ('INSERT','UPDATE')
    OR current_setting('transaction_isolation') <> 'read committed'
  THEN RAISE EXCEPTION 'R386_G1_LEGACY_WRITE_CONTEXT_DENIED'; END IF;
  CASE TG_TABLE_NAME
    WHEN 'tasks','task_events','habits','habit_entries',
         'noor_personal_foundations','noor_work_teacher_states_r264'
      THEN field_name := 'user_id';
    WHEN 'noor_private_journal_entries_r221' THEN field_name := 'owner_user_id';
    ELSE RAISE EXCEPTION 'R386_G1_LEGACY_WRITE_CONTEXT_DENIED';
  END CASE;
  raw_owner := to_jsonb(NEW)->>field_name;
  -- Do not silently accept ambiguous legacy owner keys. Rollout requires
  -- a separately verified mapping of existing non-UUID keys, if any.
  IF raw_owner IS NULL OR raw_owner !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  THEN RAISE EXCEPTION 'R386_G1_LEGACY_OWNER_KEY_DENIED'; END IF;
  owner_key := raw_owner::uuid::text;
  IF TG_OP='UPDATE' AND (to_jsonb(OLD)->>field_name) IS DISTINCT FROM raw_owner
  THEN RAISE EXCEPTION 'R386_G1_LEGACY_OWNER_CHANGE_DENIED'; END IF;
  PERFORM pg_advisory_xact_lock(386017,hashtext(owner_key));
  IF EXISTS (SELECT 1 FROM noor_r386_candidate.g1_owner_erasure_tombstone
             WHERE owner_id=owner_key)
  THEN RAISE EXCEPTION 'R386_G1_LEGACY_ERASED_OWNER_DENIED'; END IF;
  RETURN NEW;
END $fence$;

DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['tasks','task_events','habits','habit_entries',
      'noor_personal_foundations','noor_work_teacher_states_r264','noor_private_journal_entries_r221']
  LOOP
    EXECUTE format('CREATE TRIGGER g1_legacy_owner_write_fence BEFORE INSERT OR UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION noor_r386_candidate.g1_fence_legacy_owner_write()',t);
  END LOOP;
END $$;

REVOKE ALL ON FUNCTION noor_r386_candidate.g1_fence_legacy_owner_write()
  FROM PUBLIC,anon,authenticated,service_role,noor_r386_g1_writer;
GRANT CREATE ON SCHEMA noor_r386_candidate TO noor_r386_g1_guard;
ALTER FUNCTION noor_r386_candidate.g1_fence_legacy_owner_write() OWNER TO noor_r386_g1_guard;
REVOKE CREATE ON SCHEMA noor_r386_candidate FROM noor_r386_g1_guard;

DO $$ DECLARE r text; BEGIN
  FOREACH r IN ARRAY ARRAY['anon','authenticated','service_role','noor_r386_g1_writer']
  LOOP
    IF has_function_privilege(r,'noor_r386_candidate.g1_fence_legacy_owner_write()','EXECUTE')
    THEN RAISE EXCEPTION 'R386_G1_LEGACY_TRIGGER_ACL_LEAK'; END IF;
  END LOOP;
  IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_roles r ON r.oid=p.proowner
    WHERE p.oid='noor_r386_candidate.g1_fence_legacy_owner_write()'::regprocedure
      AND p.prosecdef AND r.rolname='noor_r386_g1_guard'
      AND NOT r.rolcanlogin AND NOT r.rolsuper AND NOT r.rolbypassrls)
  THEN RAISE EXCEPTION 'R386_G1_LEGACY_TRIGGER_OWNER_UNSAFE'; END IF;
END $$;
