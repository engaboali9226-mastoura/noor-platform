\set ON_ERROR_STOP on
\getenv writer_password R386_G1_WRITER_PASSWORD
\getenv scheduler_password R386_RUNTIME_SCHEDULER_PASSWORD
BEGIN;
SET LOCAL lock_timeout='10s';
SET LOCAL statement_timeout='120s';
SELECT set_config('noor.r386_install_authority', :'r386_release_authority', true) IS NOT NULL AS authority_supplied;
DO $pre$
DECLARE n integer;
BEGIN
 IF current_setting('noor.r386_install_authority',true) IS DISTINCT FROM
 'R386-PRODUCTION-dmveacjfozoulimlxuvk-638909371e9824b27f042ba2c0594d53271d2ed5'
 OR current_database()<>'postgres' OR current_user<>'postgres'
 OR current_setting('server_version_num')::integer/10000<>17
 OR NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname=current_user AND NOT rolsuper AND rolbypassrls AND rolcreaterole)
 OR to_regnamespace('noor_r386_candidate') IS NOT NULL
 OR EXISTS(SELECT 1 FROM pg_roles WHERE rolname LIKE 'noor_r386_%')
 OR NOT EXISTS(SELECT 1 FROM public.noor_sessions)
 OR EXISTS(SELECT 1 FROM public.noor_admin_audit_r271 WHERE actor_auth_user_id IS NULL)
 OR EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public'
 AND ((table_name='noor_sessions' AND column_name='originating_auth_session_id')
 OR (table_name='noor_admin_audit_r271' AND column_name IN ('actor_erased','target_erased'))))
 THEN RAISE EXCEPTION 'R386_PRODUCTION_PRECONDITION_DENIED'; END IF;
 SELECT count(*) INTO n FROM pg_class c JOIN pg_namespace ns ON ns.oid=c.relnamespace
 WHERE ns.nspname='public' AND c.relkind='r' AND c.relrowsecurity
 AND c.relname IN ('habit_entries','habits','noor_admin_accounts_r271','noor_admin_audit_r271',
 'noor_authentication_account_linkages','noor_entitlement_grants','noor_personal_foundations',
 'noor_private_journal_entries_r221','noor_sessions','noor_work_teacher_states_r264','task_events','tasks');
 IF n<>12 THEN RAISE EXCEPTION 'R386_PRODUCTION_RLS_PRECONDITION'; END IF;
END $pre$;
LOCK TABLE public.habit_entries,public.habits,public.noor_admin_accounts_r271,
 public.noor_admin_audit_r271,public.noor_authentication_account_linkages,
 public.noor_entitlement_grants,public.noor_personal_foundations,
 public.noor_private_journal_entries_r221,public.noor_sessions,
 public.noor_work_teacher_states_r264,public.task_events,public.tasks
 IN SHARE ROW EXCLUSIVE MODE;
CREATE TEMP TABLE r386_release_original_fingerprints (
 table_name text PRIMARY KEY, row_count bigint NOT NULL, digest text NOT NULL
) ON COMMIT DROP;
DO $fingerprints$
DECLARE t text; n bigint; h text;
BEGIN
 FOREACH t IN ARRAY ARRAY['habit_entries','habits','noor_admin_accounts_r271','noor_admin_audit_r271',
 'noor_authentication_account_linkages','noor_entitlement_grants','noor_personal_foundations',
 'noor_private_journal_entries_r221','noor_sessions','noor_work_teacher_states_r264','task_events','tasks'] LOOP
 EXECUTE format('SELECT count(*),encode(sha256(convert_to(coalesce(string_agg(d, '''' ORDER BY d),''''),''UTF8'')),''hex'') FROM (SELECT encode(sha256(convert_to(to_jsonb(t)::text,''UTF8'')),''hex'') AS d FROM public.%I t) q',t)
 INTO n,h;
 INSERT INTO pg_temp.r386_release_original_fingerprints VALUES(t,n,h);
 END LOOP;
END $fingerprints$;
-- Preserve the original include guards; this is the separately reviewed
-- release entry, not execution of the disposable entry on production.
CREATE TEMP TABLE noor_r386_g1_managed_install(marker boolean) ON COMMIT DROP;
\ir s1-persistent-migration.sql
\ir g234-scope.sql
\ir g234-s2-source.sql
\ir g234-s3-source.sql
SET LOCAL createrole_self_grant = 'set, inherit';
\ir r386-hosted-s3-role.sql
\ir g1-noor-session-transaction-fence.sql
\ir g1-managed-guard-role.sql
\ir g1-authoritative-foundation-read.sql
\ir g1-managed-foundation-write.sql
\ir r386-release-session-transition.sql
\ir g234-s4-source.sql
\ir r386-hosted-erasure-store.sql
\ir g1-legacy-owned-write-fence.sql
\ir g1-identity-write-fence.sql
\ir g1-retention-lock.sql
\ir g234-source-acl.sql
\ir g234-scheduler-role.sql
\ir r386-hosted-cohort.sql
ALTER ROLE noor_r386_g234_scheduler PASSWORD :'scheduler_password';
ALTER ROLE noor_r386_g1_writer PASSWORD :'writer_password';
DO $post$
DECLARE original record; omitted text[]; n bigint; h text; r text;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM noor_r386_candidate.g234_session_binding_state WHERE singleton AND NOT active)
 OR EXISTS(SELECT 1 FROM noor_r386_candidate.g234_scope)
 OR EXISTS(SELECT 1 FROM noor_r386_candidate.s3_enrollment)
 OR EXISTS(SELECT 1 FROM noor_r386_candidate.command_receipt)
 OR EXISTS(SELECT 1 FROM noor_r386_candidate.g1_managed_erasure_job)
 THEN RAISE EXCEPTION 'R386_PRODUCTION_NOT_DORMANT'; END IF;
 FOREACH r IN ARRAY ARRAY['noor_r386_g1_writer','noor_r386_g234_scheduler'] LOOP
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname=r AND rolcanlogin AND NOT rolsuper
 AND NOT rolbypassrls AND NOT rolcreatedb AND NOT rolcreaterole AND NOT rolinherit)
 OR has_schema_privilege(r,'auth','USAGE')
 OR has_schema_privilege(r,'noor_r386_candidate','CREATE')
 THEN RAISE EXCEPTION 'R386_PRODUCTION_RUNTIME_ROLE_DENIED'; END IF;
 END LOOP;
 FOR original IN SELECT * FROM pg_temp.r386_release_original_fingerprints LOOP
 omitted:=CASE original.table_name WHEN 'noor_sessions' THEN ARRAY['originating_auth_session_id']
 WHEN 'noor_admin_audit_r271' THEN ARRAY['actor_erased','target_erased'] ELSE ARRAY[]::text[] END;
 EXECUTE format('SELECT count(*),encode(sha256(convert_to(coalesce(string_agg(d, '''' ORDER BY d),''''),''UTF8'')),''hex'') FROM (SELECT encode(sha256(convert_to((to_jsonb(t)-$1)::text,''UTF8'')),''hex'') AS d FROM public.%I t) q',original.table_name)
 INTO n,h USING omitted;
 IF n IS DISTINCT FROM original.row_count OR h IS DISTINCT FROM original.digest
 THEN RAISE EXCEPTION 'R386_PRODUCTION_ORIGINAL_ROWS_CHANGED: %',original.table_name; END IF;
 END LOOP;
 RAISE NOTICE 'R386_PRODUCTION_ORIGINAL_12_TABLES_UNCHANGED';
 RAISE NOTICE 'R386_PRODUCTION_BINDING_COHORT_ERASURE_DORMANT';
END $post$;
NOTIFY pgrst, 'reload schema';
COMMIT;
SELECT 'R386_PRODUCTION_DORMANT_INSTALL_COMMITTED' AS result;
