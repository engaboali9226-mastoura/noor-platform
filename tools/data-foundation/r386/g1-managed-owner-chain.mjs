import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { setTimeout as delay } from "node:timers/promises";
import { createClient } from "@supabase/supabase-js";
import { evaluateR386InitializationCandidate } from "@noor/personal";
import { Pool } from "pg";
import { exerciseManagedErasure } from "./g1-managed-erasure-exercise.mjs";
import { safeSessionFailure, createSessionInsertTrace } from "./g1-managed-session-diagnostics.mjs";
import { createPrivilegedPlatformRuntimeHost } from "../../../apps/noor-runtime/dist/privileged-platform-runtime-host.js";
import { createNoorR386G1SqlCommitAdapter } from "../../../apps/noor-runtime/dist/noor-r386-g1-sql-commit-adapter.js";

const { API_URL, DB_URL, ANON_KEY, SERVICE_ROLE_KEY } = JSON.parse(readFileSync(process.argv[2], "utf8"));
const api = new URL(API_URL);
const db = new URL(DB_URL);
assert.equal(api.protocol, "https:");
assert.equal(api.hostname, "127.0.0.1");
assert.equal(db.protocol, "postgresql:");
assert.equal(db.hostname, "127.0.0.1");
const issuer = `${api.origin}/auth/v1`;
const options = { auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false } };
const admin = createClient(api.origin, SERVICE_ROLE_KEY, options);
const writerRole = "noor_r386_g1_writer";
const writerPassword = randomUUID();
const fixture = spawnSync("psql", ["-Xqw", "-v", "ON_ERROR_STOP=1", "-f", "tools/data-foundation/r386/g1-managed-noor-fixture.sql"], {
  env: {
    ...process.env,
    R386_G1_WRITER_PASSWORD: writerPassword,
    PGHOST: db.hostname, PGPORT: db.port, PGDATABASE: decodeURIComponent(db.pathname.slice(1)),
    PGUSER: decodeURIComponent(db.username), PGPASSWORD: decodeURIComponent(db.password), PGSSLMODE: "disable",
  },
  encoding: "utf8",
});
// Read the password from the same disposable runner's environment via psql;
// do not put it in argv or exception output.
if (fixture.status !== 0) throw new Error(fixture.stderr?.replaceAll(writerPassword, "[redacted]") ?? "G1 fixture failed");

console.log("R386_G1_HOSTED_HELPER_ACL_VERIFIED=YES");
const observer = new Pool({ connectionString: DB_URL, max: 2 });
const writerConnection = new URL(DB_URL);
writerConnection.username = writerRole;
writerConnection.password = writerPassword;
const pool = new Pool({ connectionString: writerConnection.href, max: 2 });
const adapter = createNoorR386G1SqlCommitAdapter({ pool, expectedSqlRole: writerRole });
const nativeFetch = globalThis.fetch;
const trace = createSessionInsertTrace({
  origin: api.origin, fetcher: nativeFetch.bind(globalThis),
  emit: record => console.log("R386_G1_SESSION_INSERT_TRACE " + JSON.stringify(record)),
});
globalThis.fetch = trace.fetch;
const host = createPrivilegedPlatformRuntimeHost({
  supabaseUrl: api.origin, supabaseServiceRoleKey: SERVICE_ROLE_KEY,
  expectedIssuer: issuer, expectedAudience: "authenticated", expectedAlgorithm: "ES256", sessionLifetimeMs: 3600_000,
}, { captureOriginatingAuthSessionId: true });

function response(label, { data, error }) {
  if (error) throw new Error(`${label}: ${error.code ?? error.status ?? error.name}`);
  return data;
}

const emptyState = { locations: [], prayerPolicies: [], personalDays: [], islamicContexts: [], definitions: [], dailyExecution: [], outbox: [] };

try {
  // Confirm PostgREST has observed the fixture's committed schema before establishing sessions.
  for (let attempt = 0; ; attempt++) {
    const result = await admin.from("noor_sessions").select("id,originating_auth_session_id").limit(1);
    if (!result.error) break;
    if (attempt === 20) response("PostgREST schema cache", result);
    await delay(150);
  }
  const operations = await host.start();
  const authClients = new Map();
  const sessionClaim = proof => JSON.parse(Buffer.from(proof.split(".")[1], "base64url")).session_id;
  async function makeAccount() {
    const email = `noor-${randomUUID()}@example.invalid`;
    const password = `Synthetic-${randomUUID()}-a1!`;
    const { user } = response("Create Auth fixture", await admin.auth.admin.createUser({ email, password, email_confirm: true }));
    const accountId = `r386-${randomUUID()}`;
    await observer.query("INSERT INTO public.noor_authentication_account_linkages VALUES ($1,$2::text,$3,$2::text::uuid)", [issuer, user.id, accountId]);
    await observer.query("INSERT INTO public.noor_entitlement_grants VALUES ($1,$2,'access','application','noor-personal',0,NULL)", [randomUUID(), accountId]);
    return { ownerId: user.id, accountId, email, password };
  }
  async function signIn({ email, password }) {
    const client = createClient(api.origin, ANON_KEY, options);
    const { session } = response("GoTrue sign-in", await client.auth.signInWithPassword({ email, password }));
    assert.equal(JSON.parse(Buffer.from(session.access_token.split(".")[0], "base64url")).alg, "ES256");
    let noorId;
    try {
      noorId = (await operations.sessionEstablishment.execute({ proof: session.access_token })).id;
    } catch (error) {
      console.log("R386_G1_SESSION_FAILURE_TRACE " + JSON.stringify(trace.snapshot()));
      // Observer metadata only, no owner identifiers, no SQL/result bodies.
      try {
        const { rows } = await observer.query(`SELECT
          has_schema_privilege('noor_r386_g1_guard','auth','USAGE') AS guard_auth_usage,
          has_column_privilege('noor_r386_g1_guard','auth.users','id','SELECT') AS guard_user_select,
          has_column_privilege('noor_r386_g1_guard','auth.users','deleted_at','UPDATE') AS guard_user_lock,
          has_column_privilege('noor_r386_g1_guard','auth.sessions','id','SELECT') AS guard_session_select,
          has_column_privilege('noor_r386_g1_guard','auth.sessions','not_after','SELECT') AS guard_session_expiry_select,
          has_column_privilege('noor_r386_g1_guard','auth.sessions','not_after','UPDATE') AS guard_session_lock,
          has_column_privilege('noor_r386_g1_guard','auth.refresh_tokens','id','SELECT') AS guard_refresh_id_select,
          has_column_privilege('noor_r386_g1_guard','auth.refresh_tokens','session_id','SELECT') AS guard_refresh_session_select,
          has_column_privilege('noor_r386_g1_guard','auth.refresh_tokens','revoked','SELECT') AS guard_refresh_revoked_select,
          has_column_privilege('noor_r386_g1_guard','auth.refresh_tokens','revoked','UPDATE') AS guard_refresh_lock,
          has_column_privilege('service_role','public.noor_sessions','originating_auth_session_id','INSERT') AS service_binding_insert,
          has_function_privilege('noor_r386_g1_guard','noor_r386_candidate.g1_assert_live_managed_auth_session(uuid,uuid)','EXECUTE') AS guard_helper_execute`);
        console.log("R386_G1_SESSION_CATALOG " + JSON.stringify(rows[0]));
      } catch (diagnosticError) {
        console.log("R386_G1_SESSION_CATALOG_UNAVAILABLE " + JSON.stringify(safeSessionFailure(diagnosticError)));
      }
      throw error;
    }
    authClients.set(noorId, { client, proof: session.access_token, providerId: sessionClaim(session.access_token) });
    assert.equal((await observer.query("SELECT originating_auth_session_id FROM public.noor_sessions WHERE id=$1", [noorId])).rows[0].originating_auth_session_id, authClients.get(noorId).providerId);
    return noorId;
  }
  async function resolve(sessionId, ownerId) {
    const found = await operations.personalControl.resolveAuthorizedJournalUser(sessionId);
    assert.deepEqual(found, { kind: "ok", userId: ownerId });
    return { trustedNoorSessionId: sessionId, serverResolvedOwnerId: found.userId };
  }
  function save(identity, { existed, revision }, state) {
    return adapter.saveOperational({ ...identity, expectedExists: existed, expectedRevision: revision, state });
  }

  const owner = await makeAccount();
  const other = await makeAccount();
  const firstSession = await signIn(owner);
  const secondSession = await signIn(owner);
  const otherSession = await signIn(other);
  assert.notEqual(firstSession, secondSession);
  const first = await resolve(firstSession, owner.ownerId);
  const second = await resolve(secondSession, owner.ownerId);
  const separate = await resolve(otherSession, other.ownerId);
  const missing = await adapter.loadOperational(first);
  assert.deepEqual(missing, { existed: false, revision: 0, state: null });

  const init = evaluateR386InitializationCandidate(owner.ownerId, emptyState, "riyadh", "UmmAlQura",
    new Date().toISOString(), randomUUID(), randomUUID());
  assert.ok(init);
  assert.equal(await save(first, missing, init), true);
  assert.equal(await save(second, missing, init), false, "second creator must see a conflict");
  const baseline = await adapter.loadOperational(second);
  assert.deepEqual(baseline, { existed: true, revision: 1, state: init });
  assert.equal(await save(separate, missing, emptyState), true);
  const attempts = await Promise.all([
    save(first, baseline, { ...init, categories: ["device-one"] }),
    save(second, baseline, { ...init, categories: ["device-two"] }),
  ]);
  assert.equal(attempts.filter(Boolean).length, 1);
  const latest = await adapter.loadOperational(first);
  assert.deepEqual(await adapter.loadOperational(second), latest);
  assert.equal(latest.revision, 2);
  assert.deepEqual(latest.state.categories, [attempts[0] ? "device-one" : "device-two"]);
  assert.deepEqual(await adapter.loadOperational(separate), { existed: true, revision: 1, state: emptyState });
  await assert.rejects(save({ ...first, serverResolvedOwnerId: other.ownerId }, latest, init), /R386_G1_COMMIT_UNAVAILABLE/u);
  for (const table of ["public.noor_personal_foundations", "auth.users"]) {
    await assert.rejects(pool.query(`SELECT count(*) FROM ${table}`), { code: "42501" });
  }
  await assert.rejects(pool.query("SELECT noor_r386_candidate.g1_assert_live_managed_auth_session($1,$2)", [authClients.get(firstSession).providerId,owner.ownerId]), {code:"42501"});
  console.log("R386_G1_HOSTED_DIRECT_HELPER_CALL_DENIED=YES");
  console.log("R386_G1_REAL_NOOR_SIGNED_AUTH_RESTRICTED_FOUNDATION_TWO_DEVICES_PASS");

  await operations.sessionRevocation.execute({ sessionId: firstSession });
  await assert.rejects(save(first, latest, init), /R386_G1_COMMIT_UNAVAILABLE/u);
  await observer.query("UPDATE public.noor_entitlement_grants SET revoked_at_epoch_ms=$1 WHERE account_id=$2", [Date.now(), owner.accountId]);
  await assert.rejects(save(second, latest, init), /R386_G1_COMMIT_UNAVAILABLE/u);
  assert.equal((await observer.query("SELECT revision FROM public.noor_personal_foundations WHERE user_id=$1", [owner.ownerId])).rows[0].revision, "2");
  assert.equal((await observer.query("SELECT count(*) FROM pg_stat_activity WHERE usename=$1 AND state LIKE 'idle in transaction%'", [writerRole])).rows[0].count, "0");
  assert.deepEqual(await adapter.loadOperational(separate), { existed: true, revision: 1, state: emptyState });
  console.log("R386_G1_REAL_NOOR_SESSION_AND_GRANT_REVOKED_AFTER_AUTH_ROLLBACK_PASS");

  await observer.query("UPDATE public.noor_entitlement_grants SET revoked_at_epoch_ms=NULL WHERE account_id=$1", [owner.accountId]);
  const erasure = await observer.connect();
  try {
    await erasure.query("BEGIN");
    await erasure.query("INSERT INTO noor_r386_candidate.g1_owner_erasure_tombstone(owner_id) VALUES ($1)", [owner.ownerId]);
    await erasure.query("DELETE FROM public.noor_personal_foundations WHERE user_id=$1", [owner.ownerId]);
    await erasure.query("COMMIT");
  } finally {
    erasure.release(true);
  }
  await assert.rejects(save(second, missing, init), /R386_G1_COMMIT_UNAVAILABLE/u);
  assert.equal((await observer.query("SELECT count(*) FROM public.noor_personal_foundations WHERE user_id=$1", [owner.ownerId])).rows[0].count, "0");
  assert.deepEqual(await adapter.loadOperational(separate), { existed: true, revision: 1, state: emptyState });
  console.log("R386_G1_REAL_NOOR_OPERATIONAL_TOMBSTONE_PREVENTS_RECREATION_PASS");

  // Distinct account, so the previously proven NOOR-session and grant
  // revocation paths remain unchanged. Actual provider sign-out, not SQL simulation.
  const bound = await makeAccount();
  const aId = await signIn(bound), bId = await signIn(bound);
  const a = await resolve(aId, bound.ownerId), b = await resolve(bId, bound.ownerId);
  const aAuth = authClients.get(aId), bAuth = authClients.get(bId);
  assert.notEqual(aAuth.providerId, bAuth.providerId);
  const boundMissing = await adapter.loadOperational(a);
  assert.equal(await save(a, boundMissing, emptyState), true);
  const boundSnapshot = await adapter.loadOperational(b);
  assert.deepEqual(boundSnapshot.state, emptyState);

  // Even the observer cannot insert an inconsistent new binding in the fixture.
  await assert.rejects(observer.query(
    "INSERT INTO public.noor_sessions(id,account_id,created_at_epoch_ms,expires_at_epoch_ms,revoked_at_epoch_ms,originating_auth_session_id) VALUES ($1,$2,$3,$4,NULL,$5)",
    [randomUUID(), bound.accountId, Date.now(), Date.now()+60_000, authClients.get(otherSession).providerId]),
    /R386_G1_MANAGED_SESSION_DENIED/u);
  await assert.rejects(observer.query(
    "UPDATE public.noor_sessions SET originating_auth_session_id=$1 WHERE id=$2", [bAuth.providerId,aId]),
    /R386_G1_MANAGED_BINDING_IMMUTABLE/u);

  response("Provider local sign-out A", await aAuth.client.auth.signOut({scope:"local"}));
  await assert.rejects(adapter.loadOperational(a), /R386_G1_COMMIT_UNAVAILABLE/u);
  await assert.rejects(save(a,boundSnapshot,emptyState), /R386_G1_COMMIT_UNAVAILABLE/u);
  await assert.rejects(operations.sessionEstablishment.execute({proof:aAuth.proof}));
  assert.deepEqual(await adapter.loadOperational(b), boundSnapshot);
  const refreshed = response("Provider refresh B", await bAuth.client.auth.refreshSession());
  assert.equal(sessionClaim(refreshed.session.access_token), bAuth.providerId);
  assert.deepEqual(await adapter.loadOperational(b), boundSnapshot);
  const cId = await signIn(bound), c = await resolve(cId,bound.ownerId);

  response("Provider global sign-out B", await bAuth.client.auth.signOut({scope:"global"}));
  for (const identity of [b,c]) {
    await assert.rejects(adapter.loadOperational(identity), /R386_G1_COMMIT_UNAVAILABLE/u);
    await assert.rejects(save(identity,boundSnapshot,emptyState), /R386_G1_COMMIT_UNAVAILABLE/u);
  }
  await assert.rejects(operations.sessionEstablishment.execute({proof:authClients.get(cId).proof}));
  assert.deepEqual(await adapter.loadOperational(separate), {existed:true,revision:1,state:emptyState});
  assert.equal((await observer.query("SELECT count(*) FROM pg_stat_activity WHERE usename=$1 AND state LIKE 'idle in transaction%'",[writerRole])).rows[0].count,"0");
  console.log("R386_G1_PROVIDER_SESSION_BINDING_LOCAL_GLOBAL_LOGOUT_AND_REFRESH_PASS");
  const timed = await makeAccount();
  const timedId = await signIn(timed);
  const parallelId = await signIn(timed);
  const timedOwner = await resolve(timedId,timed.ownerId);
  const parallelOwner = await resolve(parallelId,timed.ownerId);
  const timedAuth = authClients.get(timedId);
  await observer.query("UPDATE auth.sessions SET not_after=clock_timestamp()-interval '1 minute' WHERE id=$1",
    [timedAuth.providerId]);
  await assert.rejects(adapter.loadOperational(timedOwner), /R386_G1_COMMIT_UNAVAILABLE/u);
  await assert.rejects(operations.sessionEstablishment.execute({proof:timedAuth.proof}));
  assert.deepEqual(await adapter.loadOperational(parallelOwner),{existed:false,revision:0,state:null});
  console.log("R386_G1_PROVIDER_NOT_AFTER_FAILS_CLOSED_PASS");
  const replayAuth = authClients.get(parallelId);
  const firstRefresh = response("Read provider refresh context",await replayAuth.client.auth.getSession()).session.refresh_token;
  const rotated = response("Rotate provider refresh once",await replayAuth.client.auth.refreshSession()).session.refresh_token;
  const last = response("Rotate provider refresh twice",await replayAuth.client.auth.refreshSession()).session.refresh_token;
  assert.notEqual(firstRefresh,rotated);
  assert.notEqual(rotated,last);
  // The default provider reuse window is ten seconds. Two rotations bypass
  // the parent-token retry exception, then an actual provider replay revokes.
  await delay(11_000);
  assert.ok((await replayAuth.client.auth.refreshSession({refresh_token:firstRefresh})).error);
  await assert.rejects(adapter.loadOperational(parallelOwner),/R386_G1_COMMIT_UNAVAILABLE/u);
  await assert.rejects(operations.sessionEstablishment.execute({proof:replayAuth.proof}));
  assert.deepEqual(await adapter.loadOperational(separate),{existed:true,revision:1,state:emptyState});
  console.log("R386_G1_PROVIDER_REFRESH_REUSE_TERMINATION_PASS");


  await exerciseManagedErasure({admin,observer,operations,adapter,response,makeAccount,signIn,resolve,save,emptyState,authClients,other,otherSession});
} finally {
  globalThis.fetch = nativeFetch;
  await host.shutdown();
  await pool.end();
  await observer.end();
}
