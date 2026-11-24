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
import { projectS4Analytics } from "./s4-analytics-projection.mjs";
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
const fixture = spawnSync("psql", ["-Xqw", "-v", "ON_ERROR_STOP=1", "-f", "tools/data-foundation/r386/g234-managed-fixture.sql"], {
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


  // New combined real-source rail only: no repeat of previous auth/erasure suites.
  const owner=await makeAccount(), other=await makeAccount();
  const first=await resolve(await signIn(owner),owner.ownerId);
  const second=await resolve(await signIn(owner),owner.ownerId);
  const isolated=await resolve(await signIn(other),other.ownerId);
  const p=owner.ownerId, q=other.ownerId;
  const cs="noor_r386_candidate.";
  const at=new Date().toISOString();
  const empty={historicalEvents:[],notificationHistory:[],fridayMosqueVisits:[],...emptyState};
  const original=evaluateR386InitializationCandidate(p,empty,"riyadh","UmmAlQura",at,randomUUID(),randomUUID());
  assert.ok(original);
  const event=(id,status="Pending")=>({id:"g234-event-"+id,idempotencyKey:"g234-key-"+id,userId:p,
    eventVersion:1,aggregateVersion:1,eventType:"PersonalDayCreated",aggregateType:"PersonalDay",
    aggregateId:"g234-day-"+id,personalDayId:"g234-day-"+id,correlationId:"g234-corr-"+id,
    occurredAt:at,deliveryState:status,privacyClassification:"PersonalOperationalData",
    payload:{boundaryKey:"g234-boundary-"+id,localDate:at.slice(0,10)}});
  const seeded={...original,outbox:[...original.outbox,...Array.from({length:7},(_,i)=>event("legacy-"+i,["Pending","Delivered","Failed"][i%3]))]};
  assert.equal(await save(first,{existed:false,revision:0},seeded),true);
  await observer.query("INSERT INTO "+cs+"g234_scope(owner_id) VALUES($1),($2)",[p,q]);
  const initial=await adapter.loadOperational(first);
  assert.deepEqual(initial.state,seeded);
  async function batch(rev,cursor,limit=3) {
    return (await observer.query("SELECT copied,verified FROM "+cs+"s2_copy_batch($1,$2,$3,$4)",[p,rev,cursor,limit])).rows[0];
  }
  // Every query is a separate committed transaction; same cursor replay and
  // changed source revision must not silently advance or mutate old authority.
  assert.deepEqual(await batch(1,0),{copied:"3",verified:false});
  assert.deepEqual(await batch(1,0),{copied:"3",verified:false});
  assert.equal(await save(first,initial,{...seeded,outbox:[...seeded.outbox,event("during-copy")]}),true);
  await assert.rejects(batch(1,3),/R386_S2_REVISION_CONFLICT/u);
  assert.equal((await observer.query("SELECT "+cs+"s2_discard_stale($1,1,2) AS ok",[p])).rows[0].ok,true);
  const baseline=await adapter.loadOperational(first);
  let cursor=0,complete=false;
  while(!complete){const step=await batch(2,cursor);assert.ok(Number(step.copied)>cursor);cursor=Number(step.copied);complete=step.verified;}
  assert.equal(cursor,baseline.state.outbox.length);
  assert.deepEqual(await adapter.loadOperational(second),baseline);
  await observer.query("SELECT "+cs+"s3_matches($1,$2::jsonb)",[p,JSON.stringify(baseline.state.outbox)]);
  console.log("R386_G234_G2_ACTUAL_SOURCE_BATCH_RESTART_AND_EXACT_PARITY_PASS");

  await observer.query("INSERT INTO "+cs+"s3_enrollment(owner_id,shadow_enabled) VALUES($1,true),($2,true)",[p,q]);
  await assert.rejects(save(first,baseline,baseline.state),/R386_G1_COMMIT_UNAVAILABLE/u);
  const keys=new Map([["k1",Buffer.alloc(32,71)],["k2",Buffer.alloc(32,72)]]);
  const atomic=createR386RuntimeSaveCandidate({database:null,keys,activeKeyId:"k2",clock:{now:()=>at},sqlCommit:adapter});
  assert.equal((await atomic.initialize({trustedNoorSessionId:isolated.trustedNoorSessionId,ownerId:q,requestId:"g234-init-other",
    city:"riyadh",calculationMethod:"UmmAlQura"})).status,204);
  const otherBefore=await adapter.load(isolated);
  assert.equal(otherBefore.revision,1);
  function dbFor(identity,lostAck=false) {
    return {
      load:o=>{assert.equal(o,identity.serverResolvedOwnerId);return adapter.load(identity);},
      lookup:(o,requestId)=>{assert.equal(o,identity.serverResolvedOwnerId);return adapter.lookup({...identity,requestId});},
      commit:async x=>{
        assert.equal(x.owner,identity.serverResolvedOwnerId);
        const result=await adapter.commit({...identity,requestId:x.requestId,expectedExists:x.existed,expectedRevision:x.expectedRevision,
          before:x.before,after:x.after,keyId:x.keyId,digest:x.digest,fingerprints:x.fingerprints,deleteRefs:x.deleteRefs});
        if(lostAck)throw Error("SYNTHETIC_ACK_LOST");
        return result;
      }
    };
  }
  const increment=id=>state=>({...state,outbox:[...state.outbox,event(id)]});
  const run=(identity,id,evaluate,transport=dbFor(identity),command={type:"g234-synthetic-command",id})=>
    executeReceiptCandidate({owner:identity.serverResolvedOwnerId,requestId:id,command,keys,activeKeyId:"k2",
      evaluate,adapter:createPersistentSaveAdapter({database:transport})});
  assert.equal((await run(first,"g234-lost-ack",increment("lost-ack"),dbFor(first,true))).revision,3);
  assert.equal((await run(second,"g234-lost-ack",()=>{throw Error("REPLAY_MUST_NOT_EVALUATE");})).revision,3);
  await assert.rejects(run(second,"g234-lost-ack",()=>{throw Error("COLLISION_MUST_NOT_EVALUATE");},dbFor(second),{type:"different"}),/R386_RECEIPT_COLLISION/u);
  let waiting=0,open;const barrier=new Promise(r=>open=r);
  const evaluate=id=>{let once=false;return async state=>{if(!once){once=true;if(++waiting===2)open();await barrier;}return increment(id)(state);};};
  const results=await Promise.all([run(first,"g234-device-a",evaluate("device-a")),run(second,"g234-device-b",evaluate("device-b"))]);
  assert.deepEqual(results.map(r=>r.revision).sort((a,b)=>a-b),[4,5]);
  const current=await adapter.load(second);
  assert.deepEqual(await adapter.loadOperational(first),current);
  await observer.query("SELECT "+cs+"s3_matches($1,$2::jsonb)",[p,JSON.stringify(current.state.outbox)]);
  assert.equal((await observer.query("SELECT count(*) n FROM "+cs+"command_receipt WHERE owner_id=$1",[p])).rows[0].n,"3");
  assert.deepEqual(await adapter.load(isolated),otherBefore);
  // Raw SQL and wrong-owner access remain forbidden.
  await assert.rejects(adapter.load({...first,serverResolvedOwnerId:q}),/R386_G1_COMMIT_UNAVAILABLE/u);
  console.log("R386_G234_G3_ACTUAL_SOURCE_ATOMIC_RECEIPT_CONCURRENT_CAS_PASS");

  // A failure in the candidate write must roll the original state and receipt
  // back together. Inject a disposable failing trigger for one exact event.
  await observer.query("CREATE FUNCTION "+cs+"g234_fail_event() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$ BEGIN IF NEW.event_id='g234-event-forced-failure' THEN RAISE EXCEPTION 'R386_G234_FORCED_FAILURE'; END IF; RETURN NEW; END $$");
  await observer.query("CREATE TRIGGER g234_fail_event BEFORE INSERT ON "+cs+"event_history FOR EACH ROW EXECUTE FUNCTION "+cs+"g234_fail_event()");
  try {
    const rejected=await run(first,"g234-forced-failure",increment("forced-failure"));
    assert.equal(rejected.status,503);
    assert.equal(await adapter.lookup({...first,requestId:"g234-forced-failure"}),null);
    assert.deepEqual(await adapter.load(first),current);
  } finally {
    await observer.query("DROP TRIGGER g234_fail_event ON "+cs+"event_history");
    await observer.query("DROP FUNCTION "+cs+"g234_fail_event()");
  }
  assert.equal((await run(first,"g234-forced-failure",increment("forced-failure"))).revision,6);
  console.log("R386_G234_G3_FAILURE_ROLLBACK_AND_SAFE_RETRY_PASS");

  const final=await adapter.load(first);
  await observer.query("SELECT "+cs+"s3_matches($1,$2::jsonb)",[p,JSON.stringify(final.state.outbox)]);
  const authoritative=await adapter.loadOperational(second);
  assert.deepEqual(final,authoritative);
  const projection=await projectS4Analytics({owner:p,sourceRevision:final.revision,state:final.state,evaluatedAt:at});
  const authoritativeProjection=await projectS4Analytics({owner:p,sourceRevision:authoritative.revision,state:authoritative.state,evaluatedAt:at});
  assert.deepEqual(projection,authoritativeProjection);
  // Deliberately introduce shadow-only drift. Existing rollback leaves original
  // source authoritative, preserves receipts, rejects split writer and cannot
  // silently re-enable the stale shadow.
  await observer.query("UPDATE "+cs+"delivery_outbox SET state='Failed' WHERE owner_id=$1 AND event_id='g234-event-legacy-0'",[p]);
  const history=(await observer.query("SELECT count(*) n FROM "+cs+"event_history WHERE owner_id=$1",[p])).rows[0].n;
  assert.equal((await observer.query("SELECT "+cs+"s3_enter_rollback($1) AS ok",[p])).rows[0].ok,true);
  assert.equal((await run(second,"g234-lost-ack",()=>{throw Error("LATE_REPLAY_MUST_NOT_EVALUATE");})).revision,3);
  assert.equal((await run(first,"g234-after-rollback",increment("rollback"))).revision,7);
  assert.equal((await observer.query("SELECT count(*) n FROM "+cs+"event_history WHERE owner_id=$1",[p])).rows[0].n,history);
  await assert.rejects(observer.query("UPDATE "+cs+"s3_enrollment SET rollback_only=false,shadow_enabled=true WHERE owner_id=$1",[p]),/R386_S3_ROLLBACK_RECONCILIATION_REQUIRED/u);
  const afterRollback=await adapter.load(second);
  assert.equal(afterRollback.revision,7);
  assert.ok(afterRollback.state.outbox.some(e=>e.id==="g234-event-rollback"));
  assert.deepEqual(await adapter.loadOperational(first),afterRollback);
  assert.deepEqual(await adapter.load(isolated),otherBefore);
  console.log("R386_G234_G4_SOURCE_PARITY_AND_ROLLBACK_PASS");
  await operations.sessionRevocation.execute({sessionId:first.trustedNoorSessionId});
  await assert.rejects(adapter.lookup({...first,requestId:"g234-lost-ack"}),/R386_G1_COMMIT_UNAVAILABLE/u);
  assert.equal((await adapter.lookup({...second,requestId:"g234-lost-ack"})).revision,3);
  console.log("R386_G234_COMBINED_MANAGED_SOURCE_PROOF_PASS");
} finally {
  globalThis.fetch = nativeFetch;
  await host.shutdown();
  await pool.end();
  await observer.end();
}
