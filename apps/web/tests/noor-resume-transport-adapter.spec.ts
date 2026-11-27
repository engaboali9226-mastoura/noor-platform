import assert from 'node:assert/strict';
import test from 'node:test';
import {fetchNoorPersonalResumeToday,supportsR386AtomicSave} from '../src/noor-personal-today-client.js';
const body={personalDay:{userId:'a'},islamicContext:{},nextPrayer:null,tasks:[],habits:[],automationPending:0,workspace:{definitions:[],insights:{}}};
const read=(payload:unknown,status=200):typeof fetch=>async()=>new Response(JSON.stringify(payload),{status,headers:{'Content-Type':'application/json','X-Noor-Atomic-Save':'r386'}});
test('N7 adapter accepts complete owner-scoped today and keeps atomic capability on original fetcher',async()=>{
 const f=read(body);assert.equal(supportsR386AtomicSave(f),false);
 const result=await fetchNoorPersonalResumeToday('a',new AbortController().signal,f);
 assert.equal(result.kind,'ready');assert.equal(supportsR386AtomicSave(f),true);
});
test('N7 adapter rejects split, malformed, and different-owner snapshots and identifies setup',async()=>{
 const sig=new AbortController().signal;
 assert.equal((await fetchNoorPersonalResumeToday('a',sig,read({...body,workspace:undefined}))).kind,'terminal');
 assert.equal((await fetchNoorPersonalResumeToday('a',sig,read({...body,tasks:null}))).kind,'terminal');
 assert.equal((await fetchNoorPersonalResumeToday('b',sig,read(body))).kind,'owner-mismatch');
 assert.equal((await fetchNoorPersonalResumeToday('a',sig,read({},409))).kind,'setup-required');
});
