import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { setTimeout as delay } from "node:timers/promises";
import { createClient } from "@supabase/supabase-js";
import { evaluateR386InitializationCandidate } from "@noor/personal";
import { Pool } from "pg";
import { executeReceiptCandidate } from "./receipt-bridge.mjs";
import { createPersistentSaveAdapter } from "./s3-persistent-adapter.mjs";
import { createR386RuntimeSaveCandidate } from "./s3-runtime-coordinator.mjs";
import { exerciseManagedErasure } from "./g234-restricted-erasure-exercise.mjs";
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
const schedulerPassword=randomUUID(),eraserPassword=randomUUID();
const fixture = spawnSync("psql", ["-Xqw", "-v", "ON_ERROR_STOP=1", "-f", "tools/data-foundation/r386/g234-erasure-fixture.sql"], {
  env: {
    ...process.env,
    R386_G1_WRITER_PASSWORD: writerPassword,R386_RUNTIME_SCHEDULER_PASSWORD:schedulerPassword,R386_ERASER_PASSWORD:eraserPassword,
    PGHOST: db.hostname, PGPORT: db.port, PGDATABASE: decodeURIComponent(db.pathname.slice(1)),
    PGUSER: decodeURIComponent(db.username), PGPASSWORD: decodeURIComponent(db.password), PGSSLMODE: "disable",
  },
  encoding: "utf8",
});
// Read the password from the same disposable runner's environment via psql;
// do not put it in argv or exception output.
if (fixture.status !== 0) throw new Error(fixture.stderr?.replaceAll(writerPassword, "[redacted]").replaceAll(schedulerPassword,"[redacted]").replaceAll(eraserPassword,"[redacted]") ?? "G1 fixture failed");

console.log("R386_G1_HOSTED_HELPER_ACL_VERIFIED=YES");
const observer = new Pool({ connectionString: DB_URL, max: 2 });
const writerConnection = new URL(DB_URL);
writerConnection.username = writerRole;
writerConnection.password = writerPassword;
const pool = new Pool({ connectionString: writerConnection.href, max: 2 });
const adapter = createNoorR386G1SqlCommitAdapter({ pool, expectedSqlRole: writerRole });
const eraserConnection=new URL(DB_URL);
eraserConnection.username="noor_r386_g1_eraser";eraserConnection.password=eraserPassword;
const eraserPool=new Pool({connectionString:eraserConnection.href,max:2});
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


  const other=await makeAccount(),otherSession=await signIn(other);
  const otherIdentity=await resolve(otherSession,other.ownerId);
  assert.equal(await save(otherIdentity,{existed:false,revision:0},emptyState),true);
  const keys=new Map([["fixture",Buffer.alloc(32,91)]]);
  const atomic=createR386RuntimeSaveCandidate({database:null,keys,activeKeyId:"fixture",clock:{now:()=>new Date().toISOString()},sqlCommit:adapter});
  async function prepareTarget(identity,target){
    const p=target.ownerId,cs="noor_r386_candidate.";
    await observer.query("INSERT INTO "+cs+"g234_scope(owner_id) VALUES($1)",[p]);
    await observer.query("INSERT INTO "+cs+"s3_enrollment(owner_id,shadow_enabled) VALUES($1,true)",[p]);
    assert.equal((await atomic.initialize({trustedNoorSessionId:identity.trustedNoorSessionId,ownerId:p,requestId:"erasure-init",city:"riyadh",calculationMethod:"UmmAlQura"})).status,204);
    const source=await adapter.load(identity),now=new Date().toISOString(),id=randomUUID();
    const event={id,idempotencyKey:id,userId:p,eventVersion:1,aggregateVersion:1,eventType:"PersonalDayCreated",aggregateType:"PersonalDay",aggregateId:"erasure-day",personalDayId:"erasure-day",correlationId:id,occurredAt:now,deliveryState:"Pending",privacyClassification:"PersonalOperationalData",payload:{boundaryKey:"erasure-boundary",localDate:now.slice(0,10)}};
    const fp="a".repeat(64);
    const committed=await adapter.commit({...identity,requestId:"erasure-event",expectedExists:source.existed,expectedRevision:source.revision,before:source.state,after:{...source.state,outbox:[...source.state.outbox,event]},keyId:"fixture",digest:fp,fingerprints:{fixture:fp},deleteRefs:[]});
    assert.equal(committed.kind,"committed");
    const latest=await adapter.load(identity);
    await observer.query("SELECT "+cs+"s3_matches($1,$2::jsonb)",[p,JSON.stringify(latest.state.outbox)]);
    assert.ok((await observer.query("SELECT count(*) n FROM "+cs+"event_history WHERE owner_id=$1",[p])).rows[0].n!=="0");
    await observer.query("INSERT INTO "+cs+"s4_fact(owner_id,fact_kind,entity_id,sub_id,source_revision,observation,record) VALUES($1,'activity','synthetic','fact',$2,'FirstObserved','{}')",[p,latest.revision]);
    console.log("R386_ERASURE_ACTUAL_DUAL_PERSISTED_TARGET_READY");
  }
  await exerciseManagedErasure({admin,observer,operations,adapter,response,makeAccount,signIn,resolve,save,emptyState,authClients,other,otherSession,eraserPool,prepareTarget});
} finally {
  globalThis.fetch = nativeFetch;
  await host.shutdown();
  await pool.end();
  await eraserPool.end();
  await observer.end();
}
