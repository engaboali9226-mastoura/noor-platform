import assert from 'node:assert/strict';
import test from 'node:test';
import {readNoorResumeToday} from '../src/noor-resume-transport.js';
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json'}});
const snapshot={personalDay:{userId:'owner-a'},workspace:{definitions:[],insights:{}}};
const read=(fetcher:typeof fetch,signal=new AbortController().signal,timeoutMs=1000)=>readNoorResumeToday({fetcher,signal,timeoutMs,expectedOwner:'owner-a',validate:(v)=>{const x=v as typeof snapshot;return x?.personalDay?.userId&&Array.isArray(x?.workspace?.definitions)?x:null;},ownerOf:x=>x.personalDay.userId});
test('N7 transport: successful same-origin snapshot is owner-scoped',async()=>{
 const result=await read(async(url,init)=>{assert.equal(url,'/api/noor/personal/today');assert.equal(init?.credentials,'same-origin');assert.equal(init?.cache,'no-store');assert.equal(init?.method,'POST');return json(snapshot);});
 assert.deepEqual(result,{kind:'ready',snapshot});
});
test('N7 transport: distinguishes 401, 403, setup and transient errors',async()=>{
 for(const [status,kind] of [[401,'session-required'],[403,'forbidden'],[409,'setup-required'],[503,'retryable'],[429,'retryable'],[500,'terminal']] as const)assert.deepEqual(await read(async()=>json({},status)),{kind});
});
test('N7 transport: malformed JSON or missing workspace cannot be ready',async()=>{
 assert.deepEqual(await read(async()=>json({personalDay:{userId:'owner-a'}})),{kind:'terminal'});
 assert.deepEqual(await read(async()=>new Response('{',{headers:{'Content-Type':'application/json'}})),{kind:'terminal'});
 assert.deepEqual(await read(async()=>new Response('html')),{kind:'terminal'});
});
test('N7 transport: mismatched owner is never returned to caller',async()=>{
 assert.deepEqual(await read(async()=>json({...snapshot,personalDay:{userId:'owner-b'}})),{kind:'owner-mismatch'});
});
test('N7 transport: rejection is transient, not session expiry',async()=>{
 assert.deepEqual(await read(async()=>{throw Error('offline');}),{kind:'retryable'});
});
test('N7 transport: deadline aborts even an uncooperative fetch',async()=>{
 let seen:AbortSignal|undefined;
 assert.deepEqual(await read(async(_,init)=>{seen=init?.signal??undefined;return new Promise<Response>(()=>{});},undefined,10),{kind:'retryable'});
 assert.equal(seen?.aborted,true);
});
test('N7 transport: caller cancellation blocks late snapshot',async()=>{
 const controller=new AbortController();let finish!:(r:Response)=>void;
 const p=read(async()=>new Promise<Response>(r=>{finish=r;}),controller.signal);
 controller.abort();finish(json(snapshot));assert.deepEqual(await p,{kind:'cancelled'});
});
