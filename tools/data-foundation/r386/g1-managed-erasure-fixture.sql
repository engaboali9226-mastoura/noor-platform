-- Schema for the isolated G1 coordinator exercise. Never installed by the application.
DO $$ BEGIN
  IF to_regclass('pg_temp.noor_r386_g1_managed_install') IS NULL THEN
    RAISE EXCEPTION 'R386_G1_DISPOSABLE_FIXTURE_REQUIRED';
  END IF;
END $$;

CREATE TABLE public.noor_admin_accounts_r271 (
  auth_user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE RESTRICT,
  account_id text NOT NULL UNIQUE,
  role text NOT NULL CHECK (role IN ('admin','super_admin')),
  enabled boolean NOT NULL DEFAULT true
);
CREATE TABLE public.noor_admin_audit_r271 (
  id uuid PRIMARY KEY,
  actor_auth_user_id uuid REFERENCES auth.users(id) ON DELETE RESTRICT,
  target_auth_user_id uuid REFERENCES auth.users(id) ON DELETE RESTRICT,
  actor_erased boolean NOT NULL DEFAULT false,
  target_erased boolean NOT NULL DEFAULT false,
  action text NOT NULL,
  outcome text NOT NULL,
  request_id uuid NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  details jsonb NOT NULL DEFAULT '{}',
  CHECK ((actor_auth_user_id IS NULL) = actor_erased),
  CHECK (NOT target_erased OR target_auth_user_id IS NULL)
);
CREATE TABLE public.tasks (
  id uuid PRIMARY KEY, user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title text NOT NULL, UNIQUE(id,user_id)
);
CREATE TABLE public.task_events (
  id uuid PRIMARY KEY, task_id uuid NOT NULL, user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  FOREIGN KEY(task_id,user_id) REFERENCES public.tasks(id,user_id) ON DELETE CASCADE
);
CREATE TABLE public.habits (
  id uuid PRIMARY KEY, user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name text NOT NULL, UNIQUE(id,user_id)
);
CREATE TABLE public.habit_entries (
  id uuid PRIMARY KEY, habit_id uuid NOT NULL, user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  FOREIGN KEY(habit_id,user_id) REFERENCES public.habits(id,user_id) ON DELETE CASCADE
);
CREATE TABLE public.noor_work_teacher_states_r264 (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE, state jsonb NOT NULL
);
CREATE TABLE public.noor_private_journal_entries_r221 (
  owner_user_id text NOT NULL, id uuid NOT NULL, key_version integer NOT NULL,
  nonce text NOT NULL, tag text NOT NULL, ciphertext text NOT NULL, PRIMARY KEY (owner_user_id,id)
);
REVOKE ALL ON public.noor_admin_accounts_r271,public.noor_admin_audit_r271,public.tasks,
  public.task_events,public.habits,public.habit_entries,public.noor_work_teacher_states_r264,
  public.noor_private_journal_entries_r221 FROM PUBLIC,anon,authenticated,service_role;

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

-- The test Storage bucket shares the operational erasure lock and denies stale
-- owner JWTs even when they still have time left. The service removes objects via API.
CREATE FUNCTION noor_r386_candidate.g1_isolate_storage_owner_active()
RETURNS boolean LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $g1$
DECLARE current_owner uuid := auth.uid();
BEGIN
  IF current_owner IS NULL THEN RETURN false; END IF;
  PERFORM pg_advisory_xact_lock(386017,hashtext(current_owner::text));
  RETURN NOT EXISTS(SELECT 1 FROM noor_r386_candidate.g1_owner_erasure_tombstone t
    WHERE t.owner_id=current_owner::text);
END $g1$;
REVOKE ALL ON FUNCTION noor_r386_candidate.g1_isolate_storage_owner_active() FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION noor_r386_candidate.g1_isolate_storage_owner_active() TO authenticated;
CREATE POLICY g1_managed_erasure_storage ON storage.objects FOR ALL TO authenticated
  USING (bucket_id='r386-g1-erasure' AND (storage.foldername(name))[1]=auth.uid()::text
    AND noor_r386_candidate.g1_isolate_storage_owner_active())
  WITH CHECK (bucket_id='r386-g1-erasure' AND (storage.foldername(name))[1]=auth.uid()::text
    AND noor_r386_candidate.g1_isolate_storage_owner_active());
