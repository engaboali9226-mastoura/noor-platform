/**
 * NOOR R386 G1 -- PRIVILEGED permanent account erasure, OFFLINE ONLY.
 *
 * No HTTP route or production composition references this module.
 * Erasure spans database and Auth/Storage API calls, so it CANNOT be one
 * atomic DB transaction. The durable NOOR owner tombstone and revoked
 * sessions/grants MUST be committed BEFORE any delete. Failure keeps the
 * fence permanently active for a safe idempotent retry.
 *
 * A verified administrator + recent MFA must be enforced in authorizeAndFence
 * by the trusted server. Browser input never supplies an owner/account ID.
 * Soft administrative disable (R316) remains a separate retention operation.
 */
export const R386_G1_ERASURE_STORES = Object.freeze([
  "storage-objects",
  "admin-audit",
  "task-events",
  "tasks",
  "habit-entries",
  "habits",
  "work-teacher-state",
  "personal-foundation",
  "private-journal",
  "candidate-analytics",
  "candidate-delivery",
  "candidate-events",
  "candidate-checkpoint",
  "candidate-receipts",
  "candidate-enrollment",
  "candidate-owner",
  "noor-entitlement-grants",
  "noor-sessions",
  "noor-account-linkages",
] as const);

export type R386G1ErasureStore = typeof R386_G1_ERASURE_STORES[number];

export interface R386G1ErasureIntent {
  readonly operatorSessionId: string;
  readonly targetAuthUserId: string;
  readonly requestId: string;
  readonly confirmation: "ERASE_NOOR_PERMANENTLY";
}

export interface R386G1FencedOwner {
  /** Trusted database-derived, never from the request body. */
  readonly ownerId: string;
  readonly accountId: string;
  readonly authUserId: string;
  readonly erasureId: string;
  /** Proves this transaction durably revoked NOOR sessions/grants and fenced writes. */
  readonly persistentTombstone: true;
  readonly sessionsAndGrantsRevoked: true;
}

export interface R386G1ErasureBackend {
  /** Authenticated, MFA-verified, atomic durable fence. Safe to retry after failure. */
  authorizeAndFence(intent: R386G1ErasureIntent): Promise<R386G1FencedOwner>;
  /**
   * Idempotent purge, scoped by fence.ownerId / fence.accountId / authUserId.
   * Never use browser-supplied owner keys or a row filter that can cross owners.
   */
  eraseStore(fence: R386G1FencedOwner, store: R386G1ErasureStore): Promise<void>;
  /** Independent authoritative per-store count, not a cached delete result. */
  remainingRows(fence: R386G1FencedOwner, store: R386G1ErasureStore): Promise<number>;
  /** Managed Auth HARD delete (not Supabase deleteUser(..., true)). */
  hardDeleteManagedAuth(fence: R386G1FencedOwner): Promise<void>;
  /** Independent verification includes auth identities, refresh/session rows. */
  managedAuthResiduals(fence: R386G1FencedOwner): Promise<number>;
  /**
   * Last transaction: recheck owner tombstone + all-source absence, then record
   * minimum non-identifying proof. Tombstone must never be deleted/reissued.
   */
  verifyAndFinalize(fence: R386G1FencedOwner): Promise<boolean>;
}

function uuid(value: unknown): value is string {
  return typeof value === "string"
    && /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/iu.test(value);
}

function validIntent(value: R386G1ErasureIntent): boolean {
  return value !== null && typeof value === "object"
    && typeof value.operatorSessionId === "string"
    && value.operatorSessionId.length >= 16
    && value.operatorSessionId.length <= 256
    && uuid(value.targetAuthUserId)
    && uuid(value.requestId)
    && value.confirmation === "ERASE_NOOR_PERMANENTLY";
}

function validFence(value: unknown, intendedUserId: string): value is R386G1FencedOwner {
  if (value === null || typeof value !== "object") return false;
  const v = value as Partial<R386G1FencedOwner>;
  return uuid(v.ownerId) && uuid(v.authUserId)
    && v.authUserId.toLowerCase() === intendedUserId.toLowerCase()
    && typeof v.accountId === "string"
    && v.accountId.trim().length >= 1 && v.accountId.length <= 256
    && uuid(v.erasureId)
    && v.persistentTombstone === true
    && v.sessionsAndGrantsRevoked === true;
}

function zero(value: number): boolean {
  return Number.isSafeInteger(value) && value === 0;
}

export function createR386G1PermanentErasureCoordinator(backend: R386G1ErasureBackend):
  Readonly<{ erase(intent: R386G1ErasureIntent): Promise<Readonly<{ status: "erased" }>> }> {
  if (!backend
    || typeof backend.authorizeAndFence !== "function"
    || typeof backend.eraseStore !== "function"
    || typeof backend.remainingRows !== "function"
    || typeof backend.hardDeleteManagedAuth !== "function"
    || typeof backend.managedAuthResiduals !== "function"
    || typeof backend.verifyAndFinalize !== "function") {
    throw new Error("R386_G1_ERASURE_BACKEND_UNAVAILABLE");
  }

  return Object.freeze({
    async erase(intent: R386G1ErasureIntent): Promise<Readonly<{ status: "erased" }>> {
      if (!validIntent(intent)) throw new Error("R386_G1_ERASURE_INTENT_DENIED");
      // Do not let an exception disclose user ID, request body, or journal text.
      let fence: R386G1FencedOwner;
      try {
        const resolved = await backend.authorizeAndFence(intent);
        if (!validFence(resolved, intent.targetAuthUserId)) {
          throw new Error("INVALID_DURABLE_FENCE");
        }
        fence = resolved;
      } catch {
        throw new Error("R386_G1_ERASURE_AUTHORITY_UNAVAILABLE");
      }

      try {
        // No rollback after the fence: a partial deletion must remain blocked
        // until completed. Every step is idempotent and independently verified.
        for (const store of R386_G1_ERASURE_STORES) {
          await backend.eraseStore(fence, store);
          if (!zero(await backend.remainingRows(fence, store))) {
            throw new Error("RESIDUAL_STORE");
          }
        }
        // Managed Auth deletion MUST be hard, after all other stores are empty.
        await backend.hardDeleteManagedAuth(fence);
        if (!zero(await backend.managedAuthResiduals(fence))) {
          throw new Error("MANAGED_AUTH_RESIDUALS");
        }
        // The backend must reconfirm the complete inventory atomically here.
        if (await backend.verifyAndFinalize(fence) !== true) {
          throw new Error("FINAL_ERASURE_NOT_CONFIRMED");
        }
        return { status: "erased" };
      } catch {
        // Never clear the tombstone or re-enable login on any failure.
        throw new Error("R386_G1_ERASURE_INCOMPLETE_RETRY_REQUIRED");
      }
    },
  });
}
