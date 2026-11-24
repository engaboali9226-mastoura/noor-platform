// Restricted disposable database worker + actual provider API; no observer connection.
import {G1_ERASURE_BUCKET} from "./g1-managed-erasure.mjs";
export function createRestrictedErasureBackend({pool,admin}){
 const storage=admin.storage.from(G1_ERASURE_BUCKET);
 const call=async(sql,params)=>{
  const c=await pool.connect();let discard=true;
  try{
   const r=await c.query("SELECT current_user AS name,rolsuper,rolbypassrls FROM pg_roles WHERE rolname=current_user");
   if(r.rows.length!==1||r.rows[0].name!=="noor_r386_g1_eraser"||r.rows[0].rolsuper||r.rows[0].rolbypassrls)throw Error("R386_ERASURE_ROLE_DENIED");
   await c.query("BEGIN");
   const answer=await c.query(sql,params);
   if(answer.rows.length!==1||!Object.hasOwn(answer.rows[0],"value"))throw Error("R386_ERASURE_RESULT_DENIED");
   await c.query("COMMIT");discard=false;return answer.rows[0].value;
  }catch(error){await c.query("ROLLBACK").catch(()=>{});throw error;}
  finally{c.release(discard);}
 };
 const args=f=>[f.ownerId,f.erasureId,f.accountId];
 const paths=f=>call("SELECT noor_r386_candidate.g1_erase_storage_paths($1,$2,$3) AS value",args(f));
 const step=(f,s,d)=>call("SELECT noor_r386_candidate.g1_erase_step($1,$2,$3,$4,$5) AS value",[...args(f),s,d]);
 const authCount=f=>call("SELECT noor_r386_candidate.g1_erase_auth_count($1,$2,$3) AS value",args(f));
 function validCount(x){const n=Number(x);if(!Number.isSafeInteger(n)||n<0)throw Error("R386_ERASURE_COUNT_DENIED");return n;}
 return {
  authorizeAndFence:i=>call("SELECT noor_r386_candidate.g1_erase_authorize($1,$2) AS value",[i.operatorSessionId,i.targetAuthUserId]),
  async eraseStore(f,s){
   if(s==="storage-objects"){const list=await paths(f);if(validCount(await step(f,s,false))>0&&list.length&&(await storage.remove(list)).error)throw Error("R386_ERASURE_STORAGE_FAILED");}
   else await step(f,s,true);
  },
  async remainingRows(f,s){return validCount(await step(f,s,false));},
  async hardDeleteManagedAuth(f){await authCount(f);if((await admin.auth.admin.deleteUser(f.authUserId,false)).error)throw Error("R386_ERASURE_AUTH_DELETE_FAILED");},
  async managedAuthResiduals(f){return validCount(await authCount(f));},
  async verifyAndFinalize(f){
   const results=await Promise.all((await paths(f)).map(path=>storage.download(path)));
   if(results.some(r=>!r.error||!["404","not_found","NoSuchKey"].includes(String(r.error.statusCode??r.error.code))))return false;
   return call("SELECT noor_r386_candidate.g1_erase_verify($1,$2,$3) AS value",args(f));
  }
 };
}
