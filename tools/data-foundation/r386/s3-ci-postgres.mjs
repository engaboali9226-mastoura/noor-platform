// Isolated CI-only Docker transport. No managed credentials or remote target.
import {spawn,execFileSync} from "node:child_process";
export function createS3CiPostgres(name){
const base="noor-r386-"+process.env.GITHUB_RUN_ID+"-"+process.env.GITHUB_RUN_ATTEMPT;
if(process.env.GITHUB_ACTIONS!=="true"||!process.env.GITHUB_RUN_ID||
 ![base,base+"-runtime"].includes(name))throw Error("R386_S3_ISOLATION");
if(execFileSync("docker",["inspect","--format","{{.HostConfig.NetworkMode}}",name],{encoding:"utf8"}).trim()!=="none")throw Error("R386_S3_NETWORK_ISOLATION");
const literal=v=>"convert_from(decode('"+Buffer.from(v,"utf8").toString("base64")+"','base64'),'UTF8')";
const json=v=>literal(JSON.stringify(v))+"::jsonb";
const list=v=>"ARRAY["+v.map(literal).join(",")+"]::text[]";
const psql=sql=>new Promise((resolve,reject)=>{
 const child=spawn("docker",["exec","-i",name,"psql","-X","-qAt","-U","postgres","-d","postgres","-v","ON_ERROR_STOP=1"],{stdio:["pipe","pipe","pipe"]});
 let out="",err="";
 child.stdout.on("data",x=>out+=x);child.stderr.on("data",x=>err+=x);
 child.on("error",()=>reject(Error("R386_S3_SQL_TRANSPORT")));
 child.stdin.on("error",()=>{});
 child.on("close",code=>code===0?resolve(out.trim()):reject(Error("R386_S3_SQL_REJECTED:"+(err.match(/R386_[A-Z0-9_]+/)?.[0]??"UNKNOWN"))));
 child.stdin.end(sql+";\n");
});
const query=async sql=>JSON.parse(await psql(sql));
const database={
 lookup:(owner,request)=>query("SELECT noor_r386_candidate.s3_lookup("+literal(owner)+","+literal(request)+")"),
 load:owner=>query("SELECT noor_r386_candidate.s3_load("+literal(owner)+")"),
 commit:x=>query("SELECT noor_r386_candidate.s3_commit("+[literal(x.owner),literal(x.requestId),x.existed?"true":"false",String(x.expectedRevision),json(x.before),json(x.after),literal(x.keyId),literal(x.digest),json(x.fingerprints),list(x.deleteRefs)].join(",")+")")
};

return {database,psql,literal};
}
