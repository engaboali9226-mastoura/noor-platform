import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { setTimeout as delay } from "node:timers/promises";
const require = createRequire((process.env.R386_G1_DEPENDENCY_ROOT || process.cwd()) + "/package.json");
const { Pool } = require("pg");
const {API_URL,DB_URL,SERVICE_ROLE_KEY} = JSON.parse(readFileSync(process.argv[2],"utf8"));
const api = new URL(API_URL), db = new URL(DB_URL);
assert.equal(api.protocol,"https:");
assert.equal(api.hostname,"127.0.0.1");
assert.equal(db.hostname,"127.0.0.1");
assert.equal(db.protocol,"postgresql:");
const fixture = spawnSync("psql",["-Xqw","-v","ON_ERROR_STOP=1","-f","tools/data-foundation/r386/g1-legacy-fence-fixture.sql"],{
  env:{...process.env,R386_G1_WRITER_PASSWORD:randomUUID(),PGHOST:db.hostname,PGPORT:db.port,
    PGDATABASE:decodeURIComponent(db.pathname.slice(1)),PGUSER:decodeURIComponent(db.username),
    PGPASSWORD:decodeURIComponent(db.password),PGSSLMODE:"disable"},encoding:"utf8"});
if(fixture.status!==0) {
  console.log("R386_G1_LEGACY_FIXTURE_FAILED=YES");
  throw new Error("Fixture installation failed");
}
const pool = new Pool({connectionString:DB_URL,max:6});
const tables = ["tasks","task_events","habits","habit_entries","noor_personal_foundations","noor_work_teacher_states_r264","noor_private_journal_entries_r221"];
const tombstone = "noor_r386_candidate.g1_owner_erasure_tombstone";
const denied = {code:"P0001",message:"R386_G1_LEGACY_ERASED_OWNER_DENIED"};
async function user(){
  const response=await fetch(api.origin+"/auth/v1/admin/users",{
    method:"POST",headers:{apikey:SERVICE_ROLE_KEY,Authorization:"Bearer "+SERVICE_ROLE_KEY,"Content-Type":"application/json"},
    body:JSON.stringify({email:randomUUID()+"@example.invalid",password:"Synthetic-"+randomUUID()+"-a1!",email_confirm:true})});
  assert.ok(response.ok,"Disposable Auth create failed");
  const {id}=await response.json();
  assert.match(id,/^[0-9a-f-]{36}$/);
  return id;
}
async function roleQuery(role,owner,query,params=[]){
  const c=await pool.connect();
  try{
    await c.query("BEGIN");
    assert.ok(["service_role","authenticated"].includes(role));
    await c.query("SET LOCAL ROLE "+role);
    if(role==="authenticated") await c.query("SELECT set_config('request.jwt.claim.sub',$1,true),set_config('request.jwt.claims',$2,true)",[owner,JSON.stringify({sub:owner,role})]);
    const result=await c.query(query,params);
    await c.query("COMMIT");
    return result;
  }finally{await c.query("ROLLBACK").catch(()=>{});c.release();}
}
function entries(owner){
  const task=randomUUID(), habit=randomUUID();
  return [
    ["tasks","INSERT INTO public.tasks VALUES($1,$2,'synthetic')",[task,owner],"user_id"],
    ["task_events","INSERT INTO public.task_events VALUES($1,$2,$3)",[randomUUID(),task,owner],"user_id"],
    ["habits","INSERT INTO public.habits VALUES($1,$2,'synthetic')",[habit,owner],"user_id"],
    ["habit_entries","INSERT INTO public.habit_entries VALUES($1,$2,$3)",[randomUUID(),habit,owner],"user_id"],
    ["noor_personal_foundations","INSERT INTO public.noor_personal_foundations(user_id,schema_version,revision,state) VALUES($1,1,1,'{}')",[owner],"user_id"],
    ["noor_work_teacher_states_r264","INSERT INTO public.noor_work_teacher_states_r264 VALUES($1,'{}')",[owner],"user_id"],
    ["noor_private_journal_entries_r221","INSERT INTO public.noor_private_journal_entries_r221 VALUES($1,$2,1,'synthetic','synthetic','synthetic')",[owner,randomUUID()],"owner_user_id"],
  ];
}
const update = (t,k) => "UPDATE public."+t+" SET "+k+"="+k+" WHERE "+k+"=$1";
const fence = (c,o) => c.query("INSERT INTO "+tombstone+"(owner_id) VALUES($1)",[o]);
async function waitBlocked(pid){
  for(let i=0;i<100;i++){
    const {rows}=await pool.query("SELECT wait_event_type,wait_event FROM pg_stat_activity WHERE pid=$1",[pid]);
    if(rows[0]?.wait_event_type==="Lock"&&rows[0]?.wait_event==="advisory")return;
    await delay(50);
  }
  throw new Error("R386_G1_LEGACY_RACE_NOT_BLOCKED");
}
async function race(owner,eraserFirst){
  const a=await pool.connect(),b=await pool.connect();
  let pending;
  try{
    await a.query("BEGIN");await b.query("BEGIN");
    await a.query("SET LOCAL statement_timeout='15s'");await b.query("SET LOCAL statement_timeout='15s'");
    const writer=eraserFirst?b:a, eraser=eraserFirst?a:b;
    const pid=(await b.query("SELECT pg_backend_pid() AS p")).rows[0].p;
    await writer.query("SET LOCAL ROLE service_role");
    const write=()=>writer.query("INSERT INTO public.tasks VALUES($1,$2,'race')",[randomUUID(),owner]);
    if(eraserFirst){
      await fence(eraser,owner);
      pending=write().then(v=>({v}),e=>({e}));
    }else{
      await write();
      pending=fence(eraser,owner).then(v=>({v}),e=>({e}));
    }
    await waitBlocked(pid);
    await a.query("COMMIT");
    const outcome=await pending;
    if(eraserFirst){assert.equal(outcome.e?.code,denied.code);assert.equal(outcome.e?.message,denied.message);await b.query("ROLLBACK");}
    else{
      assert.ok(!outcome.e,"Erasure fence failed");
      await eraser.query("DELETE FROM public.tasks WHERE user_id=$1",[owner]);await b.query("COMMIT");
    }
    assert.equal((await pool.query("SELECT count(*) AS n FROM public.tasks WHERE user_id=$1",[owner])).rows[0].n,"0");
  }finally{
    await a.query("ROLLBACK").catch(()=>{});await b.query("ROLLBACK").catch(()=>{});
    a.release();b.release();
  }
}
try {
  // Disposable-only parity grants: same seven legacy service stores, with
  // the four browser-writable tables restricted by their observed own-row policy.
  for (const t of tables) {
    await pool.query("ALTER TABLE public."+t+" ENABLE ROW LEVEL SECURITY");
    await pool.query("GRANT SELECT,INSERT"+(t==="noor_private_journal_entries_r221"?"":",UPDATE")+" ON public."+t+" TO service_role");
  }
  for(const t of tables.slice(0,4)){
    await pool.query("GRANT SELECT,INSERT,UPDATE ON public."+t+" TO authenticated");
    await pool.query("CREATE POLICY g1_probe_own ON public."+t+" FOR ALL TO authenticated USING(auth.uid()=user_id) WITH CHECK(auth.uid()=user_id)");
  }
  const target=await user(),other=await user();
  const targetRows=entries(target),otherRows=entries(other);
  for(const [,query,params] of [...targetRows,...otherRows]) assert.equal((await roleQuery("service_role",target,query,params)).rowCount,1);
  for(const [t,,,k] of targetRows.slice(0,4)){
    assert.equal((await roleQuery("authenticated",target,update(t,k),[target])).rowCount,1);
    assert.equal((await roleQuery("authenticated",target,update(t,k),[other])).rowCount,0);
  }
  console.log("R386_G1_LEGACY_ACTIVE_WRITES_AND_RLS_PASS");
  await assert.rejects(roleQuery("service_role",target,"UPDATE public.tasks SET user_id=$1 WHERE user_id=$2",[other,target]),{code:"P0001",message:"R386_G1_LEGACY_OWNER_CHANGE_DENIED"});
  const rr=await pool.connect();
  try{
    await rr.query("BEGIN ISOLATION LEVEL REPEATABLE READ");
    await assert.rejects(rr.query(update("tasks","user_id"),[other]),{code:"P0001",message:"R386_G1_LEGACY_WRITE_CONTEXT_DENIED"});
  }finally{await rr.query("ROLLBACK");rr.release();}
  await fence(pool,target);
  for(const [t,query,params,k] of targetRows){
    await assert.rejects(roleQuery("service_role",target,query,params),denied);
    if(t==="noor_private_journal_entries_r221")await assert.rejects(pool.query(update(t,k),[target]),denied);
    else await assert.rejects(roleQuery("service_role",target,update(t,k),[target]),denied);
  }
  for(const [t,query,params,k] of targetRows.slice(0,4)){
    await assert.rejects(roleQuery("authenticated",target,query,params),denied);
    await assert.rejects(roleQuery("authenticated",target,update(t,k),[target]),denied);
  }
  for(const [t,,,k] of otherRows) assert.equal((await pool.query("SELECT count(*) AS n FROM public."+t+" WHERE "+k+"=$1",[other])).rows[0].n,"1");
  assert.equal((await roleQuery("service_role",other,update("tasks","user_id"),[other])).rowCount,1);
  console.log("R386_G1_LEGACY_SEVEN_STORES_ERASED_OWNER_DENIED_PASS");
  for(const [t,,,k] of [...targetRows].reverse()) await pool.query("DELETE FROM public."+t+" WHERE "+k+"=$1",[target]);
  for(const [t,,,k] of targetRows)assert.equal((await pool.query("SELECT count(*) AS n FROM public."+t+" WHERE "+k+"=$1",[target])).rows[0].n,"0");
  console.log("R386_G1_LEGACY_DELETE_AND_OTHER_OWNER_PRESERVED_PASS");
  await race(await user(),true);
  await race(await user(),false);
  console.log("R386_G1_LEGACY_BOTH_COMMIT_ORDER_RACES_PASS");
  console.log("R386_G1_LEGACY_DIRECT_OWNER_FENCE_PASS");
}finally{await pool.end();}
