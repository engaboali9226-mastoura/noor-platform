import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import {pathToFileURL} from "node:url";
const {prayerDayScoreR334,parsePrayerScoreApprovalR334,issuePrayerScoreSnapshotR334,validPrayerScoreSnapshotR334,APPROVED_PRAYER_SHARES_R288,prayerCaseR288}=await import(pathToFileURL(path.resolve(process.env.NOOR_PERSONAL_BUILD_DIR??"dist","domain/completion-r331.js")).href);
const {taskSessionRecoveryDueR288,sessionAchievementOnDate}=await import(pathToFileURL(path.resolve(process.env.NOOR_PERSONAL_BUILD_DIR??"dist","domain/task-sessions.js")).href);
const approval={type:"configure-prayer-score-r334",expectedPolicyId:null,baseWeight:25,shares:APPROVED_PRAYER_SHARES_R288,sevenCasesR288:true,mappings:[],confirm:true};
const issue=(a=approval)=>issuePrayerScoreSnapshotR334({policyId:"new",effectiveFromDate:"2026-11-29",approval:a,definitions:[],userId:"u"});
const cases=[["group","ontime",undefined,1],["excused","ontime",undefined,1],["unexcused","ontime",undefined,.75],["group","late","excused",1],["group","late","unexcused",.5],["excused","late",undefined,1],["unexcused","late",undefined,.25]];
const oldShares={group:{ontime:1,late:.4},excused:{ontime:.9,late:.3},unexcused:{ontime:.6,late:.2}};
const base={date:"2026-11-29",currentDate:"2026-11-29",dueKeys:["fajr"]};
const record=(mode,timing,excuse)=>({key:"fajr",mode,timing,recordedAt:"2026-11-29T10:00:00Z",...(excuse?{lateGroupExcuse:excuse}:{})});
test("R288 approved seven-case weights and immutable legacy policy",()=>{
 assert.ok(parsePrayerScoreApprovalR334(approval));const s=issue();assert.ok(s&&validPrayerScoreSnapshotR334(s));assert.equal(s.sevenCasesR288,true);
 for(const [mode,timing,excuse,credit] of cases){const r=record(mode,timing,excuse);assert.equal(prayerDayScoreR334({...base,snapshot:s,records:[r]}).earnedWeight,25*credit);assert.notEqual(prayerCaseR288(r),"group-late-unspecified");}
 assert.equal(prayerDayScoreR334({...base,snapshot:s,records:[]}).earnedWeight,0);
 const {sevenCasesR288,...legacy}=s;legacy.shares=oldShares;
 assert.equal(prayerDayScoreR334({...base,snapshot:legacy,records:[record("group","late","excused")]}).earnedWeight,10);
 assert.equal(prayerCaseR288(record("group","late")),"group-late-unspecified");
 assert.equal(parsePrayerScoreApprovalR334({...approval,shares:oldShares}),null);
 assert.equal(validPrayerScoreSnapshotR334({...s,sevenCasesR288:false}),false);
 assert.equal(prayerDayScoreR334({...base,date:"2026-11-28",snapshot:s,records:[]}),null);
});
test("R288 undated one-time sessions are recoverable only against the real due occurrence",()=>{
 assert.equal(taskSessionRecoveryDueR288(undefined,"2026-11-28","2026-11-28"),true);
 assert.equal(taskSessionRecoveryDueR288(null,null,"2026-11-28"),false);
 assert.equal(taskSessionRecoveryDueR288("2026-11-29","2026-11-28","2026-11-28"),false);
 assert.equal(taskSessionRecoveryDueR288("2026-11-28",null,"2026-11-28"),true);
});
