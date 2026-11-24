-- Only installed by the disposable G1 managed-service test runner.
\getenv writer_password R386_G1_WRITER_PASSWORD
BEGIN;
DO $$ BEGIN
  IF current_setting('server_version_num')::integer / 10000 <> 17
    OR to_regclass('storage.objects') IS NULL OR to_regclass('auth.users') IS NULL
    OR to_regclass('public.noor_sessions') IS NOT NULL
    OR to_regclass('public.noor_entitlement_grants') IS NOT NULL
    OR to_regclass('public.noor_authentication_account_linkages') IS NOT NULL
    OR to_regclass('public.noor_personal_foundations') IS NOT NULL
    OR to_regnamespace('noor_r386_candidate') IS NOT NULL
  THEN RAISE EXCEPTION 'R386_G1_DISPOSABLE_FIXTURE_REQUIRED'; END IF;
END $$;

CREATE TEMP TABLE noor_r386_g1_managed_install (marker boolean) ON COMMIT DROP;
CREATE TABLE public.noor_authentication_account_linkages (
  issuer text NOT NULL, subject text NOT NULL, account_id text NOT NULL,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  PRIMARY KEY (issuer,subject)
);
CREATE TABLE public.noor_sessions (
  id text PRIMARY KEY, account_id text NOT NULL, created_at_epoch_ms bigint NOT NULL,
  expires_at_epoch_ms bigint NOT NULL, revoked_at_epoch_ms bigint
);
CREATE TABLE public.noor_entitlement_grants (
  id text PRIMARY KEY, account_id text NOT NULL, action text NOT NULL, resource_type text NOT NULL,
  resource_id text NOT NULL, granted_at_epoch_ms bigint NOT NULL, revoked_at_epoch_ms bigint,
  UNIQUE (account_id,action,resource_type,resource_id)
);
\ir ../../../database/noor-personal/001-foundations.sql
ALTER TABLE public.noor_authentication_account_linkages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.noor_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.noor_entitlement_grants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.noor_personal_foundations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.noor_authentication_account_linkages,public.noor_sessions,
  public.noor_entitlement_grants,public.noor_personal_foundations FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.noor_authentication_account_linkages,public.noor_entitlement_grants,
  public.noor_personal_foundations TO service_role;
GRANT SELECT,INSERT,UPDATE ON public.noor_sessions TO service_role;

\ir s1-persistent-migration.sql
\ir staging-lab-schema.sql
\ir staging-lab-v2.sql
\ir s2-permanent-backfill.sql
\ir s3-atomic-save.sql
-- PG17 non-superuser CREATEROLE installer: allow ownership transfer
-- and ACL setup for newly-created disposable roles only in this transaction.
SET LOCAL createrole_self_grant = 'set, inherit';
\ir s3-isolated-role.sql
\ir g1-noor-session-transaction-fence.sql
\ir g1-noor-session-fence-restricted-role.sql
\ir g1-authoritative-foundation-read.sql
\ir g1-managed-foundation-write.sql
\ir g1-managed-auth-session-binding.sql
\ir s4-analytics-facts.sql
\ir g1-managed-erasure-fixture.sql
ALTER ROLE noor_r386_g1_writer PASSWORD :'writer_password';
NOTIFY pgrst, 'reload schema';
COMMIT;
