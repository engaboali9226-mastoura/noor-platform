// R386 offline candidate: prepare shadow changes only, never mutate operational state.
import {createHash} from "node:crypto";
import {validateOwnerEvents} from "./legacy-event-contract.mjs";
const fail=code=>{throw new Error(code);};
const record=x=>x!==null&&typeof x==="object"&&!Array.isArray(x)&&[Object.prototype,null].includes(Object.getPrototypeOf(x));
const specText=x=>typeof x==="string"&&x.trim()!==""&&x.length<=4096;
// Canonical logical command (NOT regenerated state). Reject non-JSON and cycles.
export function canonicalJson(value){
 const active=new Set();
 const visit=v=>{
  if(v===null||typeof v==="boolean"||typeof v==="string")return JSON.stringify(v);
  if(typeof v==="number"&&Number.isFinite(v))return JSON.stringify(v);
  if(!Array.isArray(v)&&!record(v))fail("R386_NON_JSON");
  if(active.has(v))fail("R386_CYCLE");
  active.add(v);
  let output;
  if(Array.isArray(v)){
   if(Object.keys(v).length!==v.length||Array.from({length:v.length},(_,i)=>i).some(i=>!Object.hasOwn(v,i)))fail("R386_NON_JSON");
   output="["+v.map(visit).join(",")+"]";
  }else output="{"+Object.keys(v).sort().map(k=>JSON.stringify(k)+":"+visit(v[k])).join(",")+"}";
  active.delete(v);return output;
 };
 return visit(value);
}
export function logicalRequestDigest(owner,requestId,normalizedCommand){
 if(!specText(owner)||!specText(requestId)||requestId.length>128||!record(normalizedCommand))fail("R386_INVALID_REQUEST");
 const encoded=canonicalJson({version:1,owner,requestId,command:normalizedCommand});
 return createHash("sha256").update(encoded,"utf8").digest("hex");
}
function split(e){const {deliveryState,...history}=e;return {history,deliveryState};}
const equal=(a,b)=>canonicalJson(a)===canonicalJson(b);
const references=(value,ids)=>typeof value==="string"?ids.has(value):Array.isArray(value)?value.some(v=>references(v,ids)):record(value)?Object.values(value).some(v=>references(v,ids)):false;
function stateShape(state,owner){
 if(!record(state)||!Array.isArray(state.definitions)||!Array.isArray(state.dailyExecution))fail("R386_SHADOW_STATE");
 for(const def of state.definitions)if(!record(def)||def.userId!==owner||!specText(def.id)||!specText(def.revisionId))fail("R386_SHADOW_DEFINITION");
 for(const row of state.dailyExecution)if(!record(row)||row.userId!==owner||!specText(row.id)||!specText(row.definitionId)||!specText(row.definitionRevisionId))fail("R386_SHADOW_EXECUTION");
 if(new Set(state.definitions.map(d=>d.id)).size!==state.definitions.length||new Set(state.dailyExecution.map(d=>d.id)).size!==state.dailyExecution.length)fail("R386_SHADOW_DUPLICATE");
 validateOwnerEvents(owner,state.outbox);
}
// deletedDefinitionId must come from the authorized, already validated server command.
// Never trust browser-supplied authorization or infer authorization from absent rows.
export function planOwnerShadow({owner,oldRevision,newRevision,before,after,deletedDefinitionId=null}){
 if(!Number.isSafeInteger(oldRevision)||oldRevision<0||!Number.isSafeInteger(newRevision)||newRevision!==oldRevision+1)fail("R386_SHADOW_REVISION");
 stateShape(before,owner);stateShape(after,owner);
 const oldById=new Map(before.outbox.map(e=>[e.id,e])),nextById=new Map(after.outbox.map(e=>[e.id,e]));
 const oldByKey=new Map(before.outbox.map(e=>[e.idempotencyKey,e]));
 const ids=new Set();
 if(deletedDefinitionId!==null){
  if(!specText(deletedDefinitionId))fail("R386_DELETE_SCOPE");
  const def=before.definitions.find(d=>d.id===deletedDefinitionId);
  if(!def||after.definitions.some(d=>d.id===deletedDefinitionId)||after.dailyExecution.some(d=>d.definitionId===deletedDefinitionId))fail("R386_DELETE_SCOPE");
  ids.add(def.id);ids.add(def.revisionId);
  for(const row of before.dailyExecution.filter(r=>r.definitionId===deletedDefinitionId)){ids.add(row.id);ids.add(row.definitionRevisionId);}
 }
 // Permanent deletion and archival are different: match the actual foundation delete predicate.
 const relevant=e=>ids.size>0&&(references(e.aggregateId,ids)||references(e.payload,ids));
 const removals=[];
 for(const old of before.outbox){
  const missing=!nextById.has(old.id),necessary=relevant(old);
  if(missing!==necessary)fail(missing?"R386_UNAUTHORIZED_EVENT_REMOVAL":"R386_INCOMPLETE_PERMANENT_DELETE");
  if(missing)removals.push(old.id);
 }
 const additions=[],deliveryUpdates=[];
 for(const next of after.outbox){
  if(relevant(next))fail("R386_INCOMPLETE_PERMANENT_DELETE");
  const old=oldById.get(next.id),sameKey=oldByKey.get(next.idempotencyKey);
  if(sameKey&&sameKey.id!==next.id)fail("R386_SHADOW_KEY_COLLISION");
  if(!old)additions.push(structuredClone(split(next)));
  else{
   const previous=split(old),current=split(next);
   if(!equal(previous.history,current.history))fail("R386_SHADOW_EVENT_MUTATED");
   if(previous.deliveryState!==current.deliveryState)deliveryUpdates.push({eventId:next.id,from:previous.deliveryState,to:current.deliveryState});
  }
 }
 return {sourceRevision:newRevision,additions,removals,deliveryUpdates};
}
