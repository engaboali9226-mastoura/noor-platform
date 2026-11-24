import assert from "node:assert/strict";
import {randomUUID,generateKeyPairSync,createHash,sign} from "node:crypto";
import {spawnSync} from "node:child_process";
import {readFileSync} from "node:fs";
import {setTimeout as delay} from "node:timers/promises";
import {createClient} from "@supabase/supabase-js";
import {Pool} from "pg";
import {evaluateR386InitializationCandidate} from "@noor/personal";
import {createPrivilegedPlatformRuntimeHost} from "../../../apps/noor-runtime/dist/privileged-platform-runtime-host.js";
import {createNoorR386G1SqlCommitAdapter} from "../../../apps/noor-runtime/dist/noor-r386-g1-sql-commit-adapter.js";
import {createR386G1PermanentErasureCoordinator} from "../../../apps/noor-runtime/dist/noor-r386-g1-permanent-erasure-coordinator.js";
import {createRestrictedErasureBackend} from "./g234-restricted-erasure.mjs";
import {totp} from "./g1-managed-totp.mjs";
import {canonicalJson} from "./shadow-transition.mjs";
import {verifyRecoveryLedger,quarantineRestoredOwners,verifyRestoredDatabaseReconciliation} from "./r386-release-restore-guard.mjs";
const {API_URL,DB_URL,ANON_KEY,SERVICE_ROLE_KEY}=JSON.parse(readFileSync(process.argv[2],"utf8"));
const api=new URL(API_URL),db=new URL(DB_URL);
assert.equal(api.protocol,"https:");assert.equal(api.hostname,"127.0.0.1");assert.equal(db.protocol,"postgresql:");assert.equal(db.hostname,"127.0.0.1");
const issuer=api.origin+"/auth/v1",opts={auth:{autoRefreshToken:false,persistSession:false,detectSessionInUrl:false}};
const admin=createClient(api.origin,SERVICE_ROLE_KEY,opts);
const observer=new Pool({connectionString:DB_URL,max:2});
const writerPassword=randomUUID(),schedulerPassword=randomUUID(),eraserPassword=randomUUID();
const cfg={supabaseUrl:api.origin,supabaseServiceRoleKey:SERVICE_ROLE_KEY,expectedIssuer:issuer,expectedAudience:"authenticated",expectedAlgorithm:"ES256",sessionLifetimeMs:3600_000};
const cs="noor_r386_candidate.";
let writer,eraser,host;
function response(label,r){if(r.error)throw Error(label+":"+(r.error.code??r.error.status??r.error.name));return r.data}
function fixture(name){
 const v=spawnSync("psql",["-Xqw","-v","ON_ERROR_STOP=1","-f","tools/data-foundation/r386/"+name],{env:{...process.env,PGHOST:db.hostname,PGPORT:db.port,PGDATABASE:decodeURIComponent(db.pathname.slice(1)),PGUSER:decodeURIComponent(db.username),PGPASSWORD:decodeURIComponent(db.password),PGSSLMODE:"disable",R386_G1_WRITER_PASSWORD:writerPassword,R386_RUNTIME_SCHEDULER_PASSWORD:schedulerPassword,R386_ERASER_PASSWORD:eraserPassword},encoding:"utf8"});
 if(v.status!==0)throw Error((v.stderr??"fixture failed").replaceAll(writerPassword,"[redacted]").replaceAll(schedulerPassword,"[redacted]").replaceAll(eraserPassword,"[redacted]"));
}
function poolAs(role,password){const u=new URL(DB_URL);u.username=role;u.password=password;return new Pool({connectionString:u.href,max:2})}
async function account(){
 const email="noor-"+randomUUID()+"@example.invalid",password="Synthetic-"+randomUUID()+"-a1!";
 const {user}=response("create fixture",await admin.auth.admin.createUser({email,password,email_confirm:true}));
 const accountId="r386-"+randomUUID(),ownerId=user.id;
 await observer.query("INSERT INTO public.noor_authentication_account_linkages(issuer,subject,account_id,user_id) VALUES($1,$2::text,$3,$2::text::uuid)",[issuer,ownerId,accountId]);
 await observer.query("INSERT INTO public.noor_entitlement_grants VALUES($1,$2,'access','application','noor-personal',0,NULL)",["grant-"+randomUUID(),accountId]);
 return {email,password,ownerId,accountId};
}
async function signIn(a){const client=createClient(api.origin,ANON_KEY,opts);const {session}=response("sign in",await client.auth.signInWithPassword({email:a.email,password:a.password}));return {client,proof:session.access_token}}
const empty={historicalEvents:[],notificationHistory:[],fridayMosqueVisits:[],locations:[],prayerPolicies:[],personalDays:[],islamicContexts:[],definitions:[],dailyExecution:[],outbox:[]};
const hash=s=>createHash("sha256").update(s).digest("hex");
function event(owner,tag){const now=new Date().toISOString(),id=randomUUID();return {id,idempotencyKey:id,userId:owner,eventVersion:1,aggregateVersion:1,eventType:"PersonalDayCreated",aggregateType:"PersonalDay",aggregateId:"day-"+tag,personalDayId:"day-"+tag,correlationId:id,occurredAt:now,deliveryState:"Pending",privacyClassification:"PersonalOperationalData",payload:{boundaryKey:"boundary-"+tag,localDate:now.slice(0,10)}}}
async function seed(a,tag){
 const original=evaluateR386InitializationCandidate(a.ownerId,empty,"riyadh","UmmAlQura",new Date().toISOString(),randomUUID(),randomUUID());
 assert.ok(original);
 const state={...original,outbox:[...original.outbox,event(a.ownerId,tag)]};
 await observer.query("INSERT INTO public.noor_personal_foundations(user_id,schema_version,revision,state) VALUES($1,1,1,$2)",[a.ownerId,state]);
 await observer.query("INSERT INTO public.noor_work_teacher_states_r264(user_id,state) VALUES($1,$2)",[a.ownerId,{synthetic:true}]);
 return state;
}
try{
 fixture("r386-r385-catalog-fixture.sql");
 const target=await account(),other=await account(),operator=await account();
 const p=target.ownerId,q=other.ownerId;
 const targetState=await seed(target,"target"),otherState=await seed(other,"other");
 await observer.query("INSERT INTO public.noor_admin_accounts_r271(auth_user_id,account_id,role) VALUES($1,$2,'admin'),($3,$4,'super_admin')",[p,target.accountId,operator.ownerId,operator.accountId]);
 const audit=randomUUID();
 await observer.query("INSERT INTO public.noor_admin_audit_r271(id,actor_auth_user_id,target_auth_user_id,action,outcome,request_id,details) VALUES($1,$2,$3,'manage','success',$1,$4)",[audit,p,q,{accountId:target.accountId,keep:"other evidence"}]);
 const legacy=randomUUID(),now=Date.now();
 await observer.query("INSERT INTO public.noor_sessions(id,account_id,created_at_epoch_ms,expires_at_epoch_ms) VALUES($1,$2,$3,$4)",[legacy,other.accountId,now,now+3600000]);
 fixture("r386-release-transition-fixture.sql");
 assert.equal((await observer.query("SELECT revoked_at_epoch_ms,originating_auth_session_id FROM public.noor_sessions WHERE id=$1",[legacy])).rows[0].revoked_at_epoch_ms,null);
 assert.deepEqual((await observer.query("SELECT state FROM public.noor_personal_foundations WHERE user_id=$1",[q])).rows[0].state,otherState);
 const retained=(await observer.query("SELECT actor_auth_user_id,target_auth_user_id,actor_erased,target_erased FROM public.noor_admin_audit_r271 WHERE id=$1",[audit])).rows[0];
 assert.deepEqual(retained,{actor_auth_user_id:p,target_auth_user_id:q,actor_erased:false,target_erased:false});
 for(let i=0;;i++){const result=await admin.from("noor_sessions").select("originating_auth_session_id").limit(1);if(!result.error)break;if(i===20)response("cache",result);await delay(150)}
 const legacyAfter=randomUUID();
 response("legacy writer preserved",await admin.from("noor_sessions").insert({id:legacyAfter,account_id:other.accountId,created_at_epoch_ms:now,expires_at_epoch_ms:now+3600000,revoked_at_epoch_ms:null}));
 assert.equal((await observer.query("SELECT originating_auth_session_id FROM public.noor_sessions WHERE id=$1",[legacyAfter])).rows[0].originating_auth_session_id,null);
 assert.equal((await observer.query("SELECT "+cs+"g234_activate_bound_sessions() AS n")).rows[0].n,"2");
 assert.equal((await observer.query("SELECT count(*) AS n FROM public.noor_sessions WHERE originating_auth_session_id IS NULL AND revoked_at_epoch_ms IS NULL")).rows[0].n,"0");
 const denied=await admin.from("noor_sessions").insert({id:randomUUID(),account_id:other.accountId,created_at_epoch_ms:now,expires_at_epoch_ms:now+3600000,revoked_at_epoch_ms:null});
 assert.ok(denied.error);
 console.log("R386_RELEASE_EXISTING_SCHEMA_AND_SESSION_TRANSITION_PASS");
 writer=poolAs("noor_r386_g1_writer",writerPassword);eraser=poolAs("noor_r386_g1_eraser",eraserPassword);
 const adapter=createNoorR386G1SqlCommitAdapter({pool:writer,expectedSqlRole:"noor_r386_g1_writer"});
 host=createPrivilegedPlatformRuntimeHost(cfg,{captureOriginatingAuthSessionId:true});
 const operations=await host.start();
 const pa=await signIn(target),qa=await signIn(other),oa=await signIn(operator);
 const establish=async a=>(await operations.sessionEstablishment.execute({proof:a.proof})).id;
 const ps=await establish(pa),qs=await establish(qa),os=await establish(oa);
 assert.deepEqual(await operations.personalControl.resolveAuthorizedJournalUser(ps),{kind:"ok",userId:p});
 assert.deepEqual(await operations.personalControl.resolveAuthorizedJournalUser(qs),{kind:"ok",userId:q});
 const {id:factorId,totp:enrollment}=response("operator TOTP",await oa.client.auth.mfa.enroll({factorType:"totp"}));
 const {id:challengeId}=response("operator challenge",await oa.client.auth.mfa.challenge({factorId}));
 response("operator MFA",await oa.client.auth.mfa.verify({factorId,challengeId,code:totp(enrollment.secret)}));
 await host.shutdown();host=undefined;
 const qi={trustedNoorSessionId:qs,serverResolvedOwnerId:q},pi={trustedNoorSessionId:ps,serverResolvedOwnerId:p};
 const old=await adapter.loadOperational(qi);
 await observer.query("INSERT INTO "+cs+"g234_scope(owner_id) VALUES($1)",[q]);
 const copy=(await observer.query("SELECT copied,verified FROM "+cs+"s2_copy_batch($1,$2,0,500)",[q,old.revision])).rows[0];
 assert.equal(copy.verified,true);assert.equal(Number(copy.copied),old.state.outbox.length);
 await observer.query("INSERT INTO "+cs+"s3_enrollment(owner_id,shadow_enabled) VALUES($1,true)",[q]);
 const next={...old.state,outbox:[...old.state.outbox,event(q,"after-transition")]},fp="a".repeat(64);
 const commit=await adapter.commit({...qi,requestId:"release-transition",expectedExists:true,expectedRevision:old.revision,before:old.state,after:next,keyId:"fixture",digest:fp,fingerprints:{fixture:fp},deleteRefs:[]});
 assert.equal(commit.kind,"committed");
 const preserved=await adapter.load(qi);assert.deepEqual(preserved.state,next);
 await observer.query("SELECT "+cs+"s3_matches($1,$2::jsonb)",[q,JSON.stringify(next.outbox)]);
 console.log("R386_RELEASE_PREEXISTING_STATE_BACKFILL_AND_ATOMIC_COMMIT_PASS");
 // Simulate the out-of-band newer ledger while the quarantined restore still
 // contains the older target. No real archive or real account is imported.
 const {privateKey,publicKey}=generateKeyPairSync("ed25519"),publicPem=publicKey.export({type:"spki",format:"pem"});
 const body={version:1,lineage:"disposable-restore",generation:2,entries:[{ownerId:p,accountDigests:[hash(target.accountId)]}]};
 const envelope={body,signature:sign(null,Buffer.from(canonicalJson(body)),privateKey).toString("base64")};
 const head={lineage:body.lineage,generation:2,digest:hash(canonicalJson(body))};
 const args={databaseUrl:DB_URL,envelope,publicKey:publicPem,expectedHead:head};
 assert.throws(()=>verifyRecoveryLedger(envelope,publicPem,{...head,generation:1}),/R386_RECOVERY_LEDGER_HEAD_DENIED/u);
 await assert.rejects(quarantineRestoredOwners({...args,envelope:{...envelope,body:{...body,entries:[]}}}),/R386_RECOVERY_LEDGER_SIGNATURE_DENIED/u);
 assert.deepEqual(await quarantineRestoredOwners(args),{status:"quarantined",owners:1,releaseAllowed:false});
 assert.deepEqual(await quarantineRestoredOwners(args),{status:"quarantined",owners:1,releaseAllowed:false});
 await assert.rejects(adapter.loadOperational(pi),/R386_G1_COMMIT_UNAVAILABLE/u);
 assert.deepEqual(await adapter.load(qi),preserved);
 assert.ok((await observer.query("SELECT count(*) AS n FROM public.noor_personal_foundations WHERE user_id=$1",[p])).rows[0].n==="1");
 await assert.rejects(verifyRestoredDatabaseReconciliation(args),/R386_RECOVERY_ERASURE_EVIDENCE_PENDING/u);
 const coordinator=createR386G1PermanentErasureCoordinator(createRestrictedErasureBackend({pool:eraser,admin}));
 await assert.rejects(coordinator.erase({operatorSessionId:os,targetAuthUserId:p,requestId:randomUUID(),confirmation:"ERASE_NOOR_PERMANENTLY"}),/R386_G1_ERASURE_INCOMPLETE_RETRY_REQUIRED/u);
 assert.deepEqual(await verifyRestoredDatabaseReconciliation(args),{status:"database-reconciled",externalRetentionVerified:false,releaseAllowed:false});
 const redacted=(await observer.query("SELECT actor_auth_user_id,actor_erased,target_auth_user_id,details FROM public.noor_admin_audit_r271 WHERE id=$1",[audit])).rows[0];
 assert.deepEqual(redacted,{actor_auth_user_id:null,actor_erased:true,target_auth_user_id:q,details:{accountId:"[erased]",keep:"other evidence"}});
 assert.deepEqual(await adapter.load(qi),preserved);
 console.log("R386_RELEASE_SIGNED_RESTORE_QUARANTINE_AND_RECONCILIATION_PASS");
 console.log("R386_RELEASE_EXTERNAL_RETENTION_AND_FULL_ARCHIVE_PENDING");
}finally{if(host)await host.shutdown();if(writer)await writer.end();if(eraser)await eraser.end();await observer.end()}
