import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";
import {pathToFileURL} from "node:url";
const {prayerDayScoreR334,combinePrayerAchievementR334,prayerDueKeysFromContextR334,prayerScoreFromTrustedDayR334,projectPrayerAchievementPeriodR334,buildPersonalWorkspace,validPrayerScoreSnapshotR334}=await import(pathToFileURL(path.resolve(process.env.NOOR_PERSONAL_BUILD_DIR??"dist","index.js")).href);
// Synthetic coefficients only. These are deliberately not production defaults.
const snapshot={policyId:"fixture-v1",effectiveFromDate:"2026-11-15",weights:{fajr:101,dhuhr:102,asr:103,maghrib:104,isha:105},shares:{group:{ontime:1,late:.4},excused:{ontime:.9,late:.3},unexcused:{ontime:.6,late:.2}},legacyHabitKeys:{"old-fajr":"fajr","duplicate-fajr":"fajr","old-isha":"isha"}};
const base={date:"2026-11-15",currentDate:"2026-11-15",dueKeys:["fajr","dhuhr"],records:[],snapshot};
const record=(key,mode="group",timing="ontime")=>({key,mode,timing,recordedAt:"2026-11-15T10:00:00Z"});
test("R334 no activation, no trusted context, no retroactive scoring or future days",()=>{
 for(const patch of [{snapshot:null},{dueKeys:null},{date:"2026-11-14"},{date:"2026-11-16"},{date:"2026-02-30"}])assert.equal(prayerDayScoreR334({...base,...patch}),null);
 assert.equal(prayerDayScoreR334({...base,dueKeys:[]}).weight,0);
});
test("R334 due keys only; missed prayers stay in denominator; duplicate due keys never inflate it",()=>{
 const result=prayerDayScoreR334({...base,dueKeys:["fajr","fajr","dhuhr"],records:[record("fajr")]});
 assert.equal(result.weight,203);assert.equal(result.earnedWeight,101);
 assert.deepEqual(result.rows.map(x=>[x.key,x.recorded]),[["fajr",true],["dhuhr",false]]);
 assert.deepEqual(result.excludedHabitDefinitionIds,["old-fajr","duplicate-fajr","old-isha"]);
});
test("R334 all six mode/timing combinations use exactly the explicit frozen snapshot",()=>{
 for(const mode of ["group","excused","unexcused"])for(const timing of ["ontime","late"]){
  const result=prayerDayScoreR334({...base,dueKeys:["fajr"],records:[record("fajr",mode,timing)]});
  assert.equal(result.earnedWeight,101*snapshot.shares[mode][timing]);
 }
 const revised={...snapshot,weights:{...snapshot.weights,fajr:200}};
 assert.equal(prayerDayScoreR334({...base,snapshot:revised}).weight,302);
 assert.equal(prayerDayScoreR334(base).weight,203);
});
test("R334 fails closed on future prayer reports, duplicate reports, invalid weights and invalid credits",()=>{
 for(const records of [[record("isha")],[record("fajr"),record("fajr")],[record("fajr","unknown")]])assert.equal(prayerDayScoreR334({...base,records}),null);
 for(const value of [-1,NaN,Infinity,0])assert.equal(prayerDayScoreR334({...base,snapshot:{...snapshot,weights:{...snapshot.weights,fajr:value}}}),null);
 assert.equal(prayerDayScoreR334({...base,snapshot:{...snapshot,shares:{...snapshot.shares,group:{ontime:2,late:0}}}}),null);
});

test("R334 combined score preserves legacy frozen rows when disabled and replaces mapped habits exactly once when enabled",()=>{
 const rows=[{definitionId:"old-fajr",kind:"Habit",weight:25,credit:1},{definitionId:"duplicate-fajr",kind:"Habit",weight:25,credit:1},{definitionId:"old-isha",kind:"Habit",weight:25,credit:0},{definitionId:"reading",kind:"Task",weight:20,credit:.25},{definitionId:"walk",kind:"Habit",weight:10,credit:1}];
 const before=structuredClone(rows);
 assert.deepEqual(combinePrayerAchievementR334(rows,null),{weight:105,earnedWeight:65,rate:62});
 const prayer=prayerDayScoreR334({...base,records:[record("fajr")]});
 assert.deepEqual(combinePrayerAchievementR334(rows,prayer),{weight:233,earnedWeight:116,rate:50});
 assert.deepEqual(rows,before);
 assert.deepEqual(combinePrayerAchievementR334([],null),{weight:0,earnedWeight:0,rate:null});
 assert.equal(combinePrayerAchievementR334([{definitionId:"x",kind:"Task",weight:1,credit:2}],null),null);
});

const day={id:"day",userId:"u",boundary:{localDate:"2026-11-15",startAt:"2026-11-14T21:00:00Z",endAt:"2026-11-15T21:00:00Z"}};
const context={personalDayId:"day",prayerTimes:{localDate:"2026-11-15",fajr:"2026-11-15T02:00:00Z",dhuhr:"2026-11-15T09:00:00Z",asr:"2026-11-15T12:00:00Z",maghrib:"2026-11-15T14:00:00Z",isha:"2026-11-15T15:30:00Z"}};
test("R334 trusted day gates each prayer at its exact start and never manufactures missing historical context",()=>{
 const due=evaluatedAt=>prayerDueKeysFromContextR334({day,context,evaluatedAt});
 assert.deepEqual(due("2026-11-15T01:59:59Z"),[]);
 assert.deepEqual(due("2026-11-15T02:00:00Z"),["fajr"]);
 assert.deepEqual(due("2026-11-15T09:00:00Z"),["fajr","dhuhr"]);
 assert.deepEqual(due("2026-11-16T00:00:00Z"),["fajr","dhuhr","asr","maghrib","isha"]);
 const now="2026-11-15T10:00:00Z";
 for(const bad of [null,{...context,personalDayId:"other"},{...context,prayerTimes:{...context.prayerTimes,localDate:"2026-11-14"}},{...context,prayerTimes:{...context.prayerTimes,asr:"invalid"}},{...context,prayerTimes:{...context.prayerTimes,asr:context.prayerTimes.fajr}}])assert.equal(prayerDueKeysFromContextR334({day,context:bad,evaluatedAt:now}),null);
});
test("R334 trusted day scoring enforces owner scope and never counts a future report",()=>{
 const input={userId:"u",day:{...day,prayerRecordsR331:[record("fajr")]},context,currentDate:"2026-11-15",evaluatedAt:"2026-11-15T10:00:00Z",snapshot};
 assert.equal(prayerScoreFromTrustedDayR334(input).earnedWeight,101);
 assert.equal(prayerScoreFromTrustedDayR334({...input,userId:"other"}),null);
 assert.equal(prayerScoreFromTrustedDayR334({...input,snapshot:null}),null);
 assert.equal(prayerScoreFromTrustedDayR334({...input,evaluatedAt:"2026-11-15T07:00:00Z"}),null);
});

test("R334 period totals use frozen raw weights, preserve old days and exclude future days",()=>{
 const p=prayerDayScoreR334({...base,dueKeys:["fajr"],records:[record("fajr")]});
 const row=(definitionId,weight,credit)=>({definitionId,kind:"Habit",weight,credit});
 const days=[
  {date:"2026-11-14",ordinary:[row("old-fajr",25,1),row("old-other",75,0)],prayer:null},
  {date:"2026-11-15",ordinary:[row("old-fajr",25,0),row("walk",1,0)],prayer:p},
  {date:"2026-11-16",ordinary:[row("future",1000,1)],prayer:null}
 ];
 const args={startDate:"2026-11-14",endDate:"2026-11-20",currentDate:"2026-11-15",days};
 const result=projectPrayerAchievementPeriodR334(args);
 assert.deepEqual(result.days.map(d=>[d.date,d.weight,d.earnedWeight,d.prayerApplied]),[["2026-11-14",100,25,false],["2026-11-15",102,101,true]]);
 assert.equal(result.weight,202);assert.equal(result.earnedWeight,126);assert.equal(result.rate,62);
 assert.equal(projectPrayerAchievementPeriodR334({...args,days:[...days,days[0]]}),null);
 assert.equal(projectPrayerAchievementPeriodR334({...args,days:[]}).rate,null);
});
test("R334 rejects a timestamp recorded before its trusted prayer start",()=>{
 const input={userId:"u",day:{...day,prayerRecordsR331:[{...record("fajr"),recordedAt:"2026-11-15T01:59:59Z"}]},context,currentDate:"2026-11-15",evaluatedAt:"2026-11-15T10:00:00Z",snapshot};
 assert.equal(prayerScoreFromTrustedDayR334(input),null);
});

test("R334 workspace emits trusted owner-specific prayer projection only for an explicitly frozen day",()=>{
 const personalDay={...day,boundary:{...day.boundary,key:"personal-day-civil:u:2026-11-15"},state:"Open",createdAt:day.boundary.startAt,prayerScoreSnapshotR334:snapshot,prayerRecordsR331:[record("fajr")]};
 const make=(personalDays,contexts)=>({listDefinitions:()=>[],listPersonalDays:()=>personalDays,listDailyExecutionForUser:()=>[],listDailyIslamicContexts:()=>contexts});
 const now="2026-11-15T10:00:00Z";
 const view=buildPersonalWorkspace("u",make([personalDay],[context]),now);
 assert.equal(view.prayerAchievementR334.length,1);
 assert.equal(view.prayerAchievementR334[0].score.weight,203);
 assert.equal(view.prayerAchievementR334[0].score.earnedWeight,101);
 assert.deepEqual(view.statistics.rows,[]);
 for(const bad of [make([{...personalDay,prayerScoreSnapshotR334:undefined}],[context]),make([personalDay],[]),make([personalDay],[context,context]),make([{...personalDay,userId:"other"}],[context]),make([{...personalDay,prayerScoreSnapshotR334:{}}],[context])])assert.equal(buildPersonalWorkspace("u",bad,now).prayerAchievementR334,undefined);
 assert.equal(buildPersonalWorkspace("u",make([personalDay],[context])).prayerAchievementR334,undefined);
 assert.equal(validPrayerScoreSnapshotR334({policyId:"bad",effectiveFromDate:"2026-11-15"}),false);
});
