/* Network-first and deliberately storage-free. The waiting document contains no account data. */
self.addEventListener("install",()=>{void self.skipWaiting();});
self.addEventListener("activate",event=>{event.waitUntil(self.clients.claim());});

const OFFLINE='<!doctype html><html lang="ar" dir="rtl"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="theme-color" content="#21384b"><title>نور — غير متصل</title><body style="font-family:system-ui;background:#f8f5ee;color:#21384b;margin:0;padding:2.5rem;text-align:center"><h1>نور</h1><p>يلزم الاتصال بالإنترنت للوصول إلى بياناتك بأمان.</p></body></html>';
const WAITING=`<!doctype html>
<html lang="ar" dir="rtl">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="theme-color" content="#dce8f4">
<title>نور — جارٍ التحميل</title>
<style>
*{box-sizing:border-box}
body{margin:0;min-height:100vh;min-height:100dvh;display:grid;place-items:center;padding:20px;font-family:system-ui,sans-serif;color:#193b5a;background:linear-gradient(155deg,#a9c7e7,#eaf2fa 64%,#fae8d7)}
main{text-align:center;width:min(100%,360px);padding:28px 20px;border:1px solid #fff;border-radius:24px;background:#f5f9fdd9;box-shadow:0 16px 40px #193b5a24}
h1{font-size:42px;line-height:1;margin:0;letter-spacing:.03em}
h1::after{content:"";display:block;width:46px;height:8px;margin:4px auto 0;border-bottom:4px solid #b67919;border-radius:50%}
p{margin:20px 0 0;line-height:1.6}
button{margin-top:16px;min-height:44px;padding:8px 16px;border:0;border-radius:12px;background:#27669f;color:white;font:inherit;cursor:pointer}
</style>
<main>
  <h1 dir="ltr">NOOR</h1>
  <p id="message" role="status">جارٍ تشغيل منصة نور…</p>
  <button id="retry" type="button" hidden>إعادة المحاولة</button>
  <noscript><p>أعد تحميل الصفحة بعد قليل.</p></noscript>
</main>
<script>
  const message=document.getElementById("message");
  const retry=document.getElementById("retry");
  let deadline=Date.now()+90000;
  async function check(){
    const controller=new AbortController();
    const timer=setTimeout(()=>controller.abort(),8000);
    try{
      const response=await fetch("/healthz",{method:"HEAD",cache:"no-store",redirect:"error",signal:controller.signal});
      if(response.ok&&response.headers.get("X-Noor-App-Shell")==="1"){location.reload();return;}
    }catch{}finally{clearTimeout(timer);}
    if(Date.now()<deadline){setTimeout(check,3500);return;}
    message.textContent="تعذّر الاتصال بنور الآن.";
    retry.hidden=false;
  }
  retry.addEventListener("click",()=>{
    retry.hidden=true;
    message.textContent="جارٍ تشغيل منصة نور…";
    deadline=Date.now()+90000;
    void check();
  });
  void check();
</script>
</html>`;
const APP_PATHS=new Set(["/","/noor-personal","/noor-personal/","/noor-work","/noor-work/"]);
let readyUntil=0;

function temporaryPage(html){
  return new Response(html,{status:503,headers:{
    "Content-Type":"text/html; charset=utf-8",
    "Cache-Control":"no-store",
    "X-Content-Type-Options":"nosniff",
    "Referrer-Policy":"no-referrer"
  }});
}

self.addEventListener("fetch",event=>{
  const request=event.request;
  const url=new URL(request.url);
  if(url.origin!==self.location.origin)return;
  if(url.pathname==="/healthz"&&request.method==="HEAD"){
    event.respondWith(fetch(request,{cache:"no-store"}).then(response=>{
      if(response.ok&&response.headers.get("X-Noor-App-Shell")==="1")readyUntil=Date.now()+45000;
      return response;
    }));
    return;
  }
  if(request.method!=="GET" ||
      url.pathname==="/api" || url.pathname.startsWith("/api/") ||
      url.pathname.startsWith("/auth/") || url.pathname.startsWith("/functions/"))return;
  if(request.mode!=="navigate")return;

  const network=fetch(request,{cache:"no-store"});
  if(!APP_PATHS.has(url.pathname)||url.search){
    event.respondWith(network.catch(()=>temporaryPage(OFFLINE)));
    return;
  }
  // Only ordinary entry routes can show the branded waiting page. API, login
  // callbacks with query parameters, and all assets retain their normal behavior.
  const navigation=network.then(response=>{
    const placeholder=response.ok&&!response.redirected&&response.headers.get("X-Noor-App-Shell")!=="1";
    return placeholder||[502,503,504].includes(response.status)?temporaryPage(WAITING):response;
  }).catch(()=>temporaryPage(WAITING));
  event.respondWith(new Promise(resolve=>{
    // Allow a slower full document response after a successful readiness probe.
    const timer=setTimeout(()=>resolve(temporaryPage(WAITING)),Date.now()<readyUntil?14000:1800);
    void navigation.then(response=>{clearTimeout(timer);resolve(response);});
  }));
});
