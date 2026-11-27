import assert from "node:assert/strict";
import test from "node:test";
import {withNoorDeadline} from "../src/noor-transport-deadline.js";
test("N2 deadline resolves a stalled attempt and aborts its signal",async()=>{
 let signal:AbortSignal|undefined;
 const v=await withNoorDeadline(5,async s=>{signal=s;return new Promise<string>(()=>{});},()=>"uncertain");
 assert.equal(v,"uncertain");assert.equal(signal?.aborted,true);
});
test("N2 deadline does not override timely acknowledgement",async()=>{
 let signal:AbortSignal|undefined;
 assert.equal(await withNoorDeadline(100,async s=>{signal=s;return "ack";},()=>"uncertain"),"ack");
 assert.equal(signal?.aborted,false);
});
test("N2 deadline cannot settle twice after a late response",async()=>{
 let finish!:(v:string)=>void;
 const p=withNoorDeadline(5,()=>new Promise<string>(r=>{finish=r;}),()=>"uncertain");
 assert.equal(await p,"uncertain");finish("late ack");assert.equal(await p,"uncertain");
});
