\getenv writer_password R386_G1_WRITER_PASSWORD
\getenv scheduler_password R386_RUNTIME_SCHEDULER_PASSWORD
BEGIN;
DO $$ BEGIN
 IF current_setting('server_version_num')::integer/10000<>17 OR to_regnamespace('noor_r386_candidate') IS NOT NULL
 OR to_regclass('public.noor_sessions') IS NULL OR to_regclass('public.noor_admin_audit_r271') IS NULL
 OR NOT EXISTS(SELECT 1 FROM public.noor_sessions)
 THEN RAISE EXCEPTION 'R386_RELEASE_NONEMPTY_ISOLATE_REQUIRED'; END IF;
END $$;
CREATE TEMP TABLE noor_r386_g1_managed_install(marker boolean) ON COMMIT DROP;
\ir s1-persistent-migration.sql
\ir g234-scope.sql
\ir g234-s2-source.sql
\ir g234-s3-source.sql
-- PG17 non-superuser CREATEROLE installer: allow ownership transfer
-- and ACL setup for newly-created disposable roles only in this transaction.
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
NOTIFY pgrst, 'reload schema';
COMMIT;
