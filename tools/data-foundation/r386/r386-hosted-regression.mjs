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
import {createR386HostedComposition} from "./r386-hosted-composition.mjs";
const {API_URL,DB_URL,ANON_KEY,SERVICE_ROLE_KEY}=JSON.parse(readFileSync(process.argv[2],"utf8"));
const api=new URL(API_URL),db=new URL(DB_URL);
assert.equal(api.protocol,"https:");assert.equal(api.hostname,"127.0.0.1");assert.equal(db.protocol,"postgresql:");assert.equal(db.hostname,"127.0.0.1");
const issuer=api.origin+"/auth/v1",opts={auth:{autoRefreshToken:false,persistSession:false,detectSessionInUrl:false}};
const admin=createClient(api.origin,SERVICE_ROLE_KEY,opts);
const observer=new Pool({connectionString:DB_URL,max:2});
const writerPassword=randomUUID(),schedulerPassword=randomUUID(),eraserPassword=randomUUID();
const cfg={supabaseUrl:api.origin,supabaseServiceRoleKey:SERVICE_ROLE_KEY,expectedIssuer:issuer,expectedAudience:"authenticated",expectedAlgorithm:"ES256",sessionLifetimeMs:3600_000};
const cs="noor_r386_candidate.";
let writer,eraser,host,composition;
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
 const selected=await account(),legacyOwner=await account();
 const p=selected.ownerId,q=legacyOwner.ownerId;
 await seed(selected,"cohort");await seed(legacyOwner,"legacy");
 const now=Date.now(),legacy=randomUUID();
 await observer.query("INSERT INTO public.noor_sessions(id,account_id,created_at_epoch_ms,expires_at_epoch_ms) VALUES($1,$2,$3,$4)",[legacy,legacyOwner.accountId,now,now+3600000]);
 fixture("r386-hosted-install-candidate.sql");
 assert.equal((await observer.query("SELECT to_regnamespace('noor_r386_lab') IS NULL AS ok")).rows[0].ok,true);
 assert.equal((await observer.query("SELECT to_regrole('noor_r386_g1_eraser') IS NULL AS ok")).rows[0].ok,true);
 const url=(role,password)=>{const u=new URL(DB_URL);u.username=role;u.password=password;return u.href};
 const env={NOOR_R386_RUNTIME:"enabled",NOOR_R386_WRITER_DATABASE_URL:url("noor_r386_g1_writer",writerPassword),NOOR_R386_SCHEDULER_DATABASE_URL:url("noor_r386_g234_scheduler",schedulerPassword),NOOR_R386_RECEIPT_KEYS:JSON.stringify({fixture:"ab".repeat(32)}),NOOR_R386_ACTIVE_RECEIPT_KEY_ID:"fixture"};
 assert.equal(await createR386HostedComposition({}),undefined);
 await assert.rejects(createR386HostedComposition(env,{local:true}),/R386_HOSTED_STARTUP_DENIED/u);
 await observer.query("SELECT "+cs+"g234_activate_bound_sessions()");
 for(let i=0;;i++){const result=await admin.from("noor_sessions").select("originating_auth_session_id").limit(1);if(!result.error)break;if(i===20)response("cache",result);await delay(150)}
 composition=await createR386HostedComposition(env,{local:true});
 host=createPrivilegedPlatformRuntimeHost(cfg,composition.options);
 const operations=await host.start();
 const establish=async a=>(await operations.sessionEstablishment.execute({proof:(await signIn(a)).proof})).id;
 const ps=await establish(selected),qs=await establish(legacyOwner);
 const cmd=(sessionId,title)=>operations.personalControl.executeCommand({sessionId,requestId:"client-"+randomUUID(),command:{type:"create-definition",requestId:randomUUID(),kind:"Habit",title,category:"الصحة والرياضة",startDate:new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Riyadh",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date()),endDate:null,scheduleKind:"Daily",weekdays:[],importance:"Supporting",weight:7}});
 const checkLegacy=async()=>{const result=await operations.personalControl.readWorkspace({sessionId:qs});assert.equal(result.status,200);return result.body};
 assert.equal((await operations.personalToday.execute({sessionId:qs})).status,200);
 assert.ok([200,204].includes((await cmd(qs,"Legacy before")).status));
 assert.ok((await checkLegacy()).definitions.some(d=>d.title==="Legacy before"));
 assert.equal(await composition.options.atomicSaveCandidate.useForOwner({trustedNoorSessionId:ps,ownerId:p}),false);
 await observer.query("INSERT INTO "+cs+"g234_scope(owner_id) VALUES($1)",[p]);
 let revision=(await observer.query("SELECT revision FROM public.noor_personal_foundations WHERE user_id=$1",[p])).rows[0].revision;
 await assert.rejects(observer.query("SELECT "+cs+"g234_enroll_verified($1,$2)",[p,revision]),/R386_COHORT_BACKFILL_REQUIRED/u);
 const cp=(await observer.query("SELECT copied,verified FROM "+cs+"s2_copy_batch($1,$2,0,500)",[p,revision])).rows[0];assert.equal(cp.verified,true);
 assert.equal((await observer.query("SELECT "+cs+"g234_enroll_verified($1,$2) AS ok",[p,revision])).rows[0].ok,true);
 assert.equal(await composition.options.atomicSaveCandidate.useForOwner({trustedNoorSessionId:ps,ownerId:p}),true);
 assert.equal(await composition.options.schedulerSaveCandidate.useForOwner(p),true);
 assert.equal(await composition.options.schedulerSaveCandidate.useForOwner(q),false);
 assert.equal((await operations.personalToday.execute({sessionId:ps})).status,200);
 assert.equal((await cmd(ps,"Atomic selected")).status,204);
 assert.ok([200,204].includes((await cmd(qs,"Legacy after")).status));
 const active=await operations.personalControl.readWorkspace({sessionId:ps});
 assert.equal(active.status,200);assert.ok(active.body.definitions.some(d=>d.title==="Atomic selected"));
 assert.ok((await checkLegacy()).definitions.some(d=>d.title==="Legacy after"));
 const persisted=(await observer.query("SELECT state FROM public.noor_personal_foundations WHERE user_id=$1",[p])).rows[0].state;
 await observer.query("SELECT "+cs+"s3_matches($1,$2::jsonb)",[p,JSON.stringify(persisted.outbox)]);
 assert.equal((await observer.query("SELECT count(*) AS n FROM "+cs+"command_receipt WHERE owner_id=$1",[q])).rows[0].n,"0");
 await assert.rejects(observer.query("UPDATE public.noor_personal_foundations SET state=state WHERE user_id=$1",[p]),/R386_G234_NONATOMIC_SOURCE_DENIED/u);
 await assert.rejects(createR386HostedComposition({...env,NOOR_R386_RECEIPT_KEYS:JSON.stringify({other:"cd".repeat(32)}),NOOR_R386_ACTIVE_RECEIPT_KEY_ID:"other"},{local:true}),/R386_HOSTED_STARTUP_DENIED/u);
 await assert.rejects(composition.options.atomicSaveCandidate.useForOwner({trustedNoorSessionId:ps,ownerId:q}));
 console.log("R386_HOSTED_MIXED_COHORT_AND_KEY_COVERAGE_PASS");
}finally{if(host)await host.shutdown();if(composition)await composition.close();if(writer)await writer.end();if(eraser)await eraser.end();await observer.end()}
