// Server-only hosted composition, default OFF. No schema writes or auto-enrollment.
import {Pool} from "pg";
import {createNoorR386G1SqlCommitAdapter} from "../../../apps/noor-runtime/dist/noor-r386-g1-sql-commit-adapter.js";
import {createR386RuntimeSaveCandidate} from "./s3-runtime-coordinator.mjs";
import {createR386ScheduledSaveCandidate} from "./g234-scheduler-candidate.mjs";
const fail=()=>{throw Error("R386_HOSTED_CONFIGURATION_DENIED")};
const token=/^[A-Za-z0-9_-]{1,128}$/u;
function keyring(env){
 let raw;try{raw=JSON.parse(env.NOOR_R386_RECEIPT_KEYS??"")}catch{fail()}
 if(!raw||typeof raw!=="object"||Array.isArray(raw)||Object.keys(raw).length<1||Object.keys(raw).length>8)fail();
 const keys=new Map();
 for(const [id,key] of Object.entries(raw)){
  if(!token.test(id)||typeof key!=="string"||!/^[0-9a-f]{64}$/u.test(key))fail();
  keys.set(id,Buffer.from(key,"hex"));
 }
 const activeKeyId=env.NOOR_R386_ACTIVE_RECEIPT_KEY_ID;
 if(!keys.has(activeKeyId))fail();
 return {keys,activeKeyId};
}
function connection(raw,local){
 let u;try{u=new URL(raw)}catch{fail()}
 if(u.protocol!=="postgresql:"||!u.username||!u.password||u.search||u.hash||!u.pathname||u.pathname==="/")fail();
 if(local){if(u.hostname!=="127.0.0.1")fail();}
 else if(!(/^(db\.[a-z0-9]+\.supabase\.co|[a-z0-9-]+\.pooler\.supabase\.com)$/u.test(u.hostname))||u.port==="6543")fail();
 return new Pool({connectionString:u.href,max:2,connectionTimeoutMillis:10000,...(local?{}:{ssl:{rejectUnauthorized:true}})});
}
export async function createR386HostedComposition(env=process.env,{local=false}={}){
 if(env.NOOR_R386_RUNTIME===undefined||env.NOOR_R386_RUNTIME==="disabled")return undefined;
 if(env.NOOR_R386_RUNTIME!=="enabled")fail();
 const {keys,activeKeyId}=keyring(env);
 let writer,scheduler;
 const close=async()=>{await Promise.allSettled([writer?.end(),scheduler?.end()])};
 try{
  writer=connection(env.NOOR_R386_WRITER_DATABASE_URL,local);
  scheduler=connection(env.NOOR_R386_SCHEDULER_DATABASE_URL,local);
  const query=async(pool,role,sql,args=[])=>{
   const c=await pool.connect();
   try{
    const a=await c.query("SELECT current_user AS role,rolsuper,rolbypassrls FROM pg_roles WHERE rolname=current_user");
    if(a.rows.length!==1||a.rows[0].role!==role||a.rows[0].rolsuper||a.rows[0].rolbypassrls)fail();
    const r=await c.query(sql,args);if(r.rows.length!==1||!Object.hasOwn(r.rows[0],"value"))fail();
    return r.rows[0].value;
   }finally{c.release();}
  };
  const wr=(sql,args)=>query(writer,"noor_r386_g1_writer",sql,args);
  const sc=(sql,args)=>query(scheduler,"noor_r386_g234_scheduler",sql,args);
  for(const read of [wr,sc]){
   const readiness=await read("SELECT noor_r386_candidate.g234_runtime_readiness() AS value");
   if(readiness?.active!==true||!Array.isArray(readiness.keyIds)||readiness.keyIds.some(id=>!keys.has(id)))fail();
  }
  const adapter=createNoorR386G1SqlCommitAdapter({pool:writer,expectedSqlRole:"noor_r386_g1_writer"});
  const atomic=createR386RuntimeSaveCandidate({database:null,keys,activeKeyId,clock:{now:()=>new Date().toISOString()},sqlCommit:adapter});
  const scheduled=createR386ScheduledSaveCandidate({pool:scheduler,keys,activeKeyId});
  return {close,options:Object.freeze({captureOriginatingAuthSessionId:true,...(local?{}:{hostedR386:true}),
   atomicSaveCandidate:Object.freeze({...atomic,async useForOwner({trustedNoorSessionId,ownerId}){
    const answer=await wr("SELECT noor_r386_candidate.g234_session_cohort($1,$2) AS value",[trustedNoorSessionId,ownerId]);
    if(typeof answer!=="boolean")fail();return answer;
   }}),
   schedulerSaveCandidate:Object.freeze({...scheduled.candidate,async useForOwner(ownerId){
    const answer=await sc("SELECT noor_r386_candidate.g234_scheduler_cohort($1) AS value",[ownerId]);
    if(typeof answer!=="boolean")fail();return answer;
   }})
  })};
 }catch{await close();throw Error("R386_HOSTED_STARTUP_DENIED")}
}
