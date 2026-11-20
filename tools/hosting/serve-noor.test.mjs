import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {createHostedWebServer,validatePublicBuildEnvironment,publicReleaseCommit} from './serve-noor.mjs';
async function listen(server){await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));return server.address().port;}
async function close(server){await new Promise(resolve=>server.close(resolve));}
function request(port,url,{method='GET',headers={},body}={}){return new Promise((resolve,reject)=>{
 const outgoing=http.request({hostname:'127.0.0.1',port,path:url,method,headers},incoming=>{const chunks=[];incoming.on('data',chunk=>chunks.push(chunk));incoming.on('error',reject);incoming.on('end',()=>resolve({status:incoming.statusCode,headers:incoming.headers,body:Buffer.concat(chunks).toString()}));});outgoing.on('error',reject);outgoing.end(body);
});}
async function fixture(fn,options={}){
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'noor-hosting-fixture-')),site=path.join(dir,'site');await fs.mkdir(path.join(site,'assets'),{recursive:true});
 await fs.writeFile(path.join(site,'index.html'),'<html>NOOR synthetic shell</html>');await fs.writeFile(path.join(site,'assets/app-fixture.js'),'console.log("fixture");');
 const observed=[];
 const api=http.createServer((req,res)=>{const chunks=[];req.on('data',chunk=>chunks.push(chunk));req.on('end',()=>{
  observed.push({url:req.url,method:req.method,headers:req.headers,body:Buffer.concat(chunks).toString()});
  if(req.url==='/api/noor/session'){res.writeHead(204,{'Set-Cookie':'noor_session=fixture; HttpOnly; Secure; SameSite=Lax; Path=/api/noor'});res.end();}
  else{res.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end('{"fixture":true}');}
 });});
 const apiPort=await listen(api),server=await createHostedWebServer({staticDirectory:site,apiOrigin:`http://127.0.0.1:${apiPort}`,publicOrigin:'https://noor.example',releaseCommit:'A'.repeat(40),...options}),port=await listen(server);
 try{await fn({dir,site,api,port,observed});}finally{await close(server);if(api.listening)await close(api);await fs.rm(dir,{recursive:true,force:true});}
}
test('R291 healthz includes only validated commit fingerprint, no secrets or user data',()=>fixture(async({port,observed})=>{
 const get=await request(port,'/healthz');
 assert.equal(get.status,200);
 assert.equal(get.body,'ok');
 assert.equal(get.headers['cache-control'],'no-store');
 assert.equal(get.headers['x-noor-release-sha'],'a'.repeat(40));
 assert.equal(get.headers['set-cookie'],undefined);
 const head=await request(port,'/healthz',{method:'HEAD'});
 assert.equal(head.status,200);
 assert.equal(head.body,'');
 assert.equal(head.headers['x-noor-release-sha'],'a'.repeat(40));
 assert.equal(head.headers['x-noor-app-shell'],'1');
 const wrongMethod=await request(port,'/healthz',{method:'POST'});
 assert.equal(wrongMethod.status,405);
 assert.deepEqual(observed,[]);
}));
test('R291 release fingerprint rejects missing, malformed, secret-like and extended values',()=>{
 assert.equal(publicReleaseCommit('A'.repeat(40)),'a'.repeat(40));
 assert.equal(publicReleaseCommit('1234'),null);
 assert.equal(publicReleaseCommit('1234'+'.'.repeat(36)),null);
 assert.equal(publicReleaseCommit('a'.repeat(64)),null);
 assert.equal(publicReleaseCommit('a'.repeat(40)+'\\nX-User-Secret:value'),null);
 assert.equal(publicReleaseCommit(undefined),null);
});
test('serves the application and deep links without reading the API',()=>fixture(async({port,observed})=>{
 const root=await request(port,'/'),deep=await request(port,'/noor-personal/control',{headers:{accept:'text/html'}});
 assert.equal(root.status,200);assert.equal(root.headers['cache-control'],'no-store');assert.match(root.body,/synthetic shell/);assert.equal(deep.body,root.body);assert.equal(deep.headers['x-noor-app-shell'],'1');assert.deepEqual(observed,[]);
}));
test('serves assets with MIME, cache controls, and empty HEAD bodies',()=>fixture(async({port})=>{
 const asset=await request(port,'/assets/app-fixture.js'),head=await request(port,'/assets/app-fixture.js',{method:'HEAD'});
 assert.equal(asset.status,200);assert.match(asset.headers['content-type'],/javascript/);assert.match(asset.headers['cache-control'],/immutable/);assert.equal(head.body,'');assert.equal(head.headers['content-length'],asset.headers['content-length']);assert.equal((await request(port,'/missing.js')).status,404);
}));
test('forwards command body, method, cookie and Origin to the existing runtime',()=>fixture(async({port,observed})=>{
 const body='{"type":"synthetic-test-command"}',r=await request(port,'/api/noor/personal/command?fixture=1',{method:'POST',body,headers:{origin:'https://noor.example',cookie:'noor_session=fixture',host:'untrusted.example','content-type':'application/json'}});
 assert.equal(r.status,200);assert.deepEqual(JSON.parse(r.body),{fixture:true});assert.equal(observed.length,1);const q=observed[0];assert.equal(q.method,'POST');assert.equal(q.body,body);assert.equal(q.headers.cookie,'noor_session=fixture');assert.equal(q.headers.origin,'https://noor.example');assert.equal(q.headers.host,'noor.example');assert.match(q.url,/fixture=1/);
}));
test('preserves the runtime 204 and HttpOnly Secure session cookie',()=>fixture(async({port})=>{
 const r=await request(port,'/api/noor/session',{method:'POST',body:'{}'});assert.equal(r.status,204);assert.equal(r.body,'');assert.deepEqual(r.headers['set-cookie'],['noor_session=fixture; HttpOnly; Secure; SameSite=Lax; Path=/api/noor']);
}));
test('health checks and unsupported static methods do not access user data',()=>fixture(async({port,observed})=>{
 assert.equal((await request(port,'/healthz')).status,200);assert.equal((await request(port,'/healthz',{method:'POST'})).status,405);assert.equal((await request(port,'/',{method:'POST'})).status,405);assert.deepEqual(observed,[]);
}));
test('blocks dotfiles, decoded traversal and out-of-root symlinks',()=>fixture(async({dir,site,port})=>{
 await fs.writeFile(path.join(dir,'private.txt'),'PRIVATE_FIXTURE');await fs.symlink(path.join(dir,'private.txt'),path.join(site,'linked.txt'));
 for(const p of ['/.env','/.git/config','/%2f..%2fprivate.txt','/linked.txt']){const r=await request(port,p);assert.equal(r.status,403);assert.doesNotMatch(r.body,/PRIVATE_FIXTURE/);}assert.equal((await request(port,'/%ZZ')).status,400);
}));
test('returns bounded unavailable responses when the internal API is offline',()=>fixture(async({api,port})=>{
 await close(api);const r=await request(port,'/api/noor/personal/today',{method:'POST',body:'{}'});assert.equal(r.status,503);assert.doesNotMatch(r.body,/ECONN|127\.0\.0\.1|stack/);
}));
test('rejects external proxy targets and credential-bearing public origins',async()=>{
 await assert.rejects(()=>createHostedWebServer({staticDirectory:'.',apiOrigin:'http://example.com',publicOrigin:'https://noor.example'}),/INTERNAL_API/);
 await assert.rejects(()=>createHostedWebServer({staticDirectory:'.',apiOrigin:'http://127.0.0.1:8787',publicOrigin:'https://user:password@noor.example'}),/PUBLIC_ORIGIN/);
});
test('rejects service credentials in public build configuration',()=>{
 const env={VITE_NOOR_SUPABASE_URL:'https://fixture.supabase.co',VITE_NOOR_SUPABASE_PUBLISHABLE_KEY:'sb_publishable_fixture',SUPABASE_URL:'https://fixture.supabase.co'};
 assert.doesNotThrow(()=>validatePublicBuildEnvironment(env));assert.throws(()=>validatePublicBuildEnvironment({...env,VITE_NOOR_SUPABASE_PUBLISHABLE_KEY:'sb_secret_fixture'}),/PUBLIC_CONFIGURATION/);
 const token='e30.'+Buffer.from('{"role":"service_role"}').toString('base64url')+'.fixture';assert.throws(()=>validatePublicBuildEnvironment({...env,VITE_NOOR_SUPABASE_PUBLISHABLE_KEY:token}),/PUBLIC_CONFIGURATION/);assert.throws(()=>validatePublicBuildEnvironment({...env,SUPABASE_URL:'https://other.supabase.co'}),/AUTH_PROJECT_MISMATCH/);
});

test('username authentication keeps the resolved email and server key behind the hosting boundary', async () => {
 const {createUsernameLogin} = await import('./noor-username-login.mjs');
 const calls = [];
 const authenticate = createUsernameLogin({
  url:'https://auth.example', serverKey:'fixture-server', publishableKey:'fixture-public',
  request:async (url,init)=>{
   calls.push({url,init});
   return url.pathname.endsWith('/noor_username_login_email_r327')
    ? Response.json('signed-in@example.test')
    : Response.json({access_token:'fixture-proof',refresh_token:'never-returned'});
  },
 });
 assert.deepEqual(await authenticate('signed-in','fixture-password'),{status:200,proof:'fixture-proof'});
 assert.equal(calls[0].init.headers.apikey,'fixture-server');
 assert.equal(calls[1].init.headers.apikey,'fixture-public');
 assert.equal(JSON.parse(calls[1].init.body).email,'signed-in@example.test');
});

test('unknown username receives the same invalid result and still goes through password authentication', async () => {
 const {createUsernameLogin} = await import('./noor-username-login.mjs');
 let attemptedEmail;
 const authenticate = createUsernameLogin({
  url:'https://auth.example',serverKey:'fixture-server',publishableKey:'fixture-public',
  request:async (url,init)=>{
   if(url.pathname.startsWith('/rest/')) return Response.json(null);
   attemptedEmail=JSON.parse(init.body).email;
   return new Response(null,{status:400});
  },
 });
 assert.deepEqual(await authenticate('missing','fixture-password'),{status:401});
 assert.match(attemptedEmail,/@invalid\.example$/u);
});

test('R381 public history route isolates account traffic and validates methods',()=>fixture(async({port,observed})=>{
 const good=await request(port,'/api/noor/public-history/day?calendar=gregorian&month=11&day=20',{headers:{cookie:'noor_session=fixture'}});
 assert.equal(good.status,200);assert.deepEqual(JSON.parse(good.body),{status:'ok',events:[]});
 assert.equal(good.headers['cache-control'],'public, max-age=3600');
 assert.equal(good.headers['set-cookie'],undefined);
 assert.equal((await request(port,'/api/noor/public-history/day?calendar=gregorian&month=2&day=30')).status,400);
 assert.equal((await request(port,'/api/noor/public-history/day?calendar=hijri&month=1&day=1',{method:'POST'})).status,405);
 assert.deepEqual(observed,[]);
},{historyDay:async(calendar,month,day)=>({status:calendar==='gregorian'&&month===11&&day===20?'ok':'invalid',events:[]})}));

test('R381 Arabic calendar parser excludes births and ordinary personal events, preserves source date and deduplicates',async()=>{
 const {parseHistoryDay,validHistoryDay}=await import('./noor-history-r381.mjs');
 const wikitext='== أحداث ==\n* [[1917]] - [[معركة كامبراي]] تبدأ في فرنسا.\n* [[1917]] - [[معركة كامبراي]] تبدأ في فرنسا.\n* [[1945]] - بدء [[محاكمات نورمبرغ]] بعد الحرب العالمية الثانية.\n* [[1947]] - حفل زفاف في لندن.\n== مواليد ==\n* 1901 - عالم اكتشف قانونا.\n== وفيات ==\n* 1910 - قائد حرب.';
 const rows=parseHistoryDay({calendar:'gregorian',month:11,day:20,wikitext,revision:123});
 assert.equal(rows.length,2);assert.equal(rows[0].title,'معركة كامبراي');assert.equal(rows[0].year,1917);assert.match(rows[0].sourceUrl,/oldid=123/);
 assert.equal(rows[0].license,'CC BY-SA 4.0');
 const hijri=parseHistoryDay({calendar:'hijri',month:6,day:10,wikitext:'== أحداث ==\n* [[٣٦ هـ]] - وقعت [[معركة الجمل]] في البصرة.\n* [[١٣٣١ هـ]] -\n** توقيع [[معاهدة سلام]] بين دولتين.\n== وفيات ==\n* 900 هـ - وفاة قائد حرب.'});
 assert.deepEqual(hijri.map(r=>[r.calendar,r.year,r.month,r.day]),[['hijri',36,6,10],['hijri',1331,6,10]]);
 assert.equal(validHistoryDay('gregorian',2,30),false);assert.equal(validHistoryDay('hijri',12,30),true);
});
test('R381 public history coalesces requests, enriches Wikidata IDs, and retains stale data on upstream failure',async()=>{
 const {createHistoryEngine}=await import('./noor-history-r381.mjs');
 let calls=0,at=0,fail=false;
 const get=createHistoryEngine({now:()=>at,request:async(url,options)=>{
  calls++;assert.equal(url.hostname,'ar.wikipedia.org');assert.match(options.headers['User-Agent'],/NOOR/);
  if(fail)return new Response('{}',{status:503});
  if(url.searchParams.get('action')==='parse')return Response.json({parse:{revid:1,wikitext:'== أحداث ==\n* 1917 - [[معركة كامبراي]] تبدأ في فرنسا.'}});
  return Response.json({query:{pages:[{title:'معركة كامبراي',pageprops:{wikibase_item:'Q123'}}]}});
 }});
 const [a,b]=await Promise.all([get('gregorian',11,20),get('gregorian',11,20)]);
 assert.equal(calls,2);assert.deepEqual(a,b);assert.equal(a.events[0].wikidataUrl,'https://www.wikidata.org/wiki/Q123');
 await get('gregorian',11,20);assert.equal(calls,2);
 at+=25*3600000;fail=true;
 const stale=await get('gregorian',11,20);assert.equal(stale.status,'stale');assert.deepEqual(stale.events,a.events);
 assert.equal((await get('gregorian',11,21)).status,'unavailable');
 assert.equal((await get('x',1,1)).status,'invalid');
});
