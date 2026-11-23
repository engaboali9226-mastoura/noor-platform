import assert from "node:assert/strict";
import test from "node:test";

import {
  createNoorR386G1SqlCommitAdapter,
  type G1PostgresClient,
  type G1ReceiptCommitInput,
} from "../src/noor-r386-g1-sql-commit-adapter.js";

const owner = "synthetic-r386-s3-g1-a";
const fixture: G1ReceiptCommitInput = {
  trustedNoorSessionId: "g1-session-from-server-cookie",
  serverResolvedOwnerId: owner,
  requestId: "g1-commit-request-a",
  expectedExists: false,
  expectedRevision: 0,
  before: { outbox: [] },
  after: { outbox: [] },
  keyId: "k1",
  digest: "a".repeat(64),
  fingerprints: { k1: "a".repeat(64) },
  deleteRefs: [],
};

type Case = "success" | "superuser" | "bypassRls"
  | "revoked" | "mismatch" | "databaseFailure" | "commitFailure";

function rig(mode: Case = "success") {
  const calls: Array<{ sql: string; params?: unknown[] }> = [];
  let releases = 0;
  const client: G1PostgresClient = {
    async query<Row extends Record<string, unknown>>(sql: string, params?: unknown[]) {
      calls.push({ sql, ...(params ? { params } : {}) });
      if (sql.includes("FROM pg_catalog.pg_roles")) {
        return { rows: [{
          role_name: "noor_r386_g1_writer",
          is_superuser: mode === "superuser",
          bypass_rls: mode === "bypassRls",
        }] as Row[] };
      }
      if (sql.startsWith("SELECT noor_r386_candidate.g1_assert")) {
        if (mode === "revoked") throw Error("R386_G1_NOOR_SESSION_DENIED");
        return { rows: [{ owner_id: mode === "mismatch" ? "other-owner" : owner }] as Row[] };
      }
      if (sql.startsWith("SELECT noor_r386_candidate.s3_lookup")) {
        return { rows: [{ receipt: {
          keyId: "k1", digest: "a".repeat(64), revision: 0,
        } }] as Row[] };
      }
      if (sql.startsWith("SELECT noor_r386_candidate.s3_commit")) {
        if (mode === "databaseFailure") throw Error("sensitive SQL contents");
        return { rows: [{ outcome: { kind: "committed", receipt: { revision: 0 } } }] as Row[] };
      }
      if (sql === "COMMIT" && mode === "commitFailure") {
        throw Error("connection lost after an ambiguous SQL commit");
      }
      return { rows: [] as Row[] };
    },
    release() { releases++; },
  };
  const adapter = createNoorR386G1SqlCommitAdapter({
    expectedSqlRole: "noor_r386_g1_writer",
    pool: { async connect() { return client; } },
  });
  return { adapter, calls, releases: () => releases };
}

test("G1 single PostgreSQL transaction binds actual NOOR owner check to S3 receipt commit", async () => {
  const f = rig();
  const result = await f.adapter.commit(fixture);
  assert.deepEqual(result, { kind: "committed", receipt: { revision: 0 } });
  const queries = f.calls.map(x => x.sql);
  assert.deepEqual(queries.map(x =>
    x.includes("FROM pg_catalog.pg_roles") ? "role"
    : x.includes("g1_assert_committable_noor_owner") ? "sessionFence"
    : x.includes("s3_commit") ? "s3Commit" : x),
    ["role", "BEGIN", "sessionFence", "s3Commit", "COMMIT"]);
  assert.deepEqual(f.calls[2]?.params,
    [fixture.trustedNoorSessionId, fixture.serverResolvedOwnerId]);
  assert.equal(f.calls[3]?.params?.[0], owner);
  assert.equal(f.releases(), 1);
});

test("G1 denies superuser and BYPASSRLS database connections before data access", async () => {
  for (const mode of ["superuser", "bypassRls"] as const) {
    const f = rig(mode);
    await assert.rejects(f.adapter.commit(fixture), /R386_G1_COMMIT_UNAVAILABLE/);
    assert.equal(f.calls.filter(x => x.sql.includes("s3_commit")).length, 0);
    assert.equal(f.calls.some(x => x.sql === "BEGIN"), false);
    assert.equal(f.releases(), 1);
  }
  assert.throws(() => createNoorR386G1SqlCommitAdapter({
    expectedSqlRole: "service_role", pool: { connect: async () => { throw Error(); } },
  }), /R386_G1_UNAPPROVED_SQL_ROLE/);
});

test("G1 denies revoked or mismatched session before any S3 write; rolls back", async () => {
  for (const mode of ["revoked", "mismatch"] as const) {
    const f = rig(mode);
    await assert.rejects(f.adapter.commit(fixture), /R386_G1_COMMIT_UNAVAILABLE/);
    assert.equal(f.calls.some(x => x.sql.includes("s3_commit")), false);
    assert.equal(f.calls.filter(x => x.sql === "ROLLBACK").length, 1);
    assert.equal(f.releases(), 1);
  }
});

test("G1 unknown SQL outcome is not acknowledged; transaction remains fail-closed", async () => {
  for (const mode of ["databaseFailure", "commitFailure"] as const) {
    const f = rig(mode);
    await assert.rejects(f.adapter.commit(fixture), e => {
      assert.equal((e as Error).message, "R386_G1_COMMIT_UNAVAILABLE");
      return true;
    });
    assert.equal(f.calls.filter(x => x.sql === "ROLLBACK").length, 1);
    assert.equal(f.releases(), 1);
  }
});

test("G1 refuses missing trusted session or forged owner before database connection", async () => {
  const f = rig();
  for (const delta of [
    { trustedNoorSessionId: "" },
    { serverResolvedOwnerId: "" },
    { expectedRevision: -1 },
    { digest: "not-a-hash" },
  ]) {
    await assert.rejects(
      f.adapter.commit({ ...fixture, ...delta }),
      /R386_G1_INVALID_COMMIT_INPUT/,
    );
  }
  assert.equal(f.calls.length, 0);
  assert.equal(f.releases(), 0);
});

test("G1 receipt replay lookup requires the same fresh NOOR SQL owner guard", async () => {
  const f = rig();
  const prior = await f.adapter.lookup({
    trustedNoorSessionId: fixture.trustedNoorSessionId,
    serverResolvedOwnerId: owner,
    requestId: fixture.requestId,
  });
  assert.deepEqual(prior, { keyId: "k1", digest: "a".repeat(64), revision: 0 });
  const queries = f.calls.map(v => v.sql);
  assert.equal(queries.some(s => s.includes("g1_assert_committable_noor_owner")), true);
  assert.equal(queries.some(s => s.includes("s3_lookup")), true);
  assert.equal(queries.some(s => s.includes("s3_commit")), false);
  assert.equal(queries.at(-1), "COMMIT");
  assert.equal(f.releases(), 1);

  const revoked = rig("revoked");
  await assert.rejects(revoked.adapter.lookup({
    trustedNoorSessionId: fixture.trustedNoorSessionId,
    serverResolvedOwnerId: owner,
    requestId: fixture.requestId,
  }), /R386_G1_COMMIT_UNAVAILABLE/);
  assert.equal(revoked.calls.some(v => v.sql.includes("s3_lookup")), false);
  assert.equal(revoked.calls.at(-1)?.sql, "ROLLBACK");
  assert.equal(revoked.releases(), 1);
});
