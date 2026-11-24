// Offline recovery rail for a quarantined local restore. Never expose to HTTP.
// A signed manifest alone is not fresh: a separately trusted latest head is mandatory.
import {createHash,createPublicKey,verify} from "node:crypto";
import {Pool} from "pg";
import {canonicalJson} from "./shadow-transition.mjs";
const digest=s=>createHash("sha256").update(s).digest("hex");
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;
const hex=/^[0-9a-f]{64}$/u;
const exact=(o,keys)=>o&&typeof o==="object"&&!Array.isArray(o)&&Object.keys(o).sort().join(",")===keys;
export function verifyRecoveryLedger(envelope,publicKey,expectedHead){
 if(!exact(envelope,"body,signature")||!exact(envelope.body,"entries,generation,lineage,version")||
  !exact(expectedHead,"digest,generation,lineage")||envelope.body.version!==1||
  !Number.isSafeInteger(envelope.body.generation)||envelope.body.generation<1||
  !/^[A-Za-z0-9_-]{1,80}$/u.test(envelope.body.lineage)||
  envelope.body.lineage!==expectedHead.lineage||envelope.body.generation!==expectedHead.generation||
  !hex.test(expectedHead.digest)||!Array.isArray(envelope.body.entries))
  throw Error("R386_RECOVERY_LEDGER_HEAD_DENIED");
 const body=envelope.body,encoded=canonicalJson(body),key=createPublicKey(publicKey);
 if(key.asymmetricKeyType!=="ed25519"||typeof envelope.signature!=="string"||
  !/^[A-Za-z0-9+/]{86}==$/u.test(envelope.signature)||
  digest(encoded)!==expectedHead.digest||
  !verify(null,Buffer.from(encoded),key,Buffer.from(envelope.signature,"base64")))
  throw Error("R386_RECOVERY_LEDGER_SIGNATURE_DENIED");
 const owners=new Set(),digests=new Set();
 for(const e of body.entries){
  if(!exact(e,"accountDigests,ownerId")||!uuid.test(e.ownerId)||owners.has(e.ownerId)||
   !Array.isArray(e.accountDigests)||e.accountDigests.length===0||
   e.accountDigests.some(h=>!hex.test(h)||digests.has(h)))
   throw Error("R386_RECOVERY_LEDGER_ENTRY_DENIED");
  owners.add(e.ownerId);
  for(const h of e.accountDigests){
   if(digests.has(h))throw Error("R386_RECOVERY_LEDGER_ENTRY_DENIED");
   digests.add(h);
  }
 }
 return structuredClone(body);
}
const cs="noor_r386_candidate.";
async function localTransaction(url,work){
 const u=new URL(url);
 if(u.protocol!=="postgresql:"||u.hostname!=="127.0.0.1"||decodeURIComponent(u.username)!=="postgres")
  throw Error("R386_RECOVERY_LOCAL_ONLY");
 const pool=new Pool({connectionString:url,max:1}),c=await pool.connect();
 try{
  await c.query("BEGIN");
  const result=await c.query("SELECT current_user AS role,rolsuper,rolbypassrls FROM pg_roles WHERE rolname=current_user");
  if(result.rows[0]?.role!=="postgres"||result.rows[0]?.rolsuper||!result.rows[0]?.rolbypassrls)
   throw Error("R386_RECOVERY_OPERATOR_DENIED");
  const answer=await work(c);
  await c.query("COMMIT");return answer;
 }catch(error){await c.query("ROLLBACK").catch(()=>{});throw error;}
 finally{c.release();await pool.end();}
}
export async function quarantineRestoredOwners({databaseUrl,envelope,publicKey,expectedHead}){
 const ledger=verifyRecoveryLedger(envelope,publicKey,expectedHead);
 return localTransaction(databaseUrl,async c=>{
  // Must execute before enabling external Auth/API/runtime access. This table
  // lock is an additional guard, not a substitute for network quarantine.
  await c.query("LOCK TABLE public.noor_sessions, public.noor_entitlement_grants, public.noor_authentication_account_linkages, public.noor_admin_accounts_r271 IN SHARE ROW EXCLUSIVE MODE");
  const owners=new Set(ledger.entries.map(e=>e.ownerId));
  const hashes=new Set(ledger.entries.flatMap(e=>e.accountDigests));
  const oldOwners=(await c.query("SELECT owner_id FROM "+cs+"g1_owner_erasure_tombstone")).rows;
  const oldHashes=(await c.query("SELECT encode(account_digest,'hex') AS digest FROM "+cs+"g1_erased_account_digest")).rows;
  if(oldOwners.some(e=>!owners.has(e.owner_id))||oldHashes.some(e=>!hashes.has(e.digest)))
   throw Error("R386_RECOVERY_LEDGER_NOT_SUPERSET");
  for(const entry of ledger.entries){
   const linked=(await c.query("SELECT user_id::text AS owner, encode(sha256(convert_to(account_id,'UTF8')),'hex') AS digest FROM public.noor_authentication_account_linkages WHERE user_id::text=$1 OR encode(sha256(convert_to(account_id,'UTF8')),'hex')=ANY($2::text[])",[entry.ownerId,entry.accountDigests])).rows;
   if(linked.some(row=>row.owner!==entry.ownerId||!entry.accountDigests.includes(row.digest)))
    throw Error("R386_RECOVERY_REASSIGNMENT_DENIED");
   const admin=(await c.query("SELECT auth_user_id::text AS owner,encode(sha256(convert_to(account_id,'UTF8')),'hex') AS digest FROM public.noor_admin_accounts_r271 WHERE auth_user_id::text=$1 OR encode(sha256(convert_to(account_id,'UTF8')),'hex')=ANY($2::text[])",[entry.ownerId,entry.accountDigests])).rows;
   if(admin.some(row=>row.owner!==entry.ownerId||!entry.accountDigests.includes(row.digest)))
    throw Error("R386_RECOVERY_REASSIGNMENT_DENIED");
   await c.query("INSERT INTO "+cs+"g1_owner_erasure_tombstone(owner_id) VALUES($1) ON CONFLICT DO NOTHING",[entry.ownerId]);
   for(const h of entry.accountDigests)await c.query("INSERT INTO "+cs+"g1_erased_account_digest VALUES(decode($1,'hex')) ON CONFLICT DO NOTHING",[h]);
   await c.query("UPDATE public.noor_sessions SET revoked_at_epoch_ms=greatest(created_at_epoch_ms,floor(extract(epoch FROM clock_timestamp())*1000)::bigint) WHERE revoked_at_epoch_ms IS NULL AND encode(sha256(convert_to(account_id,'UTF8')),'hex')=ANY($1::text[])",[entry.accountDigests]);
   await c.query("UPDATE public.noor_entitlement_grants SET revoked_at_epoch_ms=greatest(granted_at_epoch_ms,floor(extract(epoch FROM clock_timestamp())*1000)::bigint) WHERE revoked_at_epoch_ms IS NULL AND encode(sha256(convert_to(account_id,'UTF8')),'hex')=ANY($1::text[])",[entry.accountDigests]);
   await c.query("UPDATE public.noor_admin_accounts_r271 SET enabled=false WHERE auth_user_id::text=$1 AND enabled",[entry.ownerId]);
  }
  // Always pending: archived rows must be purged through existing verified
  // erasure procedure, with a fresh operator and independent inventory.
  return {status:"quarantined",owners:ledger.entries.length,releaseAllowed:false};
 });
}
export async function verifyRestoredDatabaseReconciliation({databaseUrl,envelope,publicKey,expectedHead}){
 const ledger=verifyRecoveryLedger(envelope,publicKey,expectedHead);
 const stores=["storage-objects","admin-audit","admin-accounts","task-events","tasks","habit-entries","habits","work-teacher-state","personal-foundation","private-journal","candidate-analytics","candidate-delivery","candidate-events","candidate-checkpoint","candidate-receipts","candidate-enrollment","candidate-owner","noor-entitlement-grants","noor-sessions","noor-account-linkages"];
 return localTransaction(databaseUrl,async c=>{
  for(const entry of ledger.entries){
   // Missing evidence is not absence. An archive predating account creation
   // needs a separate reviewed inventory rather than an assumed clean result.
   const j=(await c.query("SELECT target_id,erasure_id,account_id,database_verified_at,completed_at FROM "+cs+"g1_managed_erasure_job WHERE target_id=$1",[entry.ownerId])).rows[0];
   if(!j?.database_verified_at||j.completed_at!==null||typeof j.account_id!=="string"||
    !entry.accountDigests.includes(digest(j.account_id)))throw Error("R386_RECOVERY_ERASURE_EVIDENCE_PENDING");
   const args=[entry.ownerId,j.erasure_id,j.account_id];
   for(const store of stores){
    const n=(await c.query("SELECT "+cs+"g1_erase_step($1,$2,$3,$4,false) AS n",[...args,store])).rows[0]?.n;
    if(n!=="0")throw Error("R386_RECOVERY_RESIDUAL_PENDING");
   }
   const n=(await c.query("SELECT "+cs+"g1_erase_auth_count($1,$2,$3) AS n",args)).rows[0]?.n;
   if(n!=="0")throw Error("R386_RECOVERY_AUTH_RESIDUAL_PENDING");
  }
  return {status:"database-reconciled",externalRetentionVerified:false,releaseAllowed:false};
 });
}
