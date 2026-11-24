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
      if (sql.startsWith("SELECT noor_r386_candidate.g1_authorized_operational_read")) {
        if (mode === "revoked" || mode === "mismatch")
          throw Error("R386_G1_NOOR_SESSION_DENIED");
        return { rows: [{ loaded: {
          existed: true, revision: 7, state: { definitions: [], source: "original-noor" },
        } }] as Row[] };
      }
      if (sql.startsWith("SELECT noor_r386_candidate.g1_authorized_load")) {
        if (mode === "revoked" || mode === "mismatch") throw Error("R386_G1_NOOR_SESSION_DENIED");
        if (mode === "databaseFailure") throw Error("hidden SQL data");
        return { rows: [{ loaded: { existed: true, revision: 3, state: { outbox: [], counter: 3 } } }] as Row[] };
      }
      if (sql.startsWith("SELECT noor_r386_candidate.g1_authorized_lookup")) {
        if (mode === "revoked" || mode === "mismatch") throw Error("R386_G1_NOOR_SESSION_DENIED");
        return { rows: [{ receipt: {
          keyId: "k1", digest: "a".repeat(64), revision: 0,
        } }] as Row[] };
      }
      if (sql.startsWith("SELECT noor_r386_candidate.g1_authorized_commit")) {
        if (mode === "revoked" || mode === "mismatch") throw Error("R386_G1_NOOR_SESSION_DENIED");
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
    : x.includes("g1_authorized_commit") ? "wrappedCommit" : x),
    ["role", "BEGIN", "wrappedCommit", "COMMIT"]);
  assert.deepEqual(f.calls[2]?.params?.slice(0, 2),
    [fixture.trustedNoorSessionId, fixture.serverResolvedOwnerId]);
  assert.equal(queries.some(query => query.includes("SELECT noor_r386_candidate.s3_commit")), false);
  assert.equal(queries.some(query => query.includes("SELECT noor_r386_candidate.g1_assert")), false);
  assert.equal(f.releases(), 1);
});

test("G1 denies superuser and BYPASSRLS database connections before data access", async () => {
  for (const mode of ["superuser", "bypassRls"] as const) {
    const f = rig(mode);
    await assert.rejects(f.adapter.commit(fixture), /R386_G1_COMMIT_UNAVAILABLE/);
    assert.equal(f.calls.filter(x => x.sql.includes("g1_authorized_commit")).length, 0);
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
    assert.equal(f.calls.filter(x => x.sql.includes("g1_authorized_commit")).length, 1);
    assert.equal(f.calls.some(x => x.sql.includes("SELECT noor_r386_candidate.s3_commit")), false);
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
  assert.equal(queries.filter(s => s.includes("g1_authorized_lookup")).length, 1);
  assert.equal(queries.some(s => s.includes("SELECT noor_r386_candidate.s3_lookup")), false);
  assert.equal(queries.some(s => s.includes("g1_authorized_commit")), false);
  assert.equal(queries.at(-1), "COMMIT");
  assert.equal(f.releases(), 1);

  const revoked = rig("revoked");
  await assert.rejects(revoked.adapter.lookup({
    trustedNoorSessionId: fixture.trustedNoorSessionId,
    serverResolvedOwnerId: owner,
    requestId: fixture.requestId,
  }), /R386_G1_COMMIT_UNAVAILABLE/);
  assert.equal(revoked.calls.filter(v => v.sql.includes("g1_authorized_lookup")).length, 1);
  assert.equal(revoked.calls.some(v => v.sql.includes("SELECT noor_r386_candidate.s3_lookup")), false);
  assert.equal(revoked.calls.at(-1)?.sql, "ROLLBACK");
  assert.equal(revoked.releases(), 1);
});

test("G1 source load cannot bypass live NOOR owner fence or SQL transaction",async()=>{
 const f=rig();
 const loaded=await f.adapter.load({
  trustedNoorSessionId:fixture.trustedNoorSessionId,
  serverResolvedOwnerId:owner,
 });
 assert.deepEqual(loaded,{existed:true,revision:3,state:{outbox:[],counter:3}});
 assert.deepEqual(f.calls.map(c=>c.sql.includes("FROM pg_catalog.pg_roles")?"role":c.sql.includes("g1_authorized_load")?"guardedLoad":c.sql),
  ["role","BEGIN","guardedLoad","COMMIT"]);
 assert.deepEqual(f.calls[2]?.params,[fixture.trustedNoorSessionId,owner]);
 assert.equal(f.calls.some(c=>c.sql.includes("SELECT noor_r386_candidate.s3_load")),false);
 assert.equal(f.releases(),1);
 for(const mode of ["revoked","mismatch","databaseFailure"] as const){
  const denied=rig(mode);
  await assert.rejects(denied.adapter.load({
   trustedNoorSessionId:fixture.trustedNoorSessionId,
   serverResolvedOwnerId:owner,
  }),/R386_G1_COMMIT_UNAVAILABLE/);
  assert.equal(denied.calls.at(-1)?.sql,"ROLLBACK");
  assert.equal(denied.releases(),1);
 }
});

test("G1 trusted SQL reader reads the ORIGINAL NOOR foundation, never the synthetic S3 source",async()=>{
 const f=rig();
 const result=await f.adapter.loadOperational({
   trustedNoorSessionId:fixture.trustedNoorSessionId,
   serverResolvedOwnerId:owner,
 });
 assert.deepEqual(result,{
   existed:true,revision:7,state:{definitions:[],source:"original-noor"},
 });
 assert.deepEqual(f.calls.map(x=>x.sql.includes("FROM pg_catalog.pg_roles")?"role":
    x.sql.includes("g1_authorized_operational_read")?"operationalRead":x.sql),
   ["role","BEGIN","operationalRead","COMMIT"]);
 assert.deepEqual(f.calls[2]?.params,[fixture.trustedNoorSessionId,owner]);
 assert.equal(f.calls.some(x=>x.sql.includes("g1_authorized_load(")),false);
 assert.equal(f.releases(),1);

 for (const mode of ["revoked","mismatch"] as const) {
   const denied=rig(mode);
   await assert.rejects(denied.adapter.loadOperational({
      trustedNoorSessionId:fixture.trustedNoorSessionId,
      serverResolvedOwnerId:owner,
   }),/R386_G1_COMMIT_UNAVAILABLE/);
   assert.equal(denied.calls.at(-1)?.sql,"ROLLBACK");
   assert.equal(denied.releases(),1);
 }

 const invalid=rig();
 await assert.rejects(invalid.adapter.loadOperational({
   trustedNoorSessionId:"",serverResolvedOwnerId:owner,
 }),/R386_G1_INVALID_OPERATIONAL_LOAD_INPUT/);
 assert.equal(invalid.calls.length,0);
});
