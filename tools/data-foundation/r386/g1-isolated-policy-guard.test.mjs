import test from 'node:test';
import assert from 'node:assert/strict';
import {executeG1IsolatedAuthorizedCommand, verifyG1HistoricalKeyCoverage, assertG1IrreversibleErasureEvidence} from './g1-isolated-policy-guard.mjs';
const keys=new Map([['old',Buffer.alloc(32,1)],['new',Buffer.alloc(32,2)]]);
const owner='synthetic-r386-g1-a';
const principal=(override={})=>({ownerId:owner,accountId:'synthetic-account-a',active:true,
 revoked:false,erased:false,authorizedPersonal:true,ownerEverReassigned:false,expiresAtEpochMs:100000,...override});
function fixture(){
 const states=new Map(),receipts=new Map();let evaluations=0,reads=0,commits=0,resolves=0,inventoryReads=0;
 const id=(o,r)=>`${o}\0${r}`;
 let currentPrincipal=principal();
 const adapter={
  async lookup(o,r){reads++;return structuredClone(receipts.get(id(o,r))??null)},
  async load(o){reads++;return structuredClone(states.get(o)??{existed:false,revision:0,state:{counter:0}})},
  async commitAtomic(x){
   const prior=receipts.get(id(x.owner,x.requestId));
   if(prior)return {kind:'replay',receipt:structuredClone(prior)};
   const current=states.get(x.owner)??{existed:false,revision:0,state:{counter:0}};
   if(current.existed!==x.existed||current.revision!==x.expectedRevision)return {kind:'conflict'};
   commits++;
   if(x.changed)states.set(x.owner,{existed:true,revision:x.receipt.revision,state:structuredClone(x.candidate)});
   receipts.set(id(x.owner,x.requestId),structuredClone(x.receipt));
   return {kind:'committed',receipt:structuredClone(x.receipt)};
  }
 };
 const run=(overrides={})=>executeG1IsolatedAuthorizedCommand({
  request:{sessionId:'session-a',requestId:'req-a',command:{type:'increment',value:1},...overrides.request},
  verifySession:async sessionId=>{resolves++;assert.equal(sessionId,'session-a');return currentPrincipal},
  loadHistoricalReceiptKeyIds:async o=>{inventoryReads++;assert.equal(o,owner);return new Set(['old'])},
  keys,activeKeyId:'old',adapter,nowEpochMs:500,...overrides,
  evaluate:s=>{evaluations++;return {...s,counter:s.counter+1}}
 });
 return{run,states,receipts,setPrincipal:p=>currentPrincipal=p,
  get counts(){return{evaluations,reads,commits,resolves,inventoryReads}}};
}
test('retained receipt acknowledges late retry without duplicate mutation across key rotation',async()=>{
 const f=fixture();assert.equal((await f.run()).revision,1);
 assert.equal((await f.run({activeKeyId:'new'})).revision,1);
 assert.deepEqual(f.counts,{evaluations:1,reads:3,commits:1,resolves:2,inventoryReads:2});
 assert.equal(f.states.get(owner).state.counter,1);
 console.log('R386_G1_RETAINED_RECEIPT_PREVENTS_REPLAY_PASS');
});
test('browser supplied owner is rejected before session resolution or persistence',async()=>{
 const f=fixture();await assert.rejects(f.run({request:{ownerId:'synthetic-r386-g1-b'}}),/R386_G1_REQUEST/);
 assert.deepEqual(f.counts,{evaluations:0,reads:0,commits:0,resolves:0,inventoryReads:0});
});
test('revoked, expired, erased, reassigned and unauthorized principal cannot reach persistence',async()=>{
 const f=fixture();for(const p of [
  principal({revoked:true}),principal({expiresAtEpochMs:1}),principal({erased:true}),
  principal({ownerEverReassigned:true}),principal({authorizedPersonal:false}),principal({active:false}),
 ]){f.setPrincipal(p);await assert.rejects(f.run(),/R386_G1_PRINCIPAL_DENIED/)}
 assert.equal(f.counts.reads,0);assert.equal(f.counts.commits,0);assert.equal(f.counts.inventoryReads,0);
 console.log('R386_G1_PRINCIPAL_AND_ERASURE_DENIAL_PASS');
});
test('unknown session authority fails closed without reading receipts',async()=>{
 const f=fixture();await assert.rejects(f.run({verifySession:async()=>{throw Error('provider outage')}}),/R386_G1_SESSION_UNAVAILABLE/);
 assert.equal(f.counts.reads,0);
});
test('key history coverage requires old key and bounds the ring to eight keys',async()=>{
 const f=fixture();await assert.rejects(f.run({keys:new Map([['new',keys.get('new')]]),activeKeyId:'new'}),/R386_G1_HISTORICAL_KEY_REQUIRED/);
 await assert.rejects(f.run({keys:new Map(Array.from({length:9},(_,i)=>['k'+i,Buffer.alloc(32,i+1)])),activeKeyId:'k8'}),/R386_G1_KEY_POLICY/);
 assert.deepEqual(f.counts,{evaluations:0,reads:0,commits:0,resolves:1,inventoryReads:1});
 assert.equal(verifyG1HistoricalKeyCoverage({keys,activeKeyId:'new',requiredKeyIds:new Set(['old'])}),true);
 console.log('R386_G1_HISTORICAL_KEY_COVERAGE_PASS');
});
test('soft delete is not an irreversible-erasure proof',()=>{
 const success={verifiedAuthority:true,noorSessionsRevoked:true,linkageRemoved:true,
  sourceErased:true,candidateErased:true,ownerNeverReissued:true};
 assert.equal(assertG1IrreversibleErasureEvidence(success),true);
 assert.throws(()=>assertG1IrreversibleErasureEvidence({...success,candidateErased:false}),/R386_G1_ERASURE_INCOMPLETE/);
 assert.throws(()=>assertG1IrreversibleErasureEvidence({...success,personalDataRetained:true}),/R386_G1_ERASURE_INCOMPLETE/);
 console.log('R386_G1_SOFT_VS_PERMANENT_ERASURE_EVIDENCE_PASS');
});
