import assert from "node:assert/strict";
import { createCipheriv, randomBytes, randomUUID } from "node:crypto";
import { createR386G1PermanentErasureCoordinator } from "../../../apps/noor-runtime/dist/noor-r386-g1-permanent-erasure-coordinator.js";
import { createManagedIsolateErasureBackend, G1_ERASURE_BUCKET } from "./g1-managed-erasure.mjs";
import { totp } from "./g1-managed-totp.mjs";

const notComplete = /R386_G1_ERASURE_INCOMPLETE_RETRY_REQUIRED/u;
const unauthorized = /R386_G1_ERASURE_AUTHORITY_UNAVAILABLE/u;
const jobs = "noor_r386_candidate.g1_managed_erasure_job";

async function seedStores(observer, account, role) {
  const { ownerId } = account;
  const task = randomUUID(), habit = randomUUID(), event = randomUUID();
  const today = new Date().toISOString();
  await observer.query("INSERT INTO public.noor_admin_accounts_r271(auth_user_id,account_id,role) VALUES($1,$2,$3)", [ownerId, account.accountId, role]);
  await observer.query("INSERT INTO public.tasks VALUES($1,$2,'Synthetic task')", [task, ownerId]);
  await observer.query("INSERT INTO public.task_events VALUES($1,$2,$3)", [randomUUID(), task, ownerId]);
  await observer.query("INSERT INTO public.habits VALUES($1,$2,'Synthetic habit')", [habit, ownerId]);
  await observer.query("INSERT INTO public.habit_entries VALUES($1,$2,$3)", [randomUUID(), habit, ownerId]);
  await observer.query("INSERT INTO public.noor_work_teacher_states_r264 VALUES($1,'{\"synthetic\":true}')", [ownerId]);
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", randomBytes(32), nonce);
  const ciphertext = Buffer.concat([cipher.update("Synthetic journal"), cipher.final()]);
  await observer.query("INSERT INTO public.noor_private_journal_entries_r221 VALUES($1,$2,1,$3,$4,$5)",
    [ownerId, randomUUID(), nonce.toString("base64"), cipher.getAuthTag().toString("base64"), ciphertext.toString("base64")]);
  await observer.query("INSERT INTO noor_r386_candidate.owner_scope VALUES($1)", [ownerId]);
  const record = {
    id: event, idempotencyKey: event, userId: ownerId, eventType: "PersonalDayCreated", eventVersion: 1,
    aggregateType: "PersonalDay", aggregateId: "day-1", aggregateVersion: 1, personalDayId: "day-1",
    correlationId: event, privacyClassification: "PersonalOperationalData", occurredAt: today,
    payload: { boundaryKey: "synthetic", localDate: today.slice(0,10) },
  };
  const tx = await observer.connect();
  try {
    await tx.query("BEGIN");
    await tx.query("INSERT INTO noor_r386_candidate.event_history VALUES($1,$2,$2,1,$3)", [ownerId,event,record]);
    await tx.query("INSERT INTO noor_r386_candidate.delivery_outbox VALUES($1,$2,'Pending')", [ownerId,event]);
    await tx.query("COMMIT");
  } finally {
    tx.release(true);
  }
  await observer.query("INSERT INTO noor_r386_candidate.checkpoint VALUES($1,1,1,1,true)", [ownerId]);
  await observer.query("INSERT INTO noor_r386_candidate.command_receipt VALUES($1,'req','v1',decode(repeat('00',32),'hex'),1,clock_timestamp(),clock_timestamp()+interval '1 day')", [ownerId]);
  await observer.query(`INSERT INTO noor_r386_candidate.s4_fact
    (owner_id,fact_kind,entity_id,sub_id,source_revision,observation,record)
    VALUES($1,'activity','synthetic','fact',1,'FirstObserved','{}')`, [ownerId]);
}

async function verifyTotp(client, response) {
  const { id: factorId, totp: enrollment } = response("Enroll TOTP", await client.auth.mfa.enroll({factorType:"totp"}));
  const { id: challengeId } = response("Challenge TOTP", await client.auth.mfa.challenge({factorId}));
  response("Verify TOTP", await client.auth.mfa.verify({factorId,challengeId,code:totp(enrollment.secret)}));
  return factorId;
}

export async function exerciseManagedErasure({ admin, observer, operations, adapter, response, makeAccount, signIn,
  resolve, save, emptyState, authClients, other, otherSession }) {
  const operator = await makeAccount(), target = await makeAccount();
  const targetSession = await signIn(target), targetSession2 = await signIn(target);
  const actorSession = await signIn(operator);
  const actorAuth = authClients.get(actorSession);
  const targetAuth = authClients.get(targetSession);
  const targetScope = await resolve(targetSession, target.ownerId);
  const absent = await adapter.loadOperational(targetScope);
  assert.equal(await save(targetScope, absent, emptyState), true);
  const targetFactor = await verifyTotp(targetAuth.client,response);
  await seedStores(observer, target, "admin");
  await seedStores(observer, other, "admin");
  await observer.query("INSERT INTO public.noor_admin_accounts_r271(auth_user_id,account_id,role) VALUES($1,$2,'super_admin')",
    [operator.ownerId, operator.accountId]);

  const mixedActor = randomUUID(), mixedTarget = randomUUID(), unrelated = randomUUID();
  for (const [id,actorId,targetId,details] of [
    [mixedActor,target.ownerId,other.ownerId,{ nested:{ subject: target.email, other: "keep-other" } }],
    [mixedTarget,other.ownerId,target.ownerId,{ accountId: target.accountId, source: "keep-source" }],
    [unrelated,operator.ownerId,other.ownerId,{ nested:{ value: "untouched" } }],
  ]) {
    await observer.query(`INSERT INTO public.noor_admin_audit_r271
      (id,actor_auth_user_id,target_auth_user_id,action,outcome,request_id,details)
      VALUES($1,$2,$3,'manage','success',$1,$4)`, [id,actorId,targetId,details]);
  }
  const unchanged = (await observer.query("SELECT * FROM public.noor_admin_audit_r271 WHERE id=$1", [unrelated])).rows[0];
  response("Create isolated erasure bucket", await admin.storage.createBucket(G1_ERASURE_BUCKET,{public:false}));
  const targetPath = target.ownerId + "/file.txt", otherPath = other.ownerId + "/file.txt";
  const targetStorage = targetAuth.client.storage.from(G1_ERASURE_BUCKET);
  const otherStorage = authClients.get(otherSession).client.storage.from(G1_ERASURE_BUCKET);
  response("Upload target object", await targetStorage.upload(targetPath,"target synthetic",{contentType:"text/plain"}));
  response("Upload other object", await otherStorage.upload(otherPath,"unrelated synthetic",{contentType:"text/plain"}));

  let hardDeletes = 0;
  const backend = () => {
    const port = createManagedIsolateErasureBackend({observer,admin});
    return {...port, async hardDeleteManagedAuth(fence) { hardDeletes++; await port.hardDeleteManagedAuth(fence); }};
  };
  const intent = { operatorSessionId: actorSession, targetAuthUserId: target.ownerId,
    requestId: randomUUID(), confirmation:"ERASE_NOOR_PERMANENTLY" };
  await assert.rejects(createR386G1PermanentErasureCoordinator(backend()).erase(intent), unauthorized);
  await verifyTotp(actorAuth.client,response);
  const amr = (await observer.query("SELECT updated_at FROM auth.mfa_amr_claims WHERE session_id=$1 AND authentication_method='totp'", [actorAuth.providerId])).rows[0];
  assert.ok(amr);
  await observer.query("UPDATE auth.mfa_amr_claims SET updated_at=clock_timestamp()-interval '6 minutes' WHERE session_id=$1 AND authentication_method='totp'", [actorAuth.providerId]);
  await assert.rejects(createR386G1PermanentErasureCoordinator(backend()).erase(intent), unauthorized);
  await observer.query("UPDATE auth.mfa_amr_claims SET updated_at=$1 WHERE session_id=$2 AND authentication_method='totp'", [amr.updated_at, actorAuth.providerId]);
  assert.equal((await observer.query(`SELECT count(*) FROM ${jobs} WHERE target_id=$1`, [target.ownerId])).rows[0].count,"0");

  const interrupted = backend();
  await assert.rejects(createR386G1PermanentErasureCoordinator({
    ...interrupted,
    async eraseStore(fence,store) {
      if (store === "candidate-analytics") throw new Error("Synthetic storage interruption");
      await interrupted.eraseStore(fence,store);
    },
  }).erase(intent),notComplete);
  assert.equal(hardDeletes,0);
  assert.equal((await observer.query("SELECT count(*) FROM public.noor_sessions WHERE id=ANY($1::text[]) AND revoked_at_epoch_ms IS NOT NULL",
    [[targetSession,targetSession2]])).rows[0].count,"2");
  assert.ok((await targetStorage.upload(target.ownerId + "/recreated.txt","blocked")).error);
  await assert.rejects(save(targetScope,absent,emptyState),/R386_G1_COMMIT_UNAVAILABLE/u);
  await assert.rejects(operations.sessionEstablishment.execute({proof:targetAuth.proof}));

  const lostAck = backend();
  await assert.rejects(createR386G1PermanentErasureCoordinator({
    ...lostAck,
    async hardDeleteManagedAuth(fence) {
      await lostAck.hardDeleteManagedAuth(fence);
      throw new Error("Synthetic lost provider acknowledgement");
    },
  }).erase(intent),notComplete);
  assert.equal(hardDeletes,1);

  // A fresh coordinator instance resumes from persisted keys after Auth and NOOR
  // linkages have disappeared. External retention keeps the job pending.
  await assert.rejects(createR386G1PermanentErasureCoordinator(backend()).erase(intent),notComplete);
  assert.equal(hardDeletes,1);
  const job = (await observer.query(`SELECT database_verified_at,completed_at FROM ${jobs} WHERE target_id=$1`, [target.ownerId])).rows[0];
  assert.ok(job.database_verified_at);
  assert.equal(job.completed_at,null);
  assert.equal((await observer.query("SELECT count(*) FROM auth.mfa_challenges WHERE factor_id=$1",
    [targetFactor])).rows[0].count,"0");
  assert.equal((await observer.query("SELECT count(*) FROM auth.mfa_amr_claims WHERE session_id=$1",
    [targetAuth.providerId])).rows[0].count,"0");
  const rows = (await observer.query("SELECT * FROM public.noor_admin_audit_r271 WHERE id=ANY($1::uuid[])",
    [[mixedActor,mixedTarget,unrelated]])).rows;
  const first = rows.find(row=>row.id===mixedActor), second = rows.find(row=>row.id===mixedTarget);
  assert.equal(first.actor_auth_user_id,null);
  assert.equal(first.actor_erased,true);
  assert.equal(first.target_auth_user_id,other.ownerId);
  assert.deepEqual(first.details,{nested:{subject:"[erased]",other:"keep-other"}});
  assert.equal(second.actor_auth_user_id,other.ownerId);
  assert.equal(second.target_auth_user_id,null);
  assert.equal(second.target_erased,true);
  assert.deepEqual(second.details,{accountId:"[erased]",source:"keep-source"});
  assert.deepEqual(rows.find(row=>row.id===unrelated),unchanged);
  assert.equal(await (response("Read preserved other object",await otherStorage.download(otherPath))).text(),"unrelated synthetic");
  assert.equal((await observer.query("SELECT count(*) FROM public.noor_private_journal_entries_r221 WHERE owner_user_id=$1",[other.ownerId])).rows[0].count,"1");
  assert.equal((await observer.query("SELECT count(*) FROM noor_r386_candidate.event_history WHERE owner_id=$1",[other.ownerId])).rows[0].count,"1");
  assert.equal((await observer.query("SELECT count(*) FROM auth.users WHERE id=$1",[other.ownerId])).rows[0].count,"1");
  console.log("R386_G1_ERASURE_DATABASE_STORAGE_AUTH_AND_RESTART_PASS_EXTERNAL_RETENTION_PENDING");
}
