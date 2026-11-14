import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";
import {pathToFileURL} from "node:url";
const {recoveryCreditR331,completedShareR331,parsePersonalCommand,PersonalCommandService,InMemoryFoundationStore,SequenceIdGenerator,buildPersonalWorkspace}=await import(pathToFileURL(path.resolve(process.env.NOOR_PERSONAL_BUILD_DIR??"dist","index.js")).href);
test("R331 deterministic decaying credit, date boundaries and old completion preservation",()=>{
 assert.equal(recoveryCreditR331("2026-11-13","2026-11-13"),1);
 assert.equal(recoveryCreditR331("2026-11-13","2026-11-14"),.5);
 assert.equal(recoveryCreditR331("2026-11-12","2026-11-14"),.25);
 assert.equal(recoveryCreditR331("2026-10-31","2026-11-03"),.125);
 assert.equal(recoveryCreditR331("2026-02-30","2026-03-02"),0);
 assert.equal(completedShareR331({status:"Completed",scheduleOccurrenceKey:"2026-11-12"}),1);
 assert.equal(completedShareR331({status:"Completed",scheduleOccurrenceKey:"2026-11-12",recoveredOnR331:"2026-11-14"}),.25);
 assert.equal(completedShareR331({status:"Missed",scheduleOccurrenceKey:"2026-11-12",recoveredOnR331:"2026-11-14"}),0);
});
test("R331 exact command validation rejects forged score and unsupported prayer choices",()=>{
 const c={type:"recover-historical-execution",executionId:"exec",localDate:"2026-11-13",expectedStatus:"Missed"};
 assert.ok(parsePersonalCommand(c));assert.equal(parsePersonalCommand({...c,credit:1}),null);
 assert.equal(parsePersonalCommand({...c,expectedStatus:"Completed"}),null);
 const p={type:"record-prayer-r331",localDate:"2026-11-14",key:"fajr",mode:"group",timing:"ontime",expectedRecordedAt:null};
 assert.ok(parsePersonalCommand(p));assert.equal(parsePersonalCommand({...p,key:"sunrise"}),null);
 assert.equal(parsePersonalCommand({...p,mode:"group",timing:null}),null);
});
test("R331 recovery persists once with server date, applies decayed score to workspace, and rejects cross-account use",async()=>{
 const now="2026-11-14T12:00:00.000Z",due="2026-11-12";
 const def={id:"d",userId:"u",kind:"Habit",revisionId:"r",title:"المشي",category:"الصحة",state:"Active",schedule:{kind:"Daily"},effectiveFromDate:"2026-11-01",importance:"Essential",weight:8,gatePolicy:"NonBlocking",targets:{}};
 const e={id:"exec",userId:"u",personalDayId:"past",definitionId:"d",definitionRevisionId:"r",kind:"Habit",title:def.title,materializationKey:"key",scheduleOccurrenceKey:due,status:"Missed",eligibility:{definitionRevisionId:"r",importance:"Essential",weight:8,gatePolicy:"NonBlocking",targets:{}},version:1,createdAt:now,updatedAt:now};
 const day={id:"today",userId:"u",boundary:{key:"today",localDate:"2026-11-14",startAt:"2026-11-13T21:00:00.000Z",endAt:"2026-11-14T21:00:00.000Z",timeZone:"Asia/Riyadh"},state:"Open",version:1,createdAt:now,updatedAt:now};
 const store=new InMemoryFoundationStore({personalDays:[day],definitions:[def],dailyExecution:[e]});
 const service=new PersonalCommandService({clock:{now:()=>now},idGenerator:new SequenceIdGenerator(),transaction:store,accountTimeZone:"Asia/Riyadh"});
 const c={type:"recover-historical-execution",executionId:e.id,localDate:due,expectedStatus:"Missed"};
 await assert.rejects(()=>service.execute("other",c));await service.execute("u",c);const first=store.snapshot().dailyExecution[0];assert.equal(first.recoveredOnR331,"2026-11-14");assert.equal(first.eligibility.weight,8);assert.equal(first.status,"Completed");
 await service.execute("u",c);assert.deepEqual(store.snapshot().dailyExecution[0],first);
 const w=buildPersonalWorkspace("u",{listDefinitions:()=>[def],listPersonalDays:()=>[day],listDailyExecutionForUser:()=>[first]});
 assert.equal(w.statistics.rows[0].credit,.25);assert.equal(w.insights.periods.week.completionRate,25);
 await service.execute("u",{type:"correct-historical-execution",executionId:e.id,localDate:due,expectedStatus:"Completed",completed:false});
 assert.equal(store.snapshot().dailyExecution[0].recoveredOnR331,undefined);
});

test("R331 prayer reporting is day scoped, not allowed before the prayer, and survives durable storage reload",async()=>{
 const {SupabasePostgresPersonalFoundationPersistence}=await import(pathToFileURL(path.resolve(process.env.NOOR_PERSONAL_BUILD_DIR??"dist","index.js")).href);
 let now="2026-11-14T12:00:00.000Z";
 const day={id:"day",userId:"u",boundary:{key:"day-key",localDate:"2026-11-14",startAt:"2026-11-13T21:00:00.000Z",endAt:"2026-11-14T21:00:00.000Z",timeZone:"Asia/Riyadh"},state:"Open",version:1,createdAt:now,updatedAt:now};
 const context={id:"ctx",key:"context-key",personalDayId:day.id,prayerTimes:{fajr:"2026-11-14T02:00:00.000Z",dhuhr:"2026-11-14T09:00:00.000Z",asr:"2026-11-14T12:30:00.000Z",maghrib:"2026-11-14T14:15:00.000Z",isha:"2026-11-14T15:45:00.000Z"}};
 let row={user_id:"u",schema_version:1,revision:1,state:{locations:[],prayerPolicies:[],personalDays:[day],islamicContexts:[context],definitions:[],dailyExecution:[],outbox:[]}};
 const client={from(){return {select(){return {eq(){return {limit:async()=>({data:[structuredClone(row)],error:null})}}}},update(value){const filters={};const q={eq(k,v){filters[k]=v;return q;},async select(){if(filters.user_id!==row.user_id||filters.revision!==row.revision)return {data:[],error:null};row={...row,...structuredClone(value)};return {data:[{revision:row.revision}],error:null};}};return q;}}}};
 const open=async()=>{const a=new SupabasePostgresPersonalFoundationPersistence(client);await a.initialize();const scope=await a.openOperation("u");return {scope,service:new PersonalCommandService({clock:{now:()=>now},idGenerator:new SequenceIdGenerator(),transaction:scope.transaction,accountTimeZone:"Asia/Riyadh"})};};
 const p={type:"record-prayer-r331",localDate:"2026-11-14",key:"fajr",mode:"group",timing:"ontime",expectedRecordedAt:null};
 let a=await open();await assert.rejects(()=>a.service.execute("other",p));a=await open();await assert.rejects(()=>a.service.execute("u",{...p,key:"isha"}));a=await open();await assert.rejects(()=>a.service.execute("u",{...p,localDate:"2026-11-13"}));a=await open();
 await a.service.execute("u",p);a=await open();
 let w=buildPersonalWorkspace("u",a.scope.snapshot);assert.deepEqual(w.prayerHistoryR331,[{date:p.localDate,records:[{key:"fajr",mode:"group",timing:"ontime",recordedAt:now}]}]);assert.deepEqual(w.statistics.rows,[]);
 await assert.rejects(()=>a.service.execute("u",{...p,mode:"excused"}));a=await open();
 const previous=now;now="2026-11-14T12:05:00.000Z";
 await a.service.execute("u",{...p,mode:"excused",timing:"late",expectedRecordedAt:previous});
 a=await open();w=buildPersonalWorkspace("u",a.scope.snapshot);assert.equal(w.prayerHistoryR331[0].records[0].mode,"excused");
 await a.service.execute("u",{...p,mode:null,timing:null,expectedRecordedAt:now});
 a=await open();assert.deepEqual(buildPersonalWorkspace("u",a.scope.snapshot).prayerHistoryR331,[]);
});
