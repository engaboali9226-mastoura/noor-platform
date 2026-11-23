/**
 * R386 G1: actual NOOR session -> entitlement -> owner chain, in-memory
 * database transport only. Uses the deployed application/infra classes.
 * No GoTrue substitute, no external API, no real accounts, no writes.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { ResolveSession, Authorize } from "@worktracker/application";
import {
  SupabasePostgresSessionRepository,
  SupabasePostgresEntitlementRepository,
  SupabasePostgresAuthenticationAccountUserResolver,
} from "@worktracker/infrastructure";
import { PersonalControlOperation } from "../src/personal-control-operation.js";

const at = Date.parse("2026-11-24T00:00:00Z");
const ownerA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ownerB = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const accountA = "r386-actual-account-a";
const accountB = "r386-actual-account-b";
const sessionA1 = "r386-actual-session-a-1";
const sessionA2 = "r386-actual-session-a-2";
const sessionB = "r386-actual-session-b-1";
const requestId = "client-7d2b802a-6f0d-4862-925b-3b66cbe9e67e";

type Table = "noor_sessions" | "noor_entitlement_grants" | "noor_authentication_account_linkages";
type RecordRow = Record<string, unknown>;

function setup() {
  const tables: Record<Table, RecordRow[]> = {
    noor_sessions: [
      { id: sessionA1, account_id: accountA, created_at_epoch_ms: at - 300_000,
        expires_at_epoch_ms: at + 3_600_000, revoked_at_epoch_ms: null },
      { id: sessionA2, account_id: accountA, created_at_epoch_ms: at - 300_000,
        expires_at_epoch_ms: at + 3_600_000, revoked_at_epoch_ms: null },
      { id: sessionB, account_id: accountB, created_at_epoch_ms: at - 300_000,
        expires_at_epoch_ms: at + 3_600_000, revoked_at_epoch_ms: null },
    ],
    noor_entitlement_grants: [
      { id: "r386-grant-account-a-0001", account_id: accountA, action: "access",
        resource_type: "application", resource_id: "noor-personal",
        granted_at_epoch_ms: at - 300_000, revoked_at_epoch_ms: null },
      { id: "r386-grant-account-b-0001", account_id: accountB, action: "access",
        resource_type: "application", resource_id: "noor-personal",
        granted_at_epoch_ms: at - 300_000, revoked_at_epoch_ms: null },
    ],
    noor_authentication_account_linkages: [
      { account_id: accountA, user_id: ownerA },
      { account_id: accountB, user_id: ownerB },
    ],
  };
  const activity: string[] = [];
  const successful: Array<{ session: string; owner: string }> = [];
  let unavailable: Table | null = null;
  let running = true;

  function from(table: Table) {
    const where = new Map<string, unknown>();
    const read = (): { data: RecordRow[] | null; error: unknown | null } => {
      activity.push("read:" + table);
      if (unavailable === table) return { data: null, error: { message: "synthetic-provider-unavailable" } };
      const rows = tables[table].filter(row =>
        [...where].every(([key, value]) => row[key] === value));
      return { data: rows, error: null };
    };
    const query = {
      select(_columns: string) { return query; },
      eq(column: string, value: unknown) { where.set(column, value); return query; },
      async maybeSingle() {
        const answer = read();
        return { data: answer.data?.[0] ?? null, error: answer.error };
      },
      then<Y>(
        onResolved: (result: ReturnType<typeof read>) => Y | PromiseLike<Y>,
        onRejected?: (error: unknown) => Y | PromiseLike<Y>,
      ): Promise<Y> {
        return Promise.resolve(read()).then(onResolved, onRejected);
      },
    };
    return query;
  }
  const database = { from };
  const runtimeClock = { now: () => ({ toDate: () => new Date(at) }) };
  const resolver = new ResolveSession(
    new SupabasePostgresSessionRepository(database as never),
    runtimeClock as never,
  );
  const authorizer = new Authorize(
    new SupabasePostgresEntitlementRepository(database as never),
  );
  const accountUserResolver = new SupabasePostgresAuthenticationAccountUserResolver(database as never);

  const control = new PersonalControlOperation({
    isRuntimeRunning: () => running,
    resolveSession: resolver,
    authorize: authorizer,
    accountUserResolver,
    foundation: { async openOperation() { activity.push("foundation:opened"); throw Error("no foundation access"); } } as never,
    clock: { now: () => new Date(at).toISOString() },
    idGenerator: { next: () => "synthetic-id" } as never,
    atomicSaveCandidate: {
      async run(input) {
        successful.push({ session: input.trustedNoorSessionId, owner: input.ownerId });
        return { status: 204 as const };
      },
      async initialize(input) {
        successful.push({ session: input.trustedNoorSessionId, owner: input.ownerId });
        return { status: 204 as const };
      },
      async reconcile(): Promise<never> { throw Error("scheduler has no authenticated session"); },
    },
  });
  const command = { type: "initialize-personal-profile-r321", city: "riyadh", calculationMethod: "UmmAlQura" };
  const call = async (sessionId: string | null, cmd: unknown = command) =>
    control.executeCommand({ sessionId, requestId, command: cmd });

  return {
    tables, activity, successful, control, call,
    outage(value: Table | null) { unavailable = value; },
    running(value: boolean) { running = value; },
  };
}

test("G1 real NOOR classes resolve both devices to the same owner and a distinct account independently", async () => {
  const f = setup();
  for (const sessionId of [sessionA1, sessionA2, sessionB]) {
    const found = await f.control.resolveAuthorizedJournalUser(sessionId);
    assert.deepEqual(found, {
      kind: "ok",
      userId: sessionId === sessionB ? ownerB : ownerA,
    });
    assert.equal((await f.call(sessionId)).status, 204);
  }
  assert.deepEqual(f.successful, [
    { session: sessionA1, owner: ownerA },
    { session: sessionA2, owner: ownerA },
    { session: sessionB, owner: ownerB },
  ]);
  assert.equal(f.activity.includes("foundation:opened"), false);
  assert.ok(f.activity.includes("read:noor_sessions"));
  assert.ok(f.activity.includes("read:noor_entitlement_grants"));
  assert.ok(f.activity.includes("read:noor_authentication_account_linkages"));
});

test("G1 expired, revoked, unknown, missing and malformed NOOR cookies never reach the candidate", async () => {
  const f = setup();
  f.tables.noor_sessions[0]!.revoked_at_epoch_ms = at - 1_000;
  f.tables.noor_sessions[1]!.expires_at_epoch_ms = at - 1;
  for (const sessionId of [sessionA1, sessionA2, "r386-unknown-session-0001", null, "x"]) {
    assert.equal((await f.call(sessionId)).status, 401);
  }
  assert.deepEqual(f.successful, []);
});

test("G1 revoked grant is 403, service downtime fails closed 503 without opening personal data", async () => {
  const f = setup();
  f.tables.noor_entitlement_grants[0]!.revoked_at_epoch_ms = at - 1;
  assert.equal((await f.call(sessionA1)).status, 403);
  f.tables.noor_entitlement_grants[0]!.revoked_at_epoch_ms = null;
  for (const table of [
    "noor_sessions", "noor_entitlement_grants", "noor_authentication_account_linkages",
  ] as const) {
    f.outage(table);
    assert.equal((await f.call(sessionA1)).status, 503, table);
  }
  f.outage(null);
  f.running(false);
  assert.equal((await f.call(sessionA1)).status, 503);
  assert.deepEqual(f.successful, []);
  assert.equal(f.activity.includes("foundation:opened"), false);
});

test("G1 unresolved and ambiguous real account linkages never select an arbitrary owner", async () => {
  const f = setup();
  f.tables.noor_authentication_account_linkages.splice(0, 1);
  assert.equal((await f.call(sessionA1)).status, 503);
  f.tables.noor_authentication_account_linkages.push(
    { account_id: accountA, user_id: ownerA },
    { account_id: accountA, user_id: ownerB },
  );
  assert.equal((await f.call(sessionA1)).status, 503);
  assert.deepEqual(f.successful, []);
});

test("G1 duplicate, missing or wrong application grants fail before personal data", async () => {
  const f = setup();
  f.tables.noor_entitlement_grants.push({
    ...f.tables.noor_entitlement_grants[0]!, id: "r386-grant-account-a-0002",
  });
  assert.equal((await f.call(sessionA1)).status, 503);
  f.tables.noor_entitlement_grants.splice(2, 1);
  f.tables.noor_entitlement_grants.splice(0, 1);
  assert.equal((await f.call(sessionA1)).status, 403);
  assert.equal((await f.call(sessionB)).status, 204);
  assert.deepEqual(f.successful, [{ session: sessionB, owner: ownerB }]);
});

test("G1 post-verification revocation and browser-injected owner cannot transfer an account", async () => {
  const f = setup();
  assert.equal((await f.call(sessionA1)).status, 204);
  f.tables.noor_sessions[0]!.revoked_at_epoch_ms = at;
  assert.equal((await f.call(sessionA1)).status, 401);
  const malicious = { ...({ type: "initialize-personal-profile-r321", city: "riyadh", calculationMethod: "UmmAlQura" }), ownerId: ownerB };
  assert.equal((await f.call(sessionA2, malicious)).status, 400);
  assert.equal((await f.call(sessionB)).status, 204);
  assert.deepEqual(f.successful, [
    { session: sessionA1, owner: ownerA },
    { session: sessionB, owner: ownerB },
  ]);
});
