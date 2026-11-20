// Real application evaluation + S1/S2/S3 persistent SQL, isolated candidate only.
// Not imported by the production composition; no Auth fixture or managed RPC.
import {randomUUID} from "node:crypto";
import {evaluateR386PersonalFoundationCandidate,evaluateR386InitializationCandidate} from "../../../apps/noor-personal/dist/index.js";
import {executeReceiptCandidate} from "./receipt-bridge.mjs";
import {createPersistentSaveAdapter} from "./s3-persistent-adapter.mjs";

export function createR386RuntimeSaveCandidate({database,keys,activeKeyId,clock}){
 const execute=async({ownerId,requestId,command,deletedDefinitionId=null,evaluate})=>{
  const result=await executeReceiptCandidate({owner:ownerId,requestId,command,keys,activeKeyId,evaluate,
   adapter:createPersistentSaveAdapter({database,deletedDefinitionId})});
  return {status:result.status};
 };
 return Object.freeze({
  run(input){
   return execute({...input,evaluate:state=>evaluateR386PersonalFoundationCandidate(input.ownerId,state,input.evaluate)});
  },
  initialize({ownerId,requestId,city,calculationMethod}){
   return execute({ownerId,requestId,command:{type:"initialize-personal-profile-r321",city,calculationMethod},
    evaluate:state=>{
     const candidate=evaluateR386InitializationCandidate(ownerId,state,city,calculationMethod,clock.now(),
      "location-revision:r321:"+randomUUID(),"prayer-policy:r321:"+randomUUID());
     if(candidate===null)throw Error("R386_INITIALIZATION_ALREADY_CONFIGURED");
     return candidate;
    }});
  },
 });
}

// Read the old authoritative source after ACK. Fail if a caller tries to use
// this read scope to write outside the candidate transaction.
export async function openR386CandidateReadScope(database,ownerId){
 const {state}=await database.load(ownerId);
 let read;
 await evaluateR386PersonalFoundationCandidate(ownerId,state,async scope=>{
  read=Object.freeze({snapshot:scope.snapshot,locations:scope.locations,prayerPolicies:scope.prayerPolicies,
   transaction:{async runInTransaction(){throw Error("R386_READ_SCOPE_WRITE");}}});
 });
 return read;
}
