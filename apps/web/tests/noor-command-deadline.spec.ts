import assert from "node:assert/strict";
import test from "node:test";
import {fetchNoorPersonalToday,fetchNoorPersonalWorkspace,sendR386CommandIntent,type R386CommandIntent} from "../src/noor-personal-today-client.js";
const intent:R386CommandIntent={requestId:"client-deadline-fixture",requiresAtomic:true,body:JSON.stringify({type:"set-execution-completed",executionId:"test",completed:true})};
test("N2 atomic timeout is uncertain, explicit retry keeps identical receipt identity",async()=>{
 const attempts:RequestInit[]=[];let finish!:(r:Response)=>void;
 const fetcher:typeof fetch=async(_,init)=>{attempts.push(init!);return attempts.length===1?new Promise<Response>(r=>{finish=r;}):new Response(null,{status:204});};
 assert.deepEqual(await sendR386CommandIntent(intent,fetcher,5),{kind:"unavailable"});
 assert.equal(attempts[0]?.signal?.aborted,true);assert.equal(attempts.length,1);
 assert.deepEqual(await sendR386CommandIntent(intent,fetcher,100),{kind:"success"});
 assert.equal(attempts[0]?.body,attempts[1]?.body);
 assert.equal(new Headers(attempts[0]?.headers).get("X-Noor-Request-Id"),new Headers(attempts[1]?.headers).get("X-Noor-Request-Id"));
 finish(new Response(null,{status:204}));
});
test("N2 acknowledged write remains success when response body stalls",async()=>{
 const response=new Response("{}",{status:200});Object.defineProperty(response,"json",{value:()=>new Promise(()=>{})});
 assert.deepEqual(await sendR386CommandIntent(intent,async()=>response,5),{kind:"success"});
});
test("N2 legacy write is not abandoned by atomic deadline",async()=>{
 let signal:AbortSignal|null|undefined;
 const result=await sendR386CommandIntent({...intent,requiresAtomic:false},async(_,init)=>{signal=init?.signal;await new Promise(r=>setTimeout(r,15));return new Response(null,{status:204});},5);
 assert.deepEqual(result,{kind:"success"});assert.equal(signal,undefined);
});
for(const [label,read] of [["today",fetchNoorPersonalToday],["workspace",fetchNoorPersonalWorkspace]] as const)test(`N2 ${label} stalled read clears dedupe for a fresh request`,async()=>{
 let calls=0;let seen:AbortSignal|null|undefined;
 const fetcher:typeof fetch=async(_,init)=>{calls++;seen=init?.signal;return new Promise<Response>(()=>{});};
 const first=read(fetcher,5);assert.equal(first,read(fetcher,5));assert.deepEqual(await first,{kind:"unavailable"});assert.equal(seen?.aborted,true);
 assert.deepEqual(await read(fetcher,5),{kind:"unavailable"});assert.equal(calls,2);
});
