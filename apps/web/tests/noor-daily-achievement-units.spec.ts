import assert from "node:assert/strict";
import test from "node:test";
import {countDailyAchievementUnits as count} from "../src/noor-daily-achievement-units.js";
const day="2026-11-27",old="2026-11-26",next="2026-11-28";
const stamp=day+"T12:00:00Z";
const task={kind:"Task",status:"InProgress"};
const habit={kind:"Habit",status:"Pending"};
const session=(id:string,scheduledDate:string|null=day,target:number|null=null,completedAt:string|null=null)=>({id,scheduledDate,target,completedAt});
const entry=(id:string,amount=0,localDate=day,at=stamp)=>({taskSessionId:id,amount,localDate,at});
test("N6: ordinary items preserve existing count; non-actionable statuses excluded",()=>{
 assert.deepEqual(count(habit,null,[],day),{scheduled:1,completed:0});
 assert.deepEqual(count({...task,status:"Completed"},null,[],day),{scheduled:1,completed:1});
 for(const status of ["Cancelled","Suppressed"])assert.deepEqual(count({...task,status},{sessions:[session("a")]},[],day),{scheduled:0,completed:0});
});
test("N6: one completed session reduces remaining 13 to 12 without parent completion",()=>{
 const before=count(task,{sessions:[session("a")]},[],day);
 const after=count(task,{sessions:[session("a",day,null,stamp)]},[entry("a")],day);
 assert.equal(12+before.scheduled-before.completed,13);
 assert.equal(12+after.scheduled-after.completed,12);
 assert.deepEqual(count(task,{sessions:[session("a")]},[],day),before);
});
test("N6: multiple due sessions replace parent, future and old scheduled sessions excluded",()=>{
 const plan={sessions:[session("a",day,null,stamp),session("b",day,5),session("c",next),session("d",old)]};
 assert.deepEqual(count(task,plan,[entry("a"),entry("b",2)],day),{scheduled:2,completed:1});
 assert.deepEqual(count({...task,status:"Completed"},plan,[entry("a"),entry("b",5)],day),{scheduled:2,completed:2});
});
test("N6: future event cannot complete historical unit; recovered entry is tied to due civil day",()=>{
 const plan={sessions:[session("a",old,null,stamp)]};
 assert.deepEqual(count(task,plan,[entry("a",0,day)],old),{scheduled:1,completed:0});
 assert.deepEqual(count(task,plan,[entry("a",0,old)],old),{scheduled:1,completed:1});
});
test("N6: undated session due rule and per-session isolation",()=>{
 const plan={sessions:[session("a",null,3,stamp),session("b",null,4),session("c",null,null,old+"T12:00:00Z")]};
 assert.deepEqual(count(task,plan,[entry("a",3),entry("b",1),entry("c",0,old,old+"T12:00:00Z")],day),{scheduled:2,completed:1});
});
test("N6: measured session uses same six-decimal rounding and no fractional unit completion",()=>{
 const plan={sessions:[session("a",day,0.3)]};
 assert.deepEqual(count(task,plan,[entry("a",0.1)],day),{scheduled:1,completed:0});
 assert.deepEqual(count(task,plan,[entry("a",0.1),entry("a",0.2)],day),{scheduled:1,completed:1});
});
