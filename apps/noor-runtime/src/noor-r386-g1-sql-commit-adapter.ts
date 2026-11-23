/**
 * R386 G1 isolated-only PostgreSQL transaction adapter.
 *
 * NOT wired to createPrivilegedPlatformRuntimeHost. An approved private
 * PostgreSQL connection/least-privilege role is required before activation.
 * Keeps the persisted NOOR session/owner fence and S3 mutation in ONE
 * connection and transaction. A Supabase REST RPC is not an equivalent
 * transaction boundary, and service_role is explicitly rejected.
 */
export interface G1PostgresClient {
  query<Row extends Record<string, unknown>>(
    sql: string,
    parameters?: unknown[],
  ): Promise<Readonly<{ rows: Row[] }>>;
  release(): void;
}

export interface G1PostgresPool {
  connect(): Promise<G1PostgresClient>;
}

export interface G1ReceiptCommitInput {
  readonly trustedNoorSessionId: string;
  readonly serverResolvedOwnerId: string;
  readonly requestId: string;
  readonly expectedExists: boolean;
  readonly expectedRevision: number;
  readonly before: Readonly<Record<string, unknown>>;
  readonly after: Readonly<Record<string, unknown>>;
  readonly keyId: string;
  readonly digest: string;
  readonly fingerprints: Readonly<Record<string, string>>;
  readonly deleteRefs: readonly string[];
}

export type G1ReceiptCommitResult =
  | Readonly<{ kind: "committed" | "replay"; receipt: unknown }>
  | Readonly<{ kind: "conflict" }>;

function permittedInput(input: G1ReceiptCommitInput): boolean {
  return typeof input.trustedNoorSessionId === "string"
    && input.trustedNoorSessionId.length > 0
    && input.trustedNoorSessionId.length <= 256
    && typeof input.serverResolvedOwnerId === "string"
    && input.serverResolvedOwnerId.length > 0
    && input.serverResolvedOwnerId.length <= 512
    && typeof input.requestId === "string"
    && /^[A-Za-z0-9_-]{1,128}$/u.test(input.requestId)
    && typeof input.keyId === "string"
    && /^[A-Za-z0-9_-]{1,128}$/u.test(input.keyId)
    && /^[0-9a-f]{64}$/u.test(input.digest)
    && Number.isSafeInteger(input.expectedRevision)
    && input.expectedRevision >= 0
    && typeof input.expectedExists === "boolean"
    && input.before !== null && typeof input.before === "object"
    && !Array.isArray(input.before)
    && input.after !== null && typeof input.after === "object"
    && !Array.isArray(input.after)
    && input.fingerprints !== null && typeof input.fingerprints === "object"
    && !Array.isArray(input.fingerprints)
    && Array.isArray(input.deleteRefs)
    && input.deleteRefs.every(value => typeof value === "string" && value.length <= 512);
}

export function createNoorR386G1SqlCommitAdapter(
  input: Readonly<{
    pool: G1PostgresPool;
    expectedSqlRole: string;
  }>,
): Readonly<{ commit(value: G1ReceiptCommitInput): Promise<G1ReceiptCommitResult> }> {
  if (!/^noor_r386_g1_[a-z0-9_]{1,48}$/u.test(input.expectedSqlRole)) {
    throw new Error("R386_G1_UNAPPROVED_SQL_ROLE");
  }

  return Object.freeze({
    async commit(value: G1ReceiptCommitInput): Promise<G1ReceiptCommitResult> {
      if (!permittedInput(value)) throw new Error("R386_G1_INVALID_COMMIT_INPUT");
      const client = await input.pool.connect();
      let started = false;
      try {
        const identity = await client.query<{
          role_name: string;
          is_superuser: boolean;
          bypass_rls: boolean;
        }>(
          "SELECT current_user AS role_name, rolsuper AS is_superuser, rolbypassrls AS bypass_rls "
          + "FROM pg_catalog.pg_roles WHERE rolname=current_user",
        );
        const role = identity.rows[0];
        if (identity.rows.length !== 1 || !role
          || role.role_name !== input.expectedSqlRole
          || role.is_superuser !== false || role.bypass_rls !== false) {
          throw new Error("R386_G1_PRIVILEGED_SQL_ROLE_DENIED");
        }
        await client.query("BEGIN");
        started = true;
        const identityCheck = await client.query<{ owner_id: string }>(
          "SELECT noor_r386_candidate.g1_assert_committable_noor_owner($1,$2) AS owner_id",
          [value.trustedNoorSessionId, value.serverResolvedOwnerId],
        );
        if (identityCheck.rows.length !== 1
          || identityCheck.rows[0]?.owner_id !== value.serverResolvedOwnerId) {
          throw new Error("R386_G1_SESSION_OWNER_MISMATCH");
        }

        const result = await client.query<{ outcome: G1ReceiptCommitResult }>(
          "SELECT noor_r386_candidate.s3_commit("
          + "$1,$2,$3,$4,$5::jsonb,$6::jsonb,$7,$8,$9::jsonb,$10::text[]) AS outcome",
          [
            value.serverResolvedOwnerId,
            value.requestId,
            value.expectedExists,
            value.expectedRevision,
            JSON.stringify(value.before),
            JSON.stringify(value.after),
            value.keyId,
            value.digest,
            JSON.stringify(value.fingerprints),
            [...value.deleteRefs],
          ],
        );
        const outcome = result.rows[0]?.outcome;
        if (result.rows.length !== 1 || !outcome
          || !["committed", "replay", "conflict"].includes(outcome.kind)) {
          throw new Error("R386_G1_BAD_COMMIT_RESULT");
        }
        await client.query("COMMIT");
        started = false;
        return outcome;
      } catch {
        if (started) {
          try { await client.query("ROLLBACK"); } catch { /* unknown outcome: fail closed */ }
        }
        // Never expose SQL input, session identifiers, user IDs or private JSON.
        throw new Error("R386_G1_COMMIT_UNAVAILABLE");
      } finally {
        client.release();
      }
    },
  });
}
