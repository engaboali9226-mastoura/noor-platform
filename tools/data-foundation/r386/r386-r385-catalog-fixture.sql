-- Read-only R385 public-table catalog snapshot, 2026-11-24. NO ROW DATA.
-- Recreate table shapes only in a fresh disposable managed local PostgreSQL.
BEGIN;
SET LOCAL search_path=public,pg_catalog;
DO $$ BEGIN
 IF to_regnamespace('noor_r386_candidate') IS NOT NULL OR EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname IN ('habit_entries','habits','noor_admin_accounts_r271','noor_admin_audit_r271','noor_authentication_account_linkages','noor_entitlement_grants','noor_personal_foundations','noor_private_journal_entries_r221','noor_sessions','noor_work_teacher_states_r264','task_events','tasks')) THEN RAISE EXCEPTION 'R386_RELEASE_FRESH_LAB_REQUIRED'; END IF;
END $$;
CREATE TABLE public."habit_entries" (
 "id" uuid DEFAULT gen_random_uuid() NOT NULL,
 "habit_id" uuid NOT NULL,
 "user_id" uuid NOT NULL,
 "entry_date" date NOT NULL,
 "value" numeric(12,3) DEFAULT 1 NOT NULL,
 "completed" boolean DEFAULT true NOT NULL,
 "note" text,
 "created_at" timestamp with time zone DEFAULT now() NOT NULL,
 "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE public."habits" (
 "id" uuid DEFAULT gen_random_uuid() NOT NULL,
 "user_id" uuid NOT NULL,
 "name" text NOT NULL,
 "notes" text,
 "active" boolean DEFAULT true NOT NULL,
 "target_count" smallint DEFAULT 1 NOT NULL,
 "target_period" text DEFAULT 'day'::text NOT NULL,
 "recurrence_rule" text,
 "created_at" timestamp with time zone DEFAULT now() NOT NULL,
 "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE public."noor_admin_accounts_r271" (
 "auth_user_id" uuid NOT NULL,
 "account_id" text NOT NULL,
 "role" text NOT NULL,
 "enabled" boolean DEFAULT true NOT NULL,
 "created_at" timestamp with time zone DEFAULT now() NOT NULL,
 "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE public."noor_admin_audit_r271" (
 "id" uuid DEFAULT gen_random_uuid() NOT NULL,
 "actor_auth_user_id" uuid NOT NULL,
 "target_auth_user_id" uuid,
 "action" text NOT NULL,
 "outcome" text NOT NULL,
 "request_id" uuid NOT NULL,
 "occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
 "details" jsonb DEFAULT '{}'::jsonb NOT NULL
);
CREATE TABLE public."noor_authentication_account_linkages" (
 "issuer" text NOT NULL,
 "subject" text NOT NULL,
 "account_id" text NOT NULL,
 "user_id" uuid NOT NULL
);
CREATE TABLE public."noor_entitlement_grants" (
 "id" text NOT NULL,
 "account_id" text NOT NULL,
 "action" text NOT NULL,
 "resource_type" text NOT NULL,
 "resource_id" text NOT NULL,
 "granted_at_epoch_ms" bigint NOT NULL,
 "revoked_at_epoch_ms" bigint
);
CREATE TABLE public."noor_personal_foundations" (
 "user_id" text NOT NULL,
 "schema_version" integer NOT NULL,
 "revision" bigint NOT NULL,
 "state" jsonb NOT NULL,
 "created_at" timestamp with time zone DEFAULT now() NOT NULL,
 "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE public."noor_private_journal_entries_r221" (
 "owner_user_id" text NOT NULL,
 "id" uuid NOT NULL,
 "created_at" timestamp with time zone NOT NULL,
 "key_version" integer NOT NULL,
 "nonce" text NOT NULL,
 "tag" text NOT NULL,
 "ciphertext" text NOT NULL
);
CREATE TABLE public."noor_sessions" (
 "id" text NOT NULL,
 "account_id" text NOT NULL,
 "created_at_epoch_ms" bigint NOT NULL,
 "expires_at_epoch_ms" bigint NOT NULL,
 "revoked_at_epoch_ms" bigint
);
CREATE TABLE public."noor_work_teacher_states_r264" (
 "user_id" uuid NOT NULL,
 "revision" bigint DEFAULT 0 NOT NULL,
 "state" jsonb NOT NULL,
 "created_at" timestamp with time zone DEFAULT now() NOT NULL,
 "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE public."task_events" (
 "id" uuid DEFAULT gen_random_uuid() NOT NULL,
 "task_id" uuid NOT NULL,
 "user_id" uuid NOT NULL,
 "event_type" text NOT NULL,
 "occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
 "payload" jsonb DEFAULT '{}'::jsonb NOT NULL
);
CREATE TABLE public."tasks" (
 "id" uuid DEFAULT gen_random_uuid() NOT NULL,
 "user_id" uuid NOT NULL,
 "title" text NOT NULL,
 "notes" text,
 "status" text DEFAULT 'pending'::text NOT NULL,
 "priority" smallint DEFAULT 0 NOT NULL,
 "due_at" timestamp with time zone,
 "recurrence_rule" text,
 "completed_at" timestamp with time zone,
 "created_at" timestamp with time zone DEFAULT now() NOT NULL,
 "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
ALTER TABLE public."habit_entries" ADD CONSTRAINT "habit_entries_habit_id_user_id_entry_date_key" UNIQUE (habit_id, user_id, entry_date);
ALTER TABLE public."habit_entries" ADD CONSTRAINT "habit_entries_pkey" PRIMARY KEY (id);
ALTER TABLE public."habit_entries" ADD CONSTRAINT "habit_entries_value_check" CHECK (value >= 0::numeric);
ALTER TABLE public."habits" ADD CONSTRAINT "habits_id_user_id_key" UNIQUE (id, user_id);
ALTER TABLE public."habits" ADD CONSTRAINT "habits_name_check" CHECK (char_length(btrim(name)) >= 1 AND char_length(btrim(name)) <= 160);
ALTER TABLE public."habits" ADD CONSTRAINT "habits_pkey" PRIMARY KEY (id);
ALTER TABLE public."habits" ADD CONSTRAINT "habits_target_count_check" CHECK (target_count > 0);
ALTER TABLE public."habits" ADD CONSTRAINT "habits_target_period_check" CHECK (target_period = ANY (ARRAY['day'::text, 'week'::text, 'month'::text]));
ALTER TABLE public."noor_admin_accounts_r271" ADD CONSTRAINT "noor_admin_accounts_r271_account_id_key" UNIQUE (account_id);
ALTER TABLE public."noor_admin_accounts_r271" ADD CONSTRAINT "noor_admin_accounts_r271_pkey" PRIMARY KEY (auth_user_id);
ALTER TABLE public."noor_admin_accounts_r271" ADD CONSTRAINT "noor_admin_accounts_r271_role_check" CHECK (role = ANY (ARRAY['super_admin'::text, 'admin'::text]));
ALTER TABLE public."noor_admin_audit_r271" ADD CONSTRAINT "noor_admin_audit_r271_action_check" CHECK (length(action) >= 3 AND length(action) <= 100);
ALTER TABLE public."noor_admin_audit_r271" ADD CONSTRAINT "noor_admin_audit_r271_outcome_check" CHECK (outcome = ANY (ARRAY['initiated'::text, 'success'::text, 'denied'::text, 'failure'::text]));
ALTER TABLE public."noor_admin_audit_r271" ADD CONSTRAINT "noor_admin_audit_r271_pkey" PRIMARY KEY (id);
ALTER TABLE public."noor_authentication_account_linkages" ADD CONSTRAINT "noor_authentication_account_linkages_account_id_check" CHECK (char_length(btrim(account_id)) > 0 AND account_id = btrim(account_id));
ALTER TABLE public."noor_authentication_account_linkages" ADD CONSTRAINT "noor_authentication_account_linkages_issuer_check" CHECK (char_length(btrim(issuer)) > 0 AND issuer = btrim(issuer));
ALTER TABLE public."noor_authentication_account_linkages" ADD CONSTRAINT "noor_authentication_account_linkages_pkey" PRIMARY KEY (issuer, subject);
ALTER TABLE public."noor_authentication_account_linkages" ADD CONSTRAINT "noor_authentication_account_linkages_subject_check" CHECK (char_length(btrim(subject)) > 0 AND subject = btrim(subject));
ALTER TABLE public."noor_entitlement_grants" ADD CONSTRAINT "noor_entitlement_grants_account_id_check" CHECK (char_length(btrim(account_id)) > 0 AND account_id = btrim(account_id));
ALTER TABLE public."noor_entitlement_grants" ADD CONSTRAINT "noor_entitlement_grants_action_check" CHECK (action ~ '^[A-Za-z0-9._:-]{3,128}$'::text);
ALTER TABLE public."noor_entitlement_grants" ADD CONSTRAINT "noor_entitlement_grants_exact_scope_key" UNIQUE (account_id, action, resource_type, resource_id);
ALTER TABLE public."noor_entitlement_grants" ADD CONSTRAINT "noor_entitlement_grants_granted_at_epoch_ms_check" CHECK (granted_at_epoch_ms >= 0);
ALTER TABLE public."noor_entitlement_grants" ADD CONSTRAINT "noor_entitlement_grants_id_check" CHECK (char_length(id) >= 16 AND char_length(id) <= 256 AND id ~ '^[A-Za-z0-9._~-]+$'::text);
ALTER TABLE public."noor_entitlement_grants" ADD CONSTRAINT "noor_entitlement_grants_pkey" PRIMARY KEY (id);
ALTER TABLE public."noor_entitlement_grants" ADD CONSTRAINT "noor_entitlement_grants_resource_id_check" CHECK (char_length(resource_id) >= 1 AND char_length(resource_id) <= 256 AND resource_id ~ '^[A-Za-z0-9._:~-]+$'::text);
ALTER TABLE public."noor_entitlement_grants" ADD CONSTRAINT "noor_entitlement_grants_resource_type_check" CHECK (resource_type ~ '^[A-Za-z0-9._:-]{1,64}$'::text);
ALTER TABLE public."noor_entitlement_grants" ADD CONSTRAINT "noor_entitlement_grants_revocation_order_check" CHECK (revoked_at_epoch_ms IS NULL OR revoked_at_epoch_ms >= granted_at_epoch_ms);
ALTER TABLE public."noor_personal_foundations" ADD CONSTRAINT "noor_personal_foundations_pkey" PRIMARY KEY (user_id);
ALTER TABLE public."noor_personal_foundations" ADD CONSTRAINT "noor_personal_foundations_revision_check" CHECK (revision >= 0);
ALTER TABLE public."noor_personal_foundations" ADD CONSTRAINT "noor_personal_foundations_schema_version_check" CHECK (schema_version = 1);
ALTER TABLE public."noor_personal_foundations" ADD CONSTRAINT "noor_personal_foundations_state_check" CHECK (jsonb_typeof(state) = 'object'::text);
ALTER TABLE public."noor_personal_foundations" ADD CONSTRAINT "noor_personal_foundations_user_id_check" CHECK (char_length(btrim(user_id)) > 0 AND user_id = btrim(user_id));
ALTER TABLE public."noor_private_journal_entries_r221" ADD CONSTRAINT "noor_private_journal_entries_r221_ciphertext_check" CHECK (length(ciphertext) >= 4 AND length(ciphertext) <= 100000);
ALTER TABLE public."noor_private_journal_entries_r221" ADD CONSTRAINT "noor_private_journal_entries_r221_key_version_check" CHECK (key_version >= 1 AND key_version <= 65535);
ALTER TABLE public."noor_private_journal_entries_r221" ADD CONSTRAINT "noor_private_journal_entries_r221_nonce_check" CHECK (length(nonce) >= 16 AND length(nonce) <= 40);
ALTER TABLE public."noor_private_journal_entries_r221" ADD CONSTRAINT "noor_private_journal_entries_r221_owner_user_id_check" CHECK (owner_user_id ~ '^[A-Za-z0-9_-]{3,128}$'::text);
ALTER TABLE public."noor_private_journal_entries_r221" ADD CONSTRAINT "noor_private_journal_entries_r221_pkey" PRIMARY KEY (owner_user_id, id);
ALTER TABLE public."noor_private_journal_entries_r221" ADD CONSTRAINT "noor_private_journal_entries_r221_tag_check" CHECK (length(tag) >= 16 AND length(tag) <= 40);
ALTER TABLE public."noor_sessions" ADD CONSTRAINT "noor_sessions_check" CHECK (expires_at_epoch_ms > created_at_epoch_ms);
ALTER TABLE public."noor_sessions" ADD CONSTRAINT "noor_sessions_check1" CHECK (revoked_at_epoch_ms IS NULL OR revoked_at_epoch_ms >= created_at_epoch_ms);
ALTER TABLE public."noor_sessions" ADD CONSTRAINT "noor_sessions_created_at_epoch_ms_check" CHECK (created_at_epoch_ms >= 0);
ALTER TABLE public."noor_sessions" ADD CONSTRAINT "noor_sessions_pkey" PRIMARY KEY (id);
ALTER TABLE public."noor_work_teacher_states_r264" ADD CONSTRAINT "noor_work_teacher_states_r264_pkey" PRIMARY KEY (user_id);
ALTER TABLE public."noor_work_teacher_states_r264" ADD CONSTRAINT "noor_work_teacher_states_r264_revision_check" CHECK (revision >= 0);
ALTER TABLE public."noor_work_teacher_states_r264" ADD CONSTRAINT "noor_work_teacher_states_r264_state_check" CHECK (jsonb_typeof(state) = 'object'::text);
ALTER TABLE public."task_events" ADD CONSTRAINT "task_events_event_type_check" CHECK (event_type = ANY (ARRAY['created'::text, 'updated'::text, 'completed'::text, 'reopened'::text, 'cancelled'::text, 'deleted'::text]));
ALTER TABLE public."task_events" ADD CONSTRAINT "task_events_payload_check" CHECK (jsonb_typeof(payload) = 'object'::text);
ALTER TABLE public."task_events" ADD CONSTRAINT "task_events_pkey" PRIMARY KEY (id);
ALTER TABLE public."tasks" ADD CONSTRAINT "tasks_check" CHECK (status = 'completed'::text AND completed_at IS NOT NULL OR status <> 'completed'::text);
ALTER TABLE public."tasks" ADD CONSTRAINT "tasks_id_user_id_key" UNIQUE (id, user_id);
ALTER TABLE public."tasks" ADD CONSTRAINT "tasks_pkey" PRIMARY KEY (id);
ALTER TABLE public."tasks" ADD CONSTRAINT "tasks_priority_check" CHECK (priority >= 0 AND priority <= 3);
ALTER TABLE public."tasks" ADD CONSTRAINT "tasks_status_check" CHECK (status = ANY (ARRAY['pending'::text, 'completed'::text, 'cancelled'::text]));
ALTER TABLE public."tasks" ADD CONSTRAINT "tasks_title_check" CHECK (char_length(btrim(title)) >= 1 AND char_length(btrim(title)) <= 240);
ALTER TABLE public."habit_entries" ADD CONSTRAINT "habit_entries_habit_id_user_id_fkey" FOREIGN KEY (habit_id, user_id) REFERENCES habits(id, user_id) ON DELETE CASCADE;
ALTER TABLE public."habit_entries" ADD CONSTRAINT "habit_entries_user_id_fkey" FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE public."habits" ADD CONSTRAINT "habits_user_id_fkey" FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE public."noor_admin_accounts_r271" ADD CONSTRAINT "noor_admin_accounts_r271_auth_user_id_fkey" FOREIGN KEY (auth_user_id) REFERENCES auth.users(id) ON DELETE RESTRICT;
ALTER TABLE public."noor_admin_audit_r271" ADD CONSTRAINT "noor_admin_audit_r271_actor_auth_user_id_fkey" FOREIGN KEY (actor_auth_user_id) REFERENCES auth.users(id) ON DELETE RESTRICT;
ALTER TABLE public."noor_admin_audit_r271" ADD CONSTRAINT "noor_admin_audit_r271_target_auth_user_id_fkey" FOREIGN KEY (target_auth_user_id) REFERENCES auth.users(id) ON DELETE RESTRICT;
ALTER TABLE public."noor_authentication_account_linkages" ADD CONSTRAINT "noor_authentication_account_linkages_user_id_fkey" FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE public."noor_work_teacher_states_r264" ADD CONSTRAINT "noor_work_teacher_states_r264_user_id_fkey" FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE public."task_events" ADD CONSTRAINT "task_events_task_id_user_id_fkey" FOREIGN KEY (task_id, user_id) REFERENCES tasks(id, user_id) ON DELETE CASCADE;
ALTER TABLE public."task_events" ADD CONSTRAINT "task_events_user_id_fkey" FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE public."tasks" ADD CONSTRAINT "tasks_user_id_fkey" FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
CREATE INDEX habit_entries_user_date_idx ON public.habit_entries USING btree (user_id, entry_date DESC);
CREATE INDEX habit_entries_habit_date_idx ON public.habit_entries USING btree (habit_id, entry_date DESC);
ALTER TABLE public."habit_entries" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public."habit_entries" FROM PUBLIC,anon,authenticated,service_role;
GRANT DELETE ON public."habit_entries" TO "authenticated";
GRANT INSERT ON public."habit_entries" TO "authenticated";
GRANT SELECT ON public."habit_entries" TO "authenticated";
GRANT UPDATE ON public."habit_entries" TO "authenticated";
GRANT DELETE ON public."habit_entries" TO "service_role";
GRANT INSERT ON public."habit_entries" TO "service_role";
GRANT SELECT ON public."habit_entries" TO "service_role";
GRANT UPDATE ON public."habit_entries" TO "service_role";
CREATE INDEX habits_user_active_idx ON public.habits USING btree (user_id, active);
ALTER TABLE public."habits" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public."habits" FROM PUBLIC,anon,authenticated,service_role;
GRANT DELETE ON public."habits" TO "authenticated";
GRANT INSERT ON public."habits" TO "authenticated";
GRANT SELECT ON public."habits" TO "authenticated";
GRANT UPDATE ON public."habits" TO "authenticated";
GRANT DELETE ON public."habits" TO "service_role";
GRANT INSERT ON public."habits" TO "service_role";
GRANT SELECT ON public."habits" TO "service_role";
GRANT UPDATE ON public."habits" TO "service_role";
CREATE INDEX noor_admin_accounts_r271_account_idx ON public.noor_admin_accounts_r271 USING btree (account_id) WHERE enabled;
ALTER TABLE public."noor_admin_accounts_r271" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public."noor_admin_accounts_r271" FROM PUBLIC,anon,authenticated,service_role;
GRANT REFERENCES ON public."noor_admin_accounts_r271" TO "service_role";
GRANT SELECT ON public."noor_admin_accounts_r271" TO "service_role";
GRANT TRIGGER ON public."noor_admin_accounts_r271" TO "service_role";
GRANT TRUNCATE ON public."noor_admin_accounts_r271" TO "service_role";
CREATE INDEX noor_admin_audit_r271_occurred_idx ON public.noor_admin_audit_r271 USING btree (occurred_at DESC);
CREATE INDEX noor_admin_audit_r271_actor_idx ON public.noor_admin_audit_r271 USING btree (actor_auth_user_id, occurred_at DESC);
ALTER TABLE public."noor_admin_audit_r271" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public."noor_admin_audit_r271" FROM PUBLIC,anon,authenticated,service_role;
GRANT INSERT ON public."noor_admin_audit_r271" TO "service_role";
GRANT REFERENCES ON public."noor_admin_audit_r271" TO "service_role";
GRANT SELECT ON public."noor_admin_audit_r271" TO "service_role";
GRANT TRIGGER ON public."noor_admin_audit_r271" TO "service_role";
GRANT TRUNCATE ON public."noor_admin_audit_r271" TO "service_role";
CREATE INDEX noor_authentication_account_linkages_account_id_idx ON public.noor_authentication_account_linkages USING btree (account_id);
ALTER TABLE public."noor_authentication_account_linkages" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public."noor_authentication_account_linkages" FROM PUBLIC,anon,authenticated,service_role;
GRANT DELETE ON public."noor_authentication_account_linkages" TO "service_role";
GRANT INSERT ON public."noor_authentication_account_linkages" TO "service_role";
GRANT SELECT ON public."noor_authentication_account_linkages" TO "service_role";
ALTER TABLE public."noor_entitlement_grants" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public."noor_entitlement_grants" FROM PUBLIC,anon,authenticated,service_role;
GRANT INSERT ON public."noor_entitlement_grants" TO "service_role";
GRANT SELECT ON public."noor_entitlement_grants" TO "service_role";
GRANT UPDATE ON public."noor_entitlement_grants" TO "service_role";
ALTER TABLE public."noor_personal_foundations" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public."noor_personal_foundations" FROM PUBLIC,anon,authenticated,service_role;
GRANT INSERT ON public."noor_personal_foundations" TO "service_role";
GRANT SELECT ON public."noor_personal_foundations" TO "service_role";
GRANT UPDATE ON public."noor_personal_foundations" TO "service_role";
CREATE INDEX noor_r221_owner_created_idx ON public.noor_private_journal_entries_r221 USING btree (owner_user_id, created_at, id);
ALTER TABLE public."noor_private_journal_entries_r221" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."noor_private_journal_entries_r221" FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public."noor_private_journal_entries_r221" FROM PUBLIC,anon,authenticated,service_role;
GRANT DELETE ON public."noor_private_journal_entries_r221" TO "service_role";
GRANT INSERT ON public."noor_private_journal_entries_r221" TO "service_role";
GRANT SELECT ON public."noor_private_journal_entries_r221" TO "service_role";
ALTER TABLE public."noor_sessions" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public."noor_sessions" FROM PUBLIC,anon,authenticated,service_role;
GRANT INSERT ON public."noor_sessions" TO "service_role";
GRANT SELECT ON public."noor_sessions" TO "service_role";
GRANT UPDATE ON public."noor_sessions" TO "service_role";
ALTER TABLE public."noor_work_teacher_states_r264" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public."noor_work_teacher_states_r264" FROM PUBLIC,anon,authenticated,service_role;
GRANT INSERT ON public."noor_work_teacher_states_r264" TO "service_role";
GRANT REFERENCES ON public."noor_work_teacher_states_r264" TO "service_role";
GRANT SELECT ON public."noor_work_teacher_states_r264" TO "service_role";
GRANT TRIGGER ON public."noor_work_teacher_states_r264" TO "service_role";
GRANT TRUNCATE ON public."noor_work_teacher_states_r264" TO "service_role";
GRANT UPDATE ON public."noor_work_teacher_states_r264" TO "service_role";
CREATE INDEX task_events_user_occurred_idx ON public.task_events USING btree (user_id, occurred_at DESC);
CREATE INDEX task_events_task_occurred_idx ON public.task_events USING btree (task_id, occurred_at DESC);
CREATE INDEX task_events_task_user_idx ON public.task_events USING btree (task_id, user_id);
ALTER TABLE public."task_events" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public."task_events" FROM PUBLIC,anon,authenticated,service_role;
GRANT DELETE ON public."task_events" TO "authenticated";
GRANT INSERT ON public."task_events" TO "authenticated";
GRANT SELECT ON public."task_events" TO "authenticated";
GRANT UPDATE ON public."task_events" TO "authenticated";
GRANT DELETE ON public."task_events" TO "service_role";
GRANT INSERT ON public."task_events" TO "service_role";
GRANT SELECT ON public."task_events" TO "service_role";
GRANT UPDATE ON public."task_events" TO "service_role";
CREATE INDEX tasks_user_status_due_idx ON public.tasks USING btree (user_id, status, due_at);
ALTER TABLE public."tasks" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public."tasks" FROM PUBLIC,anon,authenticated,service_role;
GRANT DELETE ON public."tasks" TO "authenticated";
GRANT INSERT ON public."tasks" TO "authenticated";
GRANT SELECT ON public."tasks" TO "authenticated";
GRANT UPDATE ON public."tasks" TO "authenticated";
GRANT DELETE ON public."tasks" TO "service_role";
GRANT INSERT ON public."tasks" TO "service_role";
GRANT SELECT ON public."tasks" TO "service_role";
GRANT UPDATE ON public."tasks" TO "service_role";
CREATE POLICY "habit_entries_delete_own" ON public."habit_entries" AS PERMISSIVE FOR DELETE TO "authenticated" USING (((( SELECT auth.uid() AS uid) IS NOT NULL) AND (( SELECT auth.uid() AS uid) = user_id)));
CREATE POLICY "habit_entries_insert_own" ON public."habit_entries" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK (((( SELECT auth.uid() AS uid) IS NOT NULL) AND (( SELECT auth.uid() AS uid) = user_id)));
CREATE POLICY "habit_entries_select_own" ON public."habit_entries" AS PERMISSIVE FOR SELECT TO "authenticated" USING (((( SELECT auth.uid() AS uid) IS NOT NULL) AND (( SELECT auth.uid() AS uid) = user_id)));
CREATE POLICY "habit_entries_update_own" ON public."habit_entries" AS PERMISSIVE FOR UPDATE TO "authenticated" USING (((( SELECT auth.uid() AS uid) IS NOT NULL) AND (( SELECT auth.uid() AS uid) = user_id))) WITH CHECK (((( SELECT auth.uid() AS uid) IS NOT NULL) AND (( SELECT auth.uid() AS uid) = user_id)));
CREATE POLICY "habits_delete_own" ON public."habits" AS PERMISSIVE FOR DELETE TO "authenticated" USING (((( SELECT auth.uid() AS uid) IS NOT NULL) AND (( SELECT auth.uid() AS uid) = user_id)));
CREATE POLICY "habits_insert_own" ON public."habits" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK (((( SELECT auth.uid() AS uid) IS NOT NULL) AND (( SELECT auth.uid() AS uid) = user_id)));
CREATE POLICY "habits_select_own" ON public."habits" AS PERMISSIVE FOR SELECT TO "authenticated" USING (((( SELECT auth.uid() AS uid) IS NOT NULL) AND (( SELECT auth.uid() AS uid) = user_id)));
CREATE POLICY "habits_update_own" ON public."habits" AS PERMISSIVE FOR UPDATE TO "authenticated" USING (((( SELECT auth.uid() AS uid) IS NOT NULL) AND (( SELECT auth.uid() AS uid) = user_id))) WITH CHECK (((( SELECT auth.uid() AS uid) IS NOT NULL) AND (( SELECT auth.uid() AS uid) = user_id)));
CREATE POLICY "task_events_delete_own" ON public."task_events" AS PERMISSIVE FOR DELETE TO "authenticated" USING (((( SELECT auth.uid() AS uid) IS NOT NULL) AND (( SELECT auth.uid() AS uid) = user_id)));
CREATE POLICY "task_events_insert_own" ON public."task_events" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK (((( SELECT auth.uid() AS uid) IS NOT NULL) AND (( SELECT auth.uid() AS uid) = user_id)));
CREATE POLICY "task_events_select_own" ON public."task_events" AS PERMISSIVE FOR SELECT TO "authenticated" USING (((( SELECT auth.uid() AS uid) IS NOT NULL) AND (( SELECT auth.uid() AS uid) = user_id)));
CREATE POLICY "task_events_update_own" ON public."task_events" AS PERMISSIVE FOR UPDATE TO "authenticated" USING (((( SELECT auth.uid() AS uid) IS NOT NULL) AND (( SELECT auth.uid() AS uid) = user_id))) WITH CHECK (((( SELECT auth.uid() AS uid) IS NOT NULL) AND (( SELECT auth.uid() AS uid) = user_id)));
CREATE POLICY "tasks_delete_own" ON public."tasks" AS PERMISSIVE FOR DELETE TO "authenticated" USING (((( SELECT auth.uid() AS uid) IS NOT NULL) AND (( SELECT auth.uid() AS uid) = user_id)));
CREATE POLICY "tasks_insert_own" ON public."tasks" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK (((( SELECT auth.uid() AS uid) IS NOT NULL) AND (( SELECT auth.uid() AS uid) = user_id)));
CREATE POLICY "tasks_select_own" ON public."tasks" AS PERMISSIVE FOR SELECT TO "authenticated" USING (((( SELECT auth.uid() AS uid) IS NOT NULL) AND (( SELECT auth.uid() AS uid) = user_id)));
CREATE POLICY "tasks_update_own" ON public."tasks" AS PERMISSIVE FOR UPDATE TO "authenticated" USING (((( SELECT auth.uid() AS uid) IS NOT NULL) AND (( SELECT auth.uid() AS uid) = user_id))) WITH CHECK (((( SELECT auth.uid() AS uid) IS NOT NULL) AND (( SELECT auth.uid() AS uid) = user_id)));
NOTIFY pgrst, 'reload schema';
COMMIT;
