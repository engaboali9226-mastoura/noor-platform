import assert from "node:assert/strict";
import test from "node:test";
import { R386_G1_ERASURE_STORES } from "../src/noor-r386-g1-permanent-erasure-coordinator.js";

/**
 * Read-only reference inventory from the actual managed NOOR public schema.
 * 2026-11-23: twelve public tables. This is a pinned security contract,
 * not a claim that production data were deleted or a migration for deployment.
 * Before release, repeat the live read-only catalog comparison and fail if
 * an extra owner-bearing table or dependent store has appeared.
 */
const managedPublicSchema = Object.freeze({
  noor_sessions: "noor-sessions",
  tasks: "tasks",
  task_events: "task-events",
  habits: "habits",
  habit_entries: "habit-entries",
  noor_authentication_account_linkages: "noor-account-linkages",
  noor_entitlement_grants: "noor-entitlement-grants",
  noor_personal_foundations: "personal-foundation",
  noor_private_journal_entries_r221: "private-journal",
  noor_work_teacher_states_r264: "work-teacher-state",
  noor_admin_accounts_r271: "admin-accounts",
  noor_admin_audit_r271: "admin-audit",
} as const);

test("G1 irreversible erasure inventory covers all 12 actual managed NOOR public tables", () => {
  const entries = Object.entries(managedPublicSchema);
  assert.equal(entries.length, 12);
  assert.equal(new Set(entries.map(([name]) => name)).size, entries.length);
  const required = entries.map(([, store]) => store);
  assert.equal(new Set(required).size, required.length);
  for (const store of required) {
    assert.equal(R386_G1_ERASURE_STORES.includes(store), true,
      `Missing erasure store for managed schema: ${store}`);
  }
});

test("G1 hard Auth removal follows all public, candidate and storage erasure steps", () => {
  assert.equal(new Set(R386_G1_ERASURE_STORES).size, R386_G1_ERASURE_STORES.length);
  const required = [
    "storage-objects", "admin-audit", "admin-accounts",
    "candidate-receipts", "candidate-analytics",
    "noor-sessions", "noor-entitlement-grants", "noor-account-linkages",
  ];
  for (const store of required) {
    assert.equal(R386_G1_ERASURE_STORES.includes(store as never), true);
  }
  const i = (store: string) => R386_G1_ERASURE_STORES.indexOf(store as never);
  assert.equal(i("admin-audit") < i("admin-accounts"), true);
  assert.equal(i("admin-accounts") < i("noor-account-linkages"), true);
  assert.equal(i("task-events") < i("tasks"), true);
  assert.equal(i("habit-entries") < i("habits"), true);
});

test("G1 excludes false assumptions that Auth cascades administrative audit", () => {
  // Actual managed public FK delete actions:
  // noor_admin_accounts_r271_auth_user_id_fkey: ON DELETE RESTRICT
  // noor_admin_audit_r271_actor_auth_user_id_fkey: ON DELETE RESTRICT
  // noor_admin_audit_r271_target_auth_user_id_fkey: ON DELETE RESTRICT
  // Deletion backend must resolve these before hard Auth deletion, without
  // indiscriminately deleting another user's unrelated audit records.
  assert.equal(R386_G1_ERASURE_STORES.includes("admin-accounts"), true);
  assert.equal(R386_G1_ERASURE_STORES.includes("admin-audit"), true);
});
