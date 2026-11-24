import assert from "node:assert/strict";
import test from "node:test";
import {
  createNoorR386G1SqlCommitAdapter,
  type G1PostgresClient,
} from "../src/noor-r386-g1-sql-commit-adapter.js";

type Fault = "none" | "role" | "begin" | "work" | "rollback" | "commit";

function rig(fault: Fault) {
  const calls: string[] = [];
  const releases: boolean[] = [];
  const client: G1PostgresClient = {
    async query<Row extends Record<string, unknown>>(sql: string) {
      const step = sql.includes("pg_catalog.pg_roles") ? "role"
        : sql.includes("g1_authorized_operational_read") ? "work" : sql;
      calls.push(step);
      if (step === "role") {
        if (fault === "role") throw new Error("role check unavailable");
        return { rows: [{ role_name: "noor_r386_g1_writer", is_superuser: false, bypass_rls: false }] as unknown as Row[] };
      }
      if (step === "BEGIN" && fault === "begin") throw new Error("BEGIN outcome unknown");
      if (step === "work") {
        if (fault === "work" || fault === "rollback") throw new Error("work failed");
        return { rows: [{ loaded: { existed: true, revision: 1, state: {} } }] as unknown as Row[] };
      }
      if (step === "ROLLBACK" && fault === "rollback") throw new Error("ROLLBACK failed");
      if (step === "COMMIT" && fault === "commit") throw new Error("COMMIT outcome unknown");
      return { rows: [] as Row[] };
    },
    release(destroy = false) { releases.push(destroy); },
  };
  const adapter = createNoorR386G1SqlCommitAdapter({
    expectedSqlRole: "noor_r386_g1_writer",
    pool: { async connect() { return client; } },
  });
  return { calls, releases, run: () => adapter.loadOperational({
    trustedNoorSessionId: "isolated-test-session", serverResolvedOwnerId: "isolated-test-owner",
  }) };
}

for (const [fault, calls, destroy] of [
  ["none", ["role", "BEGIN", "work", "COMMIT"], false],
  ["role", ["role"], true],
  ["begin", ["role", "BEGIN"], true],
  ["work", ["role", "BEGIN", "work", "ROLLBACK"], false],
  ["rollback", ["role", "BEGIN", "work", "ROLLBACK"], true],
  ["commit", ["role", "BEGIN", "work", "COMMIT", "ROLLBACK"], true],
] as const) {
  test(`G1 connection cleanup: ${fault}`, async () => {
    const f = rig(fault);
    if (fault === "none") await f.run();
    else await assert.rejects(f.run(), /R386_G1_COMMIT_UNAVAILABLE/);
    assert.deepEqual(f.calls, calls);
    assert.deepEqual(f.releases, [destroy]);
  });
}
