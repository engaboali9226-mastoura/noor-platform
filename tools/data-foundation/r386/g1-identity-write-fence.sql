-- Disposable G1 account/identity write fences; not a production migration.
DO $$ BEGIN
  IF to_regclass('pg_temp.noor_r386_g1_managed_install') IS NULL
    OR to_regclass('noor_r386_candidate.g1_managed_erasure_job') IS NULL
  THEN RAISE EXCEPTION 'R386_G1_IDENTITY_FIXTURE_REQUIRED'; END IF;
END $$;

-- Account IDs are high-entropy opaque keys. Retain only a pseudonymous digest
-- for non-reassignment, not an anonymization or an erasure-completion claim.
CREATE TABLE noor_r386_candidate.g1_erased_account_digest (
  account_digest bytea PRIMARY KEY CHECK(octet_length(account_digest)=32)
);
ALTER TABLE noor_r386_candidate.g1_erased_account_digest ENABLE ROW LEVEL SECURITY;
ALTER TABLE noor_r386_candidate.g1_erased_account_digest FORCE ROW LEVEL SECURITY;
REVOKE ALL ON noor_r386_candidate.g1_erased_account_digest
  FROM PUBLIC,anon,authenticated,service_role,noor_r386_g1_writer,noor_r386_g1_guard;
GRANT SELECT,INSERT ON noor_r386_candidate.g1_erased_account_digest TO noor_r386_g1_guard;
CREATE POLICY g1_erased_account_read ON noor_r386_candidate.g1_erased_account_digest
 FOR SELECT TO noor_r386_g1_guard USING(true);
CREATE POLICY g1_erased_account_insert ON noor_r386_candidate.g1_erased_account_digest
 FOR INSERT TO noor_r386_g1_guard WITH CHECK(true);

CREATE FUNCTION noor_r386_candidate.g1_lock_account_key(p_account text)
RETURNS bytea LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path=pg_catalog AS $g1$
BEGIN
 IF p_account IS NULL OR length(p_account) NOT BETWEEN 1 AND 256
   OR current_setting('transaction_isolation') <> 'read committed'
 THEN RAISE EXCEPTION 'R386_G1_IDENTITY_CONTEXT_DENIED'; END IF;
 PERFORM pg_advisory_xact_lock(386018,hashtext(p_account));
 RETURN sha256(convert_to(p_account,'UTF8'));
END $g1$;

CREATE FUNCTION noor_r386_candidate.g1_assert_account_active(p_account text)
RETURNS uuid LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path=pg_catalog AS $g1$
DECLARE d bytea; o uuid; l record; n integer:=0;
BEGIN
 d:=noor_r386_candidate.g1_lock_account_key(p_account);
 IF EXISTS(SELECT 1 FROM noor_r386_candidate.g1_erased_account_digest WHERE account_digest=d)
 THEN RAISE EXCEPTION 'R386_G1_IDENTITY_ERASED_ACCOUNT_DENIED'; END IF;
 SELECT user_id INTO o FROM public.noor_authentication_account_linkages
  WHERE account_id=p_account ORDER BY user_id LIMIT 1;
 IF NOT FOUND THEN RAISE EXCEPTION 'R386_G1_IDENTITY_LINKAGE_DENIED'; END IF;
 PERFORM pg_advisory_xact_lock(386017,hashtext(o::text));
 IF EXISTS(SELECT 1 FROM noor_r386_candidate.g1_owner_erasure_tombstone WHERE owner_id=o::text)
 THEN RAISE EXCEPTION 'R386_G1_IDENTITY_ERASED_ACCOUNT_DENIED'; END IF;
 FOR l IN SELECT user_id,subject FROM public.noor_authentication_account_linkages
   WHERE account_id=p_account FOR SHARE
 LOOP
   n:=n+1;
   IF l.user_id IS DISTINCT FROM o OR l.subject IS DISTINCT FROM o::text
   THEN RAISE EXCEPTION 'R386_G1_IDENTITY_LINKAGE_DENIED'; END IF;
 END LOOP;
 IF n=0 THEN RAISE EXCEPTION 'R386_G1_IDENTITY_LINKAGE_DENIED'; END IF;
 RETURN o;
END $g1$;

CREATE FUNCTION noor_r386_candidate.g1_record_erased_account()
RETURNS trigger LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $g1$
DECLARE d bytea;
BEGIN
 PERFORM pg_advisory_xact_lock(386017,hashtext(NEW.target_id::text));
 d:=noor_r386_candidate.g1_lock_account_key(NEW.account_id);
 IF NOT EXISTS(SELECT 1 FROM noor_r386_candidate.g1_owner_erasure_tombstone WHERE owner_id=NEW.target_id::text)
   OR NOT EXISTS(SELECT 1 FROM public.noor_authentication_account_linkages
      WHERE account_id=NEW.account_id AND user_id=NEW.target_id AND subject=NEW.target_id::text)
   OR EXISTS(SELECT 1 FROM public.noor_authentication_account_linkages
      WHERE account_id=NEW.account_id AND user_id<>NEW.target_id)
 THEN RAISE EXCEPTION 'R386_G1_IDENTITY_JOB_FENCE_DENIED'; END IF;
 INSERT INTO noor_r386_candidate.g1_erased_account_digest VALUES(d) ON CONFLICT DO NOTHING;
 RETURN NEW;
END $g1$;

CREATE FUNCTION noor_r386_candidate.g1_fence_identity_write()
RETURNS trigger LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $g1$
DECLARE d bytea; o uuid;
BEGIN
 IF TG_TABLE_SCHEMA<>'public' OR TG_OP NOT IN ('INSERT','UPDATE')
   OR current_setting('transaction_isolation')<>'read committed'
 THEN RAISE EXCEPTION 'R386_G1_IDENTITY_CONTEXT_DENIED'; END IF;
 CASE TG_TABLE_NAME
 WHEN 'noor_authentication_account_linkages' THEN
   IF TG_OP='UPDATE' AND to_jsonb(NEW) IS DISTINCT FROM to_jsonb(OLD)
   THEN RAISE EXCEPTION 'R386_G1_IDENTITY_LINKAGE_IMMUTABLE'; END IF;
   d:=noor_r386_candidate.g1_lock_account_key(NEW.account_id);
   PERFORM pg_advisory_xact_lock(386017,hashtext(NEW.user_id::text));
   IF NEW.subject IS DISTINCT FROM NEW.user_id::text
     OR EXISTS(SELECT 1 FROM public.noor_authentication_account_linkages
       WHERE account_id=NEW.account_id AND user_id<>NEW.user_id)
   THEN RAISE EXCEPTION 'R386_G1_IDENTITY_LINKAGE_DENIED'; END IF;
   IF EXISTS(SELECT 1 FROM noor_r386_candidate.g1_erased_account_digest WHERE account_digest=d)
     OR EXISTS(SELECT 1 FROM noor_r386_candidate.g1_owner_erasure_tombstone WHERE owner_id=NEW.user_id::text)
   THEN RAISE EXCEPTION 'R386_G1_IDENTITY_ERASED_ACCOUNT_DENIED'; END IF;
 WHEN 'noor_entitlement_grants','noor_sessions' THEN
   IF TG_OP='UPDATE' AND (NEW.account_id IS DISTINCT FROM OLD.account_id OR NEW.id IS DISTINCT FROM OLD.id)
   THEN RAISE EXCEPTION 'R386_G1_IDENTITY_LINKAGE_IMMUTABLE'; END IF;
   -- Revocation is a monotonic, revocation-only update. It must remain
   -- possible after the fence. It cannot change identity, expiry or grant.
   IF TG_OP='UPDATE' AND NEW.revoked_at_epoch_ms IS NOT NULL
      AND (OLD.revoked_at_epoch_ms IS NULL OR NEW.revoked_at_epoch_ms=OLD.revoked_at_epoch_ms)
      AND (to_jsonb(NEW)-'revoked_at_epoch_ms')=(to_jsonb(OLD)-'revoked_at_epoch_ms')
   THEN RETURN NEW; END IF;
   o:=noor_r386_candidate.g1_assert_account_active(NEW.account_id);
 WHEN 'noor_admin_accounts_r271' THEN
   IF TG_OP='UPDATE' AND (NEW.account_id IS DISTINCT FROM OLD.account_id OR NEW.auth_user_id IS DISTINCT FROM OLD.auth_user_id)
   THEN RAISE EXCEPTION 'R386_G1_IDENTITY_LINKAGE_IMMUTABLE'; END IF;
   IF TG_OP='UPDATE' AND NOT NEW.enabled
     AND (to_jsonb(NEW)-'enabled')=(to_jsonb(OLD)-'enabled')
   THEN RETURN NEW; END IF;
   o:=noor_r386_candidate.g1_assert_account_active(NEW.account_id);
   IF o IS DISTINCT FROM NEW.auth_user_id
   THEN RAISE EXCEPTION 'R386_G1_IDENTITY_LINKAGE_DENIED'; END IF;
 ELSE RAISE EXCEPTION 'R386_G1_IDENTITY_CONTEXT_DENIED';
 END CASE;
 RETURN NEW;
END $g1$;

-- Guard new structured audit events, without blocking authorized historical
-- scrubbing. This does not certify arbitrary free-text audit redaction.
CREATE FUNCTION noor_r386_candidate.g1_fence_audit_insert()
RETURNS trigger LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $g1$
DECLARE d bytea; k text; o uuid;
BEGIN
 IF current_setting('transaction_isolation')<>'read committed'
 THEN RAISE EXCEPTION 'R386_G1_IDENTITY_CONTEXT_DENIED'; END IF;
 k:=NEW.details->>'accountId';
 IF k IS NOT NULL THEN
   d:=noor_r386_candidate.g1_lock_account_key(k);
   IF EXISTS(SELECT 1 FROM noor_r386_candidate.g1_erased_account_digest WHERE account_digest=d)
   THEN RAISE EXCEPTION 'R386_G1_IDENTITY_ERASED_ACCOUNT_DENIED'; END IF;
 END IF;
 FOR o IN SELECT DISTINCT x FROM unnest(ARRAY[NEW.actor_auth_user_id,NEW.target_auth_user_id]) x
          WHERE x IS NOT NULL ORDER BY x
 LOOP
   PERFORM pg_advisory_xact_lock(386017,hashtext(o::text));
   IF EXISTS(SELECT 1 FROM noor_r386_candidate.g1_owner_erasure_tombstone WHERE owner_id=o::text)
   THEN RAISE EXCEPTION 'R386_G1_IDENTITY_ERASED_ACCOUNT_DENIED'; END IF;
 END LOOP;
 -- Account-creation initiated audit precedes creation of its linkage.
 IF k IS NOT NULL AND EXISTS(SELECT 1 FROM public.noor_authentication_account_linkages WHERE account_id=k)
 THEN PERFORM noor_r386_candidate.g1_assert_account_active(k); END IF;
 RETURN NEW;
END $g1$;

CREATE TRIGGER g1_record_erased_account BEFORE INSERT ON noor_r386_candidate.g1_managed_erasure_job
 FOR EACH ROW EXECUTE FUNCTION noor_r386_candidate.g1_record_erased_account();
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['noor_authentication_account_linkages','noor_entitlement_grants','noor_sessions','noor_admin_accounts_r271']
 LOOP
 EXECUTE format('CREATE TRIGGER g1_identity_write_fence BEFORE INSERT OR UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION noor_r386_candidate.g1_fence_identity_write()',t);
 END LOOP;
END $$;
CREATE TRIGGER g1_audit_write_fence BEFORE INSERT ON public.noor_admin_audit_r271
 FOR EACH ROW EXECUTE FUNCTION noor_r386_candidate.g1_fence_audit_insert();

REVOKE ALL ON FUNCTION
 noor_r386_candidate.g1_lock_account_key(text),noor_r386_candidate.g1_assert_account_active(text),
 noor_r386_candidate.g1_record_erased_account(),noor_r386_candidate.g1_fence_identity_write(),
 noor_r386_candidate.g1_fence_audit_insert()
 FROM PUBLIC,anon,authenticated,service_role,noor_r386_g1_writer;
GRANT CREATE ON SCHEMA noor_r386_candidate TO noor_r386_g1_guard;
ALTER FUNCTION noor_r386_candidate.g1_lock_account_key(text) OWNER TO noor_r386_g1_guard;
ALTER FUNCTION noor_r386_candidate.g1_assert_account_active(text) OWNER TO noor_r386_g1_guard;
ALTER FUNCTION noor_r386_candidate.g1_record_erased_account() OWNER TO noor_r386_g1_guard;
ALTER FUNCTION noor_r386_candidate.g1_fence_identity_write() OWNER TO noor_r386_g1_guard;
ALTER FUNCTION noor_r386_candidate.g1_fence_audit_insert() OWNER TO noor_r386_g1_guard;
REVOKE CREATE ON SCHEMA noor_r386_candidate FROM noor_r386_g1_guard;
DO $$ DECLARE r text; f text; BEGIN
 FOREACH r IN ARRAY ARRAY['anon','authenticated','service_role','noor_r386_g1_writer'] LOOP
  IF has_table_privilege(r,'noor_r386_candidate.g1_erased_account_digest','SELECT,INSERT,UPDATE,DELETE')
  THEN RAISE EXCEPTION 'R386_G1_IDENTITY_DIGEST_ACL_LEAK'; END IF;
  FOREACH f IN ARRAY ARRAY['g1_lock_account_key(text)','g1_assert_account_active(text)',
   'g1_record_erased_account()','g1_fence_identity_write()','g1_fence_audit_insert()']
  LOOP
   IF has_function_privilege(r,'noor_r386_candidate.'||f,'EXECUTE')
   THEN RAISE EXCEPTION 'R386_G1_IDENTITY_FUNCTION_ACL_LEAK'; END IF;
  END LOOP;
 END LOOP;
END $$;
