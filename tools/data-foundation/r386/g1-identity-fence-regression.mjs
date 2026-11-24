import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
const require=createRequire((process.env.R386_G1_DEPENDENCY_ROOT || process.cwd())+"/package.json");
const {Pool}=require("pg");
const {API_URL,DB_URL,ANON_KEY,SERVICE_ROLE_KEY}=JSON.parse(readFileSync(process.argv[2],"utf8"));
const api=new URL(API_URL),db=new URL(DB_URL);
assert.equal(api.hostname,"127.0.0.1");assert.equal(db.hostname,"127.0.0.1");
assert.equal(api.protocol,"https:");assert.equal(db.protocol,"postgresql:");
const fixture=spawnSync("psql",["-Xqw","-v","ON_ERROR_STOP=1","-f","tools/data-foundation/r386/g1-identity-fence-fixture.sql"],{
 env:{...process.env,R386_G1_WRITER_PASSWORD:randomUUID(),PGHOST:db.hostname,PGPORT:db.port,PGDATABASE:decodeURIComponent(db.pathname.slice(1)),PGUSER:decodeURIComponent(db.username),PGPASSWORD:decodeURIComponent(db.password),PGSSLMODE:"disable"},encoding:"utf8"});
if(fixture.status!==0){
 const markers=(fixture.stderr??"").match(/R386_G1_[A-Z0-9_]+/g)??[];
 for(const m of new Set(markers))console.log(m);
 console.log("R386_G1_IDENTITY_FIXTURE_FAILED=YES");
 throw new Error("Fixture installation failed");
}
const pool=new Pool({connectionString:DB_URL,max:4});
const schema="noor_r386_candidate";
const deny={code:"P0001",message:"R386_G1_IDENTITY_ERASED_ACCOUNT_DENIED"};
const issuer=api.origin+"/auth/v1";
async function post(path,key,body){
 const r=await fetch(api.origin+path,{method:"POST",headers:{apikey:key,Authorization:"Bearer "+key,"Content-Type":"application/json"},body:JSON.stringify(body)});
 assert.ok(r.ok,"Disposable Auth request failed");return r.json();
}
async function account(){
 const email=randomUUID()+"@example.invalid",password="Synthetic-"+randomUUID()+"-a1!";
 const user=await post("/auth/v1/admin/users",SERVICE_ROLE_KEY,{email,password,email_confirm:true});
 const session=await post("/auth/v1/token?grant_type=password",ANON_KEY,{email,password});
 return {id:user.id,email,account:"r386-"+randomUUID(),provider:JSON.parse(Buffer.from(session.access_token.split(".")[1],"base64url")).session_id};
}
async function svc(sql,params){
 const c=await pool.connect();
 try{await c.query("BEGIN");await c.query("SET LOCAL ROLE service_role");const result=await c.query(sql,params);await c.query("COMMIT");return result;}
 finally{await c.query("ROLLBACK").catch(()=>{});c.release();}
}
const link="INSERT INTO public.noor_authentication_account_linkages VALUES($1,$2,$3,$2::text::uuid)";
const grant="INSERT INTO public.noor_entitlement_grants VALUES($1,$2,'access','application',$3,0,NULL)";
const session="INSERT INTO public.noor_sessions(id,account_id,created_at_epoch_ms,expires_at_epoch_ms,revoked_at_epoch_ms,originating_auth_session_id) VALUES($1,$2,$3,$4,NULL,$5)";
const audit="INSERT INTO public.noor_admin_audit_r271(id,actor_auth_user_id,target_auth_user_id,action,outcome,request_id,details) VALUES($1,$2,$3,'manage','success',$1,$4)";
async function setup(a){
 await svc(link,[issuer,a.id,a.account]);
 a.grant=randomUUID();await svc(grant,[a.grant,a.account,"noor-personal"]);
 a.session=randomUUID();await svc(session,[a.session,a.account,Date.now(),Date.now()+60000,a.provider]);
 await pool.query("INSERT INTO public.noor_admin_accounts_r271(auth_user_id,account_id,role) VALUES($1,$2,'admin')",[a.id,a.account]);
}
try{
 await pool.query("GRANT INSERT ON public.noor_authentication_account_linkages,public.noor_admin_audit_r271 TO service_role");
 await pool.query("GRANT INSERT,UPDATE ON public.noor_entitlement_grants TO service_role");
 const a=await account(),b=await account();await setup(a);await setup(b);
 const before=randomUUID();await svc(audit,[before,b.id,a.id,{accountId:a.account}]);
 await assert.rejects(svc(link,[issuer+"-alternate",b.id,a.account]),{code:"P0001",message:"R386_G1_IDENTITY_LINKAGE_DENIED"});
 const tx=await pool.connect();
 try{
  await tx.query("BEGIN");
  await tx.query("INSERT INTO "+schema+".g1_owner_erasure_tombstone(owner_id) VALUES($1)",[a.id]);
  await tx.query("INSERT INTO "+schema+".g1_managed_erasure_job(target_id,erasure_id,account_id,target_email,storage_paths,auth_session_ids,auth_factor_ids) VALUES($1,$2,$3,$4,ARRAY[]::text[],ARRAY[$5::uuid],ARRAY[]::uuid[])",[a.id,randomUUID(),a.account,a.email,a.provider]);
  await tx.query("COMMIT");
 }finally{await tx.query("ROLLBACK").catch(()=>{});tx.release();}
 assert.equal((await pool.query("SELECT count(*) n FROM "+schema+".g1_erased_account_digest")).rows[0].n,"1");
 await assert.rejects(svc(grant,[randomUUID(),a.account,"noor-work"]),deny);
 await assert.rejects(svc(session,[randomUUID(),a.account,Date.now(),Date.now()+60000,a.provider]),deny);
 await assert.rejects(svc(link,[issuer+"-alternate",a.id,a.account]),deny);
 await svc("UPDATE public.noor_entitlement_grants SET revoked_at_epoch_ms=1 WHERE id=$1",[a.grant]);
 await svc("UPDATE public.noor_sessions SET revoked_at_epoch_ms=1 WHERE id=$1",[a.session]);
 await pool.query("UPDATE public.noor_admin_accounts_r271 SET enabled=false WHERE auth_user_id=$1",[a.id]);
 await assert.rejects(svc("UPDATE public.noor_entitlement_grants SET revoked_at_epoch_ms=NULL WHERE id=$1",[a.grant]),deny);
 await assert.rejects(svc("UPDATE public.noor_sessions SET revoked_at_epoch_ms=NULL WHERE id=$1",[a.session]),deny);
 await assert.rejects(pool.query("UPDATE public.noor_admin_accounts_r271 SET enabled=true WHERE auth_user_id=$1",[a.id]),deny);
 console.log("R386_G1_IDENTITY_REVOCATION_NOT_REACTIVATION_PASS");
 await assert.rejects(svc(audit,[randomUUID(),b.id,a.id,{}]),deny);
 await assert.rejects(svc(audit,[randomUUID(),b.id,null,{accountId:a.account}]),deny);
 await pool.query("UPDATE public.noor_admin_audit_r271 SET target_auth_user_id=NULL,target_erased=true,details='{}' WHERE id=$1",[before]);
 await svc(audit,[randomUUID(),b.id,null,{accountId:b.account}]);
 console.log("R386_G1_IDENTITY_STRUCTURED_AUDIT_FENCE_PASS");
 await pool.query("DELETE FROM public.noor_admin_accounts_r271 WHERE auth_user_id=$1",[a.id]);
 await pool.query("DELETE FROM public.noor_entitlement_grants WHERE account_id=$1",[a.account]);
 await pool.query("DELETE FROM public.noor_sessions WHERE account_id=$1",[a.account]);
 await pool.query("DELETE FROM public.noor_authentication_account_linkages WHERE user_id=$1",[a.id]);
 await assert.rejects(svc(link,[issuer+"-alternate",b.id,a.account]),deny);
 await assert.rejects(svc(link,[issuer+"-alternate",a.id,"r386-"+randomUUID()]),deny);
 await assert.rejects(svc(grant,[randomUUID(),a.account,"noor-personal"]),deny);
 await assert.rejects(svc(audit,[randomUUID(),b.id,null,{accountId:a.account}]),deny);
 assert.equal((await pool.query("SELECT count(*) n FROM public.noor_sessions WHERE account_id=$1 AND revoked_at_epoch_ms IS NULL",[b.account])).rows[0].n,"1");
 console.log("R386_G1_IDENTITY_NON_REASSIGNMENT_AND_OTHER_OWNER_PASS");
 console.log("R386_G1_IDENTITY_FENCE_PASS");
}finally{await pool.end();}
