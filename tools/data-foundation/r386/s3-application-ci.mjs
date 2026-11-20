// Real browser transport helper, HTTP handler, PersonalControlOperation,
// production transaction evaluator, scheduler and PostgreSQL on a disposable
// CI database. Session/entitlement resolver ports are existing-style test
// doubles only: this creates no actual linked Auth/RPC identities.
import assert from "node:assert/strict";
import {createS3CiPostgres} from "./s3-ci-postgres.mjs";
import {createR386RuntimeSaveCandidate,openR386CandidateReadScope} from "./s3-runtime-coordinator.mjs";
import {PersonalControlOperation} from "../../../apps/noor-runtime/dist/personal-control-operation.js";
import {PersonalDailyMaterializationScheduler} from "../../../apps/noor-runtime/dist/personal-daily-materialization-scheduler.js";
import {createRouteAccessHttpServer,PERSONAL_COMMAND_HTTP_PATH,PERSONAL_WORKSPACE_HTTP_PATH} from "../../../apps/noor-runtime/dist/route-access-http-server.js";
import {CryptographicIdGenerator} from "../../../apps/noor-personal/dist/index.js";
import {prepareR386NoorPersonalCommand} from "../../../apps/web/src/noor-personal-today-client.ts";
const {database,psql,literal}=createS3CiPostgres(process.argv[2]);
const a="synthetic-r386-s3-app-a",b="synthetic-r386-s3-app-b";
let now="2026-11-20T12:00:00.000Z";
const clock={now:()=>now};
const idGenerator=new CryptographicIdGenerator();
const atomicSaveCandidate=createR386RuntimeSaveCandidate({database,keys:new Map([["ci-key",Buffer.alloc(32,91)]]),activeKeyId:"ci-key",clock});
const foundation={
 openOperation:owner=>openR386CandidateReadScope(database,owner),
 listKnownUserIds:async()=>[a],
};
const operation=new PersonalControlOperation({
 isRuntimeRunning:()=>true,
 resolveSession:{async execute({sessionId}){if(!["fixture-a","fixture-b"].includes(sessionId))throw Error("INVALID_FIXTURE");return{accountId:sessionId};}},
 authorize:{async execute({accountId,action,resourceType,resourceId}){assert.ok(["fixture-a","fixture-b"].includes(accountId));assert.equal(action,"access");assert.equal(resourceType,"application");assert.equal(resourceId,"noor-personal");}},
 accountUserResolver:{async resolve(accountId){return{toString:()=>accountId==="fixture-a"?a:b};}},
 foundation,clock,idGenerator,atomicSaveCandidate,
});
const routeExecutor={async execute(){return{kind:"authentication-required",appKey:"noor-personal",pathname:"/personal"};}};
const server=createRouteAccessHttpServer(routeExecutor,{personalControl:operation});
const scheduler=new PersonalDailyMaterializationScheduler({foundation,clock,idGenerator,atomicSaveCandidate});
await psql("INSERT INTO noor_r386_candidate.s3_enrollment(owner_id,shadow_enabled) VALUES ("+literal(a)+",true),("+literal(b)+",true)");
await server.listen({host:"127.0.0.1",port:0});
const address=server.address();
assert.ok(address&&typeof address!=="string");
const origin="http://127.0.0.1:"+address.port;
const seen=[];
function transport(session,loseFirst=false){
 let lost=false;
 return async(path,init)=>{
  const headers=new Headers(init.headers);
  if(session)headers.set("Cookie","noor_session="+session);
  seen.push([session,headers.get("X-Noor-Request-Id"),init.body]);
  const response=await fetch(origin+path,{...init,headers});
  if(loseFirst&&!lost){lost=true;assert.equal(response.status,204);await response.arrayBuffer();throw Error("SYNTHETIC_HTTP_ACK_LOST");}
  return response;
 };
}
const sendRaw=(session,requestId,command)=>{
 const headers={"Content-Type":"application/json"};
 if(session)headers.Cookie="noor_session="+session;
 if(requestId)headers["X-Noor-Request-Id"]=requestId;
 return fetch(origin+PERSONAL_COMMAND_HTTP_PATH,{method:"POST",headers,body:JSON.stringify(command)});
};
try{
 const initial={type:"initialize-personal-profile-r321",city:"riyadh",calculationMethod:"UmmAlQura"};
 const prepared=prepareR386NoorPersonalCommand(initial,transport("fixture-a",true));
 assert.equal((await prepared.send()).kind,"unavailable");
 assert.equal((await prepared.send()).kind,"success");
 assert.deepEqual(seen[0],seen[1]);
 const first=await database.load(a);
 assert.equal(first.revision,1);
 assert.equal(first.state.locations[0].userId,a);
 assert.equal(first.state.locations[0].timeZone,"Asia/Riyadh");
 assert.equal(first.state.prayerPolicies[0].calculationMethod,"UmmAlQura");
 assert.equal((await database.lookup(a,prepared.requestId)).revision,1);
 assert.equal((await sendRaw("fixture-a",prepared.requestId,{...initial,city:"cairo"})).status,409);
 assert.equal((await prepareR386NoorPersonalCommand(initial,transport("fixture-a")).send()).kind,"conflict");
 assert.equal((await sendRaw("fixture-a",null,initial)).status,400);
 assert.equal((await sendRaw(null,prepared.requestId,initial)).status,401);
 // Same ID / same logical command, a distinct trusted owner.
 assert.equal((await sendRaw("fixture-b",prepared.requestId,initial)).status,204);
 assert.equal((await database.load(b)).state.locations[0].userId,b);
 console.log("R386_S3_REAL_HTTP_INITIALIZATION_AND_STABLE_ACK_PASS");

 await scheduler.tick();
 const createdDay=await database.load(a);
 assert.equal(createdDay.state.personalDays.length,1);
 assert.ok(createdDay.state.outbox.length>0);
 assert.ok(await database.lookup(a,"scheduler-202611201200"));
 const schedulerRevision=createdDay.revision;
 await scheduler.tick();
 assert.equal((await database.load(a)).revision,schedulerRevision);
 console.log("R386_S3_REAL_SCHEDULER_ATOMIC_PASS");

 const create={type:"create-definition",requestId:"11111111-1111-4111-8111-111111111111",kind:"Habit",title:"Synthetic habit",category:"الصحة والرياضة",startDate:"2026-11-20",endDate:null,scheduleKind:"Daily",weekdays:[],importance:"Supporting"};
 assert.equal((await prepareR386NoorPersonalCommand(create,transport("fixture-a")).send()).kind,"success");
 const defined=await database.load(a);
 assert.equal(defined.state.definitions.length,1);
 const definitionId=defined.state.definitions[0].id;
 const noop=prepareR386NoorPersonalCommand(create,transport("fixture-a"));
 assert.equal((await noop.send()).kind,"success");
 assert.equal((await database.load(a)).revision,defined.revision);
 assert.equal((await database.lookup(a,noop.requestId)).revision,defined.revision);
 console.log("R386_S3_REAL_COMMAND_AND_NOOP_PASS");

 now="2026-11-21T12:00:00.000Z";
 await scheduler.tick();
 const materialized=await database.load(a);
 assert.ok(materialized.state.dailyExecution.some(row=>row.definitionId===definitionId));
 const beforeErase=materialized.state.outbox.length;
 assert.equal((await prepareR386NoorPersonalCommand({type:"delete-definition",definitionId,confirm:true},transport("fixture-a")).send()).kind,"success");
 const deleted=await database.load(a);
 assert.ok(!deleted.state.definitions.some(row=>row.id===definitionId));
 assert.ok(!deleted.state.dailyExecution.some(row=>row.definitionId===definitionId));
 assert.ok(deleted.state.outbox.length<beforeErase);
 assert.ok(deleted.state.outbox.length>0);
 assert.ok(!deleted.state.outbox.some(event=>event.payload.definitionId===definitionId));
 assert.equal((await database.load(b)).revision,1);
 await psql("SELECT noor_r386_candidate.s3_matches("+literal(a)+",(SELECT state->'outbox' FROM noor_r386_lab.synthetic_source WHERE owner_id="+literal(a)+"))");
 console.log("R386_S3_REAL_DEFINITION_ERASURE_PASS");
 const workspace=await fetch(origin+PERSONAL_WORKSPACE_HTTP_PATH,{method:"POST",headers:{"Content-Type":"application/json",Cookie:"noor_session=fixture-a"},body:"{}"});
 assert.equal(workspace.status,200);
 assert.ok(!(await workspace.json()).definitions.some(row=>row.id===definitionId));
 console.log("R386_S3_FRESH_AUTHORITATIVE_WORKSPACE_PASS");
}finally{
 await scheduler.stop();
 await server.close();
 await psql("SELECT noor_r386_candidate.s3_erase_owner("+literal(a)+"); SELECT noor_r386_candidate.s3_erase_owner("+literal(b)+")");
}
