import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";
import {pathToFileURL} from "node:url";
const {prayerDayScoreR334}=await import(pathToFileURL(path.resolve(process.env.NOOR_PERSONAL_BUILD_DIR??"dist","index.js")).href);
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
