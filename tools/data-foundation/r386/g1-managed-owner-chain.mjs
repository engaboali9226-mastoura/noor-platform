import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { setTimeout as delay } from "node:timers/promises";
import { createClient } from "@supabase/supabase-js";
import { evaluateR386InitializationCandidate } from "@noor/personal";
import { Pool } from "pg";
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

const observer = new Pool({ connectionString: DB_URL, max: 2 });
const writerConnection = new URL(DB_URL);
writerConnection.username = writerRole;
writerConnection.password = writerPassword;
const pool = new Pool({ connectionString: writerConnection.href, max: 2 });
const adapter = createNoorR386G1SqlCommitAdapter({ pool, expectedSqlRole: writerRole });
const host = createPrivilegedPlatformRuntimeHost({
  supabaseUrl: api.origin, supabaseServiceRoleKey: SERVICE_ROLE_KEY,
  expectedIssuer: issuer, expectedAudience: "authenticated", expectedAlgorithm: "ES256", sessionLifetimeMs: 3600_000,
});

function response(label, { data, error }) {
  if (error) throw new Error(`${label}: ${error.code ?? error.status ?? error.name}`);
  return data;
}

const emptyState = { locations: [], prayerPolicies: [], personalDays: [], islamicContexts: [], definitions: [], dailyExecution: [], outbox: [] };

try {
  // Confirm PostgREST has observed the fixture's committed schema before establishing sessions.
  for (let attempt = 0; ; attempt++) {
    const result = await admin.from("noor_sessions").select("id").limit(1);
    if (!result.error) break;
    if (attempt === 20) response("PostgREST schema cache", result);
    await delay(150);
  }
  const operations = await host.start();
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
    return (await operations.sessionEstablishment.execute({ proof: session.access_token })).id;
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
} finally {
  await host.shutdown();
  await pool.end();
  await observer.end();
}
