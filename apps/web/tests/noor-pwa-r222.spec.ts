import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";
const read=(file:string)=>readFileSync(new URL(file,import.meta.url),"utf8");
const manifest=JSON.parse(read("../public/noor.webmanifest"));
const html=read("../index.html");
const worker=read("../public/noor-service-worker.js");
const entry=read("../src/main.tsx");
const host=read("../../../tools/hosting/serve-noor.mjs");

test("R222 PWA has Arabic standalone manifest, root scope and Noor icon",()=>{
 assert.equal(manifest.lang,"ar");
 assert.equal(manifest.dir,"rtl");
 assert.equal(manifest.scope,"/");
 assert.equal(manifest.start_url,"/");
 assert.equal(manifest.display,"standalone");
 for (const size of [192,512]) assert.ok(manifest.icons.some((x:any)=>x.src===`/brand/icon-r352-${size}.png`&&x.type==="image/png"&&x.sizes===`${size}x${size}`));
 assert.match(html,/rel="apple-touch-icon" sizes="180x180" href="\/brand\/icon-r352-180\.png"/u);
 assert.match(html,/rel="manifest" href="\/noor\.webmanifest"/u);
 assert.match(html,/rel="apple-touch-icon"/u);
 assert.match(html,/lang="ar" dir="rtl"/u);
});
test("R222 service worker never caches journals, sessions or API responses",()=>{
 assert.doesNotMatch(worker,/\bcaches\.(?:open|match|delete)\b|indexedDB\.open|localStorage|sessionStorage|backgroundSync|pushManager/iu);
 assert.match(worker,/url\.pathname\.startsWith\("\/api\/"\)/u);
 assert.match(worker,/request\.method!=="GET"/u);
 assert.match(worker,/fetch\(request,\{cache:"no-store"\}\)/u);
 assert.match(worker,/status:503/u);
 assert.match(worker,/يلزم الاتصال بالإنترنت/u);
});
test("R222 registers service worker on production browser only and refreshes code safely",()=>{
 assert.match(entry,/\.env\?\.PROD/u);
 assert.match(entry,/navigator\.serviceWorker\.register\("\/noor-service-worker\.js"/u);
 assert.match(entry,/updateViaCache:"none"/u);
 assert.match(host,/\.webmanifest':'application\/manifest\+json'/u);
 assert.match(host,/pathname==='\/noor-service-worker\.js'/u);
 assert.match(host,/pathname==='\/noor\.webmanifest'/u);
});

test("Noor serves its own waiting page during a cold start and preserves normal navigation",async()=>{
 const workerEvents=new Map<string,(event:any)=>void>();
 let network:Promise<Response>;
 let deadline:()=>void=()=>{};
 runInNewContext(worker,{
   self:{location:{origin:"https://noor.example"},addEventListener:(event:string,callback:(event:any)=>void)=>workerEvents.set(event,callback)},
   URL,Response,fetch:()=>network,setTimeout:(callback:()=>void)=>{deadline=callback;},clearTimeout:()=>{},
 });
 const navigate=(path:string)=>{
   let response:Promise<Response>|undefined;
   workerEvents.get("fetch")!({request:{url:new URL(path,"https://noor.example").href,method:"GET",mode:"navigate"},respondWith:(value:Promise<Response>)=>{response=value;}});
   return response;
 };
 const app=new Response("Noor shell",{headers:{"X-Noor-App-Shell":"1"}});
 network=Promise.resolve(app);
 assert.equal(await navigate("/"),app);
 const render=new Response("Render waking");
 network=Promise.resolve(render);
 const fallback=await navigate("/noor-personal");
 assert.equal(fallback?.status,503);
 assert.match(await fallback!.text(),/جارٍ تشغيل منصة نور/);
 assert.equal(await navigate("/?code=callback"),render);
 assert.equal(navigate("/api/noor/personal/journal/status"),undefined);
 network=new Promise(()=>{});
 const slow=navigate("/");
 deadline();
 assert.equal((await slow)?.status,503);
});
