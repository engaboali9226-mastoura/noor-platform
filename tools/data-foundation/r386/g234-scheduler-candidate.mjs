// Independent server scheduler authority, never a fabricated browser session.
import {evaluateR386PersonalFoundationCandidate} from "../../../apps/noor-personal/dist/index.js";
import {executeReceiptCandidate} from "./receipt-bridge.mjs";
import {createPersistentSaveAdapter} from "./s3-persistent-adapter.mjs";
export function createR386ScheduledSaveCandidate({pool,keys,activeKeyId}){
 const call=async(sql,args)=>{
  const c=await pool.connect();let discard=true;
  try{
   const r=await c.query("SELECT current_user AS name,rolsuper,rolbypassrls FROM pg_roles WHERE rolname=current_user");
   if(r.rows.length!==1||r.rows[0].name!=="noor_r386_g234_scheduler"||r.rows[0].rolsuper||r.rows[0].rolbypassrls)throw Error("R386_RUNTIME_SCHEDULER_ROLE_DENIED");
   await c.query("BEGIN");
   const result=await c.query(sql,args);
   if(result.rows.length!==1||!Object.hasOwn(result.rows[0],"value"))throw Error("R386_RUNTIME_SCHEDULER_RESULT");
   await c.query("COMMIT");discard=false;return result.rows[0].value;
  }catch(error){await c.query("ROLLBACK").catch(()=>{});throw error;}
  finally{c.release(discard);}
 };
 const database=Object.freeze({
  load:owner=>call("SELECT noor_r386_candidate.g234_scheduler_load($1) AS value",[owner]),
  lookup:(owner,request)=>call("SELECT noor_r386_candidate.g234_scheduler_lookup($1,$2) AS value",[owner,request]),
  commit:x=>{
   if(x.deleteRefs.length)throw Error("R386_RUNTIME_SCHEDULER_DELETE_DENIED");
   return call("SELECT noor_r386_candidate.g234_scheduler_commit($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7,$8,$9::jsonb) AS value",
    [x.owner,x.requestId,x.existed,x.expectedRevision,JSON.stringify(x.before),JSON.stringify(x.after),x.keyId,x.digest,JSON.stringify(x.fingerprints)]);
  }
 });
 return {database,candidate:Object.freeze({
  async run(input){
   if(input.trustedNoorSessionId!==undefined||input.deletedDefinitionId!==undefined||input.command?.type!=="ensure-today-r386"||
    !/^[0-9]{12}$/.test(input.command?.slot??"")||input.requestId!=="scheduler-"+input.command.slot)
    throw Error("R386_RUNTIME_SCHEDULER_COMMAND_DENIED");
   const result=await executeReceiptCandidate({owner:input.ownerId,requestId:input.requestId,command:input.command,keys,activeKeyId,
    evaluate:state=>evaluateR386PersonalFoundationCandidate(input.ownerId,state,input.evaluate),
    adapter:createPersistentSaveAdapter({database})});
   return {status:result.status};
  }
 })};
}
