-- R385 existing audit table transition: preserve original rows and RESTRICT FKs.
DO $$ BEGIN
 IF to_regclass('pg_temp.noor_r386_g1_managed_install') IS NULL THEN RAISE EXCEPTION 'R386_RELEASE_DISPOSABLE_REQUIRED'; END IF;
END $$;
ALTER TABLE public.noor_admin_audit_r271 ALTER COLUMN actor_auth_user_id DROP NOT NULL;
ALTER TABLE public.noor_admin_audit_r271 ADD COLUMN actor_erased boolean NOT NULL DEFAULT false,
 ADD COLUMN target_erased boolean NOT NULL DEFAULT false,
 ADD CONSTRAINT r386_actor_erased_consistency CHECK((actor_auth_user_id IS NULL)=actor_erased),
 ADD CONSTRAINT r386_target_erased_consistency CHECK(NOT target_erased OR target_auth_user_id IS NULL);
-- The current R385 service role has table-wide TRUNCATE/TRIGGER/REFERENCES
-- on these stores, none required for existing CRUD. Deny those broad rights.
REVOKE TRUNCATE,TRIGGER,REFERENCES ON public.noor_admin_accounts_r271,public.noor_admin_audit_r271,public.noor_work_teacher_states_r264 FROM service_role;
-- Keep the tombstone, pending resume keys and the minimal verification evidence private.
CREATE TABLE noor_r386_candidate.g1_managed_erasure_job (
  target_id uuid PRIMARY KEY,
  erasure_id uuid NOT NULL UNIQUE,
  account_id text,
  target_email text,
  storage_paths text[] NOT NULL,
  auth_session_ids uuid[] NOT NULL,
  auth_factor_ids uuid[] NOT NULL,
  database_verified_at timestamptz,
  completed_at timestamptz,
  CHECK (completed_at IS NULL OR (account_id IS NULL AND target_email IS NULL AND cardinality(storage_paths)=0
    AND cardinality(auth_session_ids)=0 AND cardinality(auth_factor_ids)=0))
);
ALTER TABLE noor_r386_candidate.g1_managed_erasure_job ENABLE ROW LEVEL SECURITY;
ALTER TABLE noor_r386_candidate.g1_managed_erasure_job FORCE ROW LEVEL SECURITY;
REVOKE ALL ON noor_r386_candidate.g1_managed_erasure_job
  FROM PUBLIC,anon,authenticated,service_role,noor_r386_g1_writer,noor_r386_g1_guard;
