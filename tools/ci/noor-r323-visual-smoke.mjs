// Browser evidence for R323, using the actual React components and a disposable fixture.
import {readFile,writeFile,mkdir,rm,mkdtemp} from "node:fs/promises";
import {spawn} from "node:child_process";
import {tmpdir} from "node:os";
import {resolve} from "node:path";
import assert from "node:assert/strict";
const web=resolve("apps/web"),htmlFile=resolve(web,"__r323_visual_fixture.html"),scriptFile=resolve(web,"__r323_visual_fixture.tsx");
const output=resolve("r323-visual-evidence"),profile=await mkdtemp(resolve(tmpdir(),"noor-visual-"));
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
let vite,chrome,socket;
const wait=async(fn,ms=45000)=>{const end=Date.now()+ms;let last;while(Date.now()<end){try{const r=await fn();if(r)return r;}catch(e){last=e;}await sleep(200);}throw Error("Timed out: "+String(last??"condition not met"));};
try{
 await mkdir(output,{recursive:true});
 const original=await readFile(resolve(web,"index.html"),"utf8");
 const main=await readFile(resolve(web,"src/main.tsx"),"utf8");
 const styles=main.split("\n").filter(l=>/^import "\.\/[^"]+\.css";/.test(l.trim())).map(l=>l.replace('"./','"./src/')).join("\n");
 assert.match(styles,/noor-approved-r323\.css/);
 const tests=await readFile(resolve(web,"tests/noor-personal-application-view.spec.ts"),"utf8");
 const start=tests.indexOf("const futurePrayerAt=");
 const end=tests.indexOf('test("R287 regression',start);
 assert.ok(start>=0&&end>start);
 const fixture=tests.slice(start,end).replaceAll("2026-10-24","2026-11-06").replaceAll("2026-10-25","2026-11-06").replaceAll("2026-10-26","2026-11-07");
 assert.match(fixture,/const workspace=/);
 const html=original.replace(/<script\b[^>]*type=["']module["'][^>]*>[\s\S]*?<\/script>/g,"").replace("</body>",'<script type="module" src="/__r323_visual_fixture.tsx"></script></body>');
 await writeFile(htmlFile,html);
 const setup=[
 'import React from "react";',
 'import {createRoot} from "react-dom/client";',
 'import {NoorAdminMfaPageR315} from "./src/noor-admin-mfa-page-r315";',
 'import {PlatformShell} from "./src/platform-shell";',
 'import {NoorPersonalApplicationView} from "./src/noor-personal-application-view";',
 'const fixtureParams=new URLSearchParams(location.search);',
 'const fixtureDay=fixtureParams.get("daylight")==="day";',
 'Date.now=()=>Date.parse(fixtureDay?"2026-11-06T08:02:00Z":"2026-11-06T18:02:00Z");',
 'window.fetch=async()=>new Response(JSON.stringify({current:{temperature_2m:22,uv_index:3,wind_speed_10m:8,wind_direction_10m:140,precipitation:0,weather_code:fixtureParams.get("weather")==="unknown"?undefined:({partly:2,cloudy:3,fog:45,precipitation:61} as Record<string,number>)[fixtureParams.get("weather")??""]??0,is_day:fixtureDay?1:0}}),{status:200,headers:{"Content-Type":"application/json"}});'
 ].join("\n");
 const render=[
 'const root=createRoot(document.getElementById("root")!);',
 'const isLogin=new URLSearchParams(location.search).get("screen")==="login";',
 'const isSelector=new URLSearchParams(location.search).get("screen")==="selector";',
 'const setupFactor=new URLSearchParams(location.search).get("factor")==="new";',
 'import {applyAppearance,readAppearance} from "./src/appearance-preference-store";',
 'applyAppearance(readAppearance());',
 'const accountService={requestPasswordReset:async(email:string)=>email==="unavailable@example.test"?"unavailable" as const:"sent" as const,registerPendingAccount:async(email:string)=>email==="unavailable@example.test"?"unavailable" as const:"sent" as const,completePasswordRecovery:async(password:string)=>password==="ExpiredFixture!"?"invalid" as const:"updated" as const,requestEmailChange:async()=>"sent" as const};',
 'const appointments=[{id:"visual-appointment-1",kind:"Task",title:"اجتماع فريق العمل",state:"Active",category:"العمل",schedule:{kind:"Daily"},effectiveFromDate:"2026-11-06",importance:"Important",countdownPlan:{kind:"appointment",date:"2026-11-07",time:"15:00"}},{id:"visual-appointment-2",kind:"Task",title:"موعد طبي",state:"Active",category:"الصحة",schedule:{kind:"Daily"},effectiveFromDate:"2026-11-06",importance:"Important",countdownPlan:{kind:"appointment",date:"2026-11-08",time:"10:00"}}];',
 'const previewReading=fixtureParams.get("task-preview")==="1";',
 'const previewDefinitions=workspace.workspace.definitions.map(d=>previewReading&&d.id==="d1"?{...d,title:"أمة الدوبامين",revisionId:"preview-reading",measurement:{target:310,unit:"صفحة"},sessionPlan:{distribution:"custom",sessions:[{id:"preview-session",title:"الجلسة الحالية",objective:"قراءة 16 صفحة",target:16,rangeStart:129,rangeEnd:144,scheduledDate:"2026-11-06",order:1,note:"",revision:0,createdAt:"2026-11-06T00:00:00Z",updatedAt:"2026-11-06T00:00:00Z",completedAt:null}]},activityLog:[{id:"preview-progress",executionId:"e1",localDate:"2026-11-06",at:"2026-11-06T12:00:00Z",amount:128,note:"",endReason:null}]}:d);',
 'const adminService={signIn:async()=>setupFactor?"enroll-needed" as const:"challenge-needed" as const,enroll:async()=>({factorId:"fixture",qrSvg:`<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect width="100" height="100"/></svg>`,secret:"TEST-KEY"}),verify:async(code:string)=>code==="123456"?"aal2" as const:"invalid" as const,accessToken:async()=>null,signOut:async()=>{}};',
 'root.render(new URLSearchParams(location.search).get("screen")==="admin"?<NoorAdminMfaPageR315 createMfa={()=>adminService} createRecovery={()=>({send:async(email:string)=>email==="failed@example.test"?"unavailable":"sent",complete:async(password:string)=>password==="ExpiredFixturePass!"?"invalid":"updated"})}/>:(isLogin||isSelector)?<PlatformShell state={{kind:"no-application-selected"}} navigate={path=>{Object.assign(window,{pickerDestination:path});}} signIn={async()=>{}} authenticationState={isSelector?"authenticated":"idle"} accountService={accountService}/>:<NoorPersonalApplicationView initialResult={{...today,today:{...today.today,tasks:today.today.tasks.map(task=>previewReading?{...task,title:"أمة الدوبامين"}:task),habits:today.today.habits.map(h=>({...h,status:"Completed"}))}} as any} initialWorkspace={{...workspace,workspace:{...workspace.workspace,definitions:[...previewDefinitions,...appointments]}} as any}/>);'
 ].join("\n");
 await writeFile(scriptFile,[styles,setup,fixture,render].join("\n"));
 vite=spawn("npm",["--workspace","apps/web","run","dev","--","--host","127.0.0.1","--port","5179","--strictPort"],{stdio:"inherit",env:{...process.env,VITE_NOOR_SUPABASE_URL:"http://127.0.0.1:54321",VITE_NOOR_SUPABASE_PUBLISHABLE_KEY:"sb_publishable_noor_browser_fixture"}});
 const url="http://127.0.0.1:5179/__r323_visual_fixture.html";
 await wait(async()=> (await fetch(url)).ok);
 chrome=spawn(process.env.CHROME_BIN||"google-chrome",["--headless","--no-sandbox","--disable-dev-shm-usage","--disable-gpu","--no-first-run","--remote-debugging-port=9222","--user-data-dir="+profile,"about:blank"],{stdio:["ignore","ignore","ignore"]});
 const tab=await wait(async()=>{const r=await fetch("http://127.0.0.1:9222/json/list");const t=await r.json();return t.find(x=>x.type==="page");});
 socket=new WebSocket(tab.webSocketDebuggerUrl);await new Promise((r,j)=>{socket.addEventListener("open",r,{once:true});socket.addEventListener("error",j,{once:true});});
 let id=0;const pending=new Map();
 socket.addEventListener("message",event=>{const m=JSON.parse(event.data);if(m.id&&pending.has(m.id)){const [r,j]=pending.get(m.id);pending.delete(m.id);m.error?j(Error(JSON.stringify(m.error))):r(m.result);}});
 const cdp=(method,params={})=>new Promise((r,j)=>{const n=++id;pending.set(n,[r,j]);socket.send(JSON.stringify({id:n,method,params}));});
 await cdp("Page.enable");
 await cdp("Page.bringToFront");
 await cdp("Emulation.setFocusEmulationEnabled", {enabled:true});
 const run=async(expression)=>{const r=await cdp("Runtime.evaluate",{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value;};
 const find=sel=>wait(()=>run("!!document.querySelector("+JSON.stringify(sel)+")"));
 const snap=async(name)=>{await sleep(250);const r=await cdp("Page.captureScreenshot",{format:"png",captureBeyondViewport:false});await writeFile(resolve(output,name+".png"),Buffer.from(r.data,"base64"));};
 const expect=async(expression,message)=>{await wait(()=>run(expression),5000).catch(()=>{throw Error(message);});};
 const visible=sel=>"(!!document.querySelector("+JSON.stringify(sel)+")&&document.querySelector("+JSON.stringify(sel)+").getBoundingClientRect().height>0)";
 const report=[];
 for(const screen of [{name:"iphone-viewport",width:390,height:844,mobile:true},{name:"desktop-viewport",width:1440,height:900,mobile:false}]){
  await cdp("Emulation.setDeviceMetricsOverride",{width:screen.width,height:screen.height,deviceScaleFactor:1,mobile:screen.mobile});
  await cdp("Page.navigate",{url:url+"?screen=login"});
  await find(".noor-r323-auth-card");
  await expect("document.documentElement.scrollWidth<=innerWidth+1","Login horizontal overflow");
  await expect("!document.querySelector('.noor-auth-switch-r312')","Account tabs are absent");
  await expect("document.querySelector('.noor-login-wordmark').textContent==='NOOR Platform'","Platform branding");
  await expect("document.querySelector('.noor-r322-admin-entry').getBoundingClientRect().bottom<=innerHeight","Login controls fit without scrolling");
  await expect(`(() => {
    const card = document.querySelector('.noor-r332-auth').getBoundingClientRect();
    const brand = document.querySelector('.noor-login-brand').getBoundingClientRect();
    const field = document.querySelector('input[name=email]').getBoundingClientRect();
    const wordmark = document.querySelector('.noor-login-wordmark').getBoundingClientRect();
    const tagline = document.querySelector('.noor-login-tagline').getBoundingClientRect();
    return Math.abs((card.top + card.bottom) / 2 - innerHeight / 2) <= 4
      && brand.bottom <= card.top + 1 && field.height >= 48 && wordmark.width >= tagline.width * 1.15;
  })()`,"Login card is centered, with full-size fields and a shorter tagline");
  await expect("document.querySelector('.noor-login-field input') && parseFloat(getComputedStyle(document.querySelector('.noor-login-field input')).fontSize)>=16","Login input does not trigger iOS auto zoom");
  await expect("document.querySelector('.noor-login-brand img').naturalWidth>0&&getComputedStyle(document.querySelector('.noor-welcome-ambient'),'::before').backgroundImage.includes('/brand/login-glass-header.webp')","Approved calligraphy and glass background");
  await run("document.querySelector('input[name=email]').focus()");
  const focusState = () => run(`(() => {
    const input = document.querySelector('input[name=email]');
    const style = getComputedStyle(input);
    return {active: document.activeElement === input, pageFocused: document.hasFocus(), matchesFocus: input.matches(":focus"), border: style.borderTopWidth,
      radius: style.borderTopLeftRadius, outline: style.outlineStyle, outlineWidth: style.outlineWidth, labelRing: getComputedStyle(input.parentElement).boxShadow};
  })()`);
  await wait(async () => {
    const focus = await focusState();
    return focus.active && focus.border === '1px' && focus.radius === '10px'
      && focus.outline === 'solid' && focus.outlineWidth === '2px' && focus.labelRing === 'none';
  }, 5000).catch(async () => {
    throw Error("Only the rounded field shows its focus ring: " + JSON.stringify(await focusState()));
  });
  await run("document.querySelector('.noor-r328-password-toggle').click()");
  await expect("document.querySelector('input[name=password]').type==='text'","Password visibility works");
  await run("document.querySelector('.noor-r328-password-toggle').click()");
  await expect("document.querySelector('input[name=password]').type==='password'","Password can be concealed");
  await run("document.activeElement.blur()");
  await snap(screen.name+"-login");
  await cdp("Page.navigate",{url:url+"?screen=selector"});
  await find(".noor-space-option");
  await expect(`(() => {
   const main = document.querySelector('main[data-auth-mode=picker]');
   const cards = [...main.querySelectorAll('.noor-space-option')];
   const [personal, work] = cards.map(card => card.getBoundingClientRect());
   const panel = main.querySelector('.noor-r332-auth').getBoundingClientRect();
   return cards.length === 2 && main.querySelector('.noor-login-brand img').naturalWidth > 0
    && cards.map(card => card.querySelector('strong').textContent.trim()).join(',') === 'Noor Personal,Noor Work'
    && cards.every(card => card.querySelector('img').naturalWidth > 0 && card.querySelector('img').clientWidth === 42)
    && cards.map(card => card.getAttribute('href')).join(',') === '/personal,/work'
    && Math.abs((panel.top + panel.bottom) / 2 - innerHeight / 2) <= 4
    && document.documentElement.scrollWidth <= innerWidth
    && (innerWidth > 600 ? Math.abs(personal.top - work.top) < 1 && work.right < personal.left
     : personal.bottom < work.top) && work.bottom <= innerHeight
    && main.querySelector('.noor-r322-admin-entry').getBoundingClientRect().bottom <= innerHeight;
  })()`,"Personal and Work match the approved artwork, centered layout, labels and compact logos");
  for(const path of ["/personal","/work"]){
   await run(`document.querySelector('.noor-space-option[href="${path}"]').click()`);
   await expect(`window.pickerDestination===${JSON.stringify(path)}`,"Workspace card opens its existing destination");
  }
  await snap(screen.name+"-selector");
  await run("(()=>{const s=document.querySelector('[aria-label=\\\"اختيار ألوان المنصة\\\"]');s.value='beige';s.dispatchEvent(new Event('change',{bubbles:true}))})()");
  await expect("document.documentElement.dataset.noorAppearance==='beige'&&localStorage.getItem('noor:appearance:v1')==='beige'","Beige selection applied and persisted");
  await snap(screen.name+"-selector-beige");
  await run("(()=>{const s=document.querySelector('[aria-label=\\\"اختيار ألوان المنصة\\\"]');s.value='blue';s.dispatchEvent(new Event('change',{bubbles:true}))})()");
  await expect("document.documentElement.dataset.noorAppearance==='blue'","Blue palette restored");
  await cdp("Page.navigate",{url:url+"?screen=login"});
  await find(".noor-r323-auth-card");
  await run("document.querySelector('.noor-r322-secondary-actions button').click()");
  await find("input[name=name]");
  await expect(`(() => {
    const card = document.querySelector('.noor-r332-auth').getBoundingClientRect();
    const admin = document.querySelector('.noor-r322-admin-entry').getBoundingClientRect();
    const wordmark = document.querySelector('.noor-login-wordmark').getBoundingClientRect();
    const tagline = document.querySelector('.noor-login-tagline');
    const artwork = getComputedStyle(document.querySelector('.noor-welcome-ambient'), '::before').backgroundImage;
    return document.querySelector('main').dataset.authMode === 'register'
      && document.querySelector('.noor-login-brand img').naturalWidth > 0
      && artwork.includes('/brand/login-glass-header.webp')
      && parseFloat(getComputedStyle(tagline).fontWeight) >= 700
      && wordmark.width >= tagline.getBoundingClientRect().width * 1.15
      && !document.querySelector('.noor-auth-hint-r312, .noor-account-request-receipt')
      && document.documentElement.scrollWidth <= innerWidth + 1
      && Math.abs((card.top + card.bottom) / 2 - innerHeight / 2) <= 4
      && admin.bottom <= innerHeight;
  })()`,"Registration matches the centered shared artwork with a shorter, stronger tagline");
  await expect("document.querySelectorAll('.noor-login-field input').length===4&&Array.from(document.querySelectorAll('.noor-login-field input')).every(i=>parseFloat(getComputedStyle(i).fontSize)>=16&&i.getBoundingClientRect().height>=48)","All four registration fields fit without mobile auto zoom");
  await snap(screen.name+"-registration");
  const submitRegistration = email => run(`(() => {
    const form = document.querySelector('.noor-welcome-form');
    form.elements.name.value = 'نور تجريبي';
    form.elements.email.value = ${JSON.stringify(email)};
    form.elements.password.value = 'fixture-password';
    form.elements.passwordConfirm.value = 'fixture-password';
    form.querySelector('[type=submit]').focus();
    form.requestSubmit();
  })()`);
  await submitRegistration("unavailable@example.test");
  await expect("document.querySelector('.noor-welcome-error')&&!document.querySelector('.noor-account-request-receipt')&&document.querySelector('input[name=email]').value==='unavailable@example.test'","Failed request keeps the form values and shows no receipt");
  await submitRegistration("registration@example.test");
  await expect(`(() => {
    const receipt = document.querySelector('.noor-account-request-receipt:modal');
    if (!receipt) return false;
    const bounds = receipt.getBoundingClientRect();
    return receipt.querySelector('h2').textContent === 'تم استلام طلب التسجيل'
      && receipt.contains(document.activeElement) && bounds.left >= 0 && bounds.top >= 0
      && bounds.right <= innerWidth && bounds.bottom <= innerHeight
      && Array.from(document.querySelectorAll('.noor-welcome-form input')).every(input => !input.value)
      && !document.querySelector('.noor-auth-success-r312');
  })()`,"Successful request opens a focused, in-viewport receipt and clears the submitted form");
  await snap(screen.name+"-registration-receipt");
  if (screen.mobile) {
   await cdp("Input.dispatchKeyEvent",{type:"keyDown",key:"Escape",code:"Escape",windowsVirtualKeyCode:27});
   await cdp("Input.dispatchKeyEvent",{type:"keyUp",key:"Escape",code:"Escape",windowsVirtualKeyCode:27});
   await expect("!document.querySelector('.noor-account-request-receipt')&&document.querySelector('main').dataset.authMode==='register'","Escape dismisses the receipt and stays on registration");
   await submitRegistration("registration@example.test");
   await find(".noor-account-request-receipt:modal");
  }
  await run("document.querySelector('.noor-account-request-receipt-return').click()");
  await expect("document.querySelector('main').dataset.authMode==='login'&&!document.querySelector('.noor-account-request-receipt')","Receipt returns to the login view");
  await run("document.querySelector('.noor-auth-forgot').click()");
  await expect(`(() => {
    const email = document.querySelector('.noor-login-field input');
    const card = document.querySelector('.noor-r332-auth').getBoundingClientRect();
    const wordmark = document.querySelector('.noor-login-wordmark').getBoundingClientRect();
    const tagline = document.querySelector('.noor-login-tagline');
    const artwork = getComputedStyle(document.querySelector('.noor-welcome-ambient'), '::before').backgroundImage;
    return document.querySelector('main').dataset.authMode === 'reset'
      && document.querySelector('h1').textContent === 'استعادة كلمة المرور'
      && document.querySelector('.noor-login-brand img').naturalWidth > 0
      && artwork.includes('/brand/login-glass-header.webp')
      && document.querySelectorAll('.noor-welcome-form input').length === 1
      && email?.type === 'email' && parseFloat(getComputedStyle(email).fontSize) >= 16
      && wordmark.width >= tagline.getBoundingClientRect().width * 1.15
      && parseFloat(getComputedStyle(tagline).fontWeight) >= 700
      && !document.querySelector('.noor-account-request-receipt, .noor-auth-success-r312, .noor-welcome-description')
      && document.documentElement.scrollWidth <= innerWidth + 1
      && Math.abs((card.top + card.bottom) / 2 - innerHeight / 2) <= 4
      && document.querySelector('.noor-r322-admin-entry').getBoundingClientRect().bottom <= innerHeight;
  })()`,"Password reset matches the centered glass artwork with a single email field");
  await snap(screen.name+"-recovery");

  const submitReset = email => run(`(() => {
    const form = document.querySelector('.noor-welcome-form');
    form.elements.email.value = ${JSON.stringify(email)};
    form.querySelector('[type=submit]').focus();
    form.requestSubmit();
  })()`);
  await submitReset("unavailable@example.test");
  await expect("document.querySelector('.noor-welcome-error')&&!document.querySelector('.noor-account-request-receipt')&&document.querySelector('input[name=email]').value==='unavailable@example.test'","Failed reset displays the error and retains the email for retry");
  await submitReset("account@example.test");
  await expect(`(() => {
    const receipt = document.querySelector('.noor-account-request-receipt:modal');
    if (!receipt) return false;
    const bounds = receipt.getBoundingClientRect();
    return receipt.querySelector('h2').textContent === 'تم استلام طلب الاستعادة'
      && receipt.textContent.includes('إذا كان البريد مرتبطًا بحساب')
      && !receipt.textContent.includes('account@example.test')
      && receipt.contains(document.activeElement)
      && bounds.left >= 0 && bounds.top >= 0 && bounds.right <= innerWidth && bounds.bottom <= innerHeight
      && !document.querySelector('input[name=email]').value
      && !document.querySelector('.noor-auth-success-r312');
  })()`,"Successful reset opens a focused receipt with conditional copy and clears the email");
  await snap(screen.name+"-recovery-receipt");
  if(screen.mobile){
   await run("document.querySelector('.noor-account-request-receipt-close').click()");
   await expect("!document.querySelector('.noor-account-request-receipt')&&document.querySelector('main').dataset.authMode==='reset'","The close button dismisses the receipt and leaves the reset form visible");
   await cdp("Emulation.setDeviceMetricsOverride",{width:390,height:480,deviceScaleFactor:1,mobile:true});
   await run("document.querySelector('input[name=email]').focus()");
   await expect("document.activeElement.getBoundingClientRect().bottom<=visualViewport.height&&visualViewport.scale===1&&document.querySelector('.noor-auth-return-r312').getBoundingClientRect().bottom<=visualViewport.height","Recovery controls fit the reduced mobile viewport");
   await submitReset("account@example.test");
   await find(".noor-account-request-receipt:modal");
  }
  await run("document.querySelector('.noor-account-request-receipt-return').click()");
  await expect("document.querySelector('main').dataset.authMode==='login'&&!document.querySelector('.noor-account-request-receipt')","Reset receipt returns to the login view");

  if(screen.mobile)await cdp("Emulation.setDeviceMetricsOverride",{width:screen.width,height:screen.height,mobile:true,deviceScaleFactor:1});
  await cdp("Page.navigate",{url:url+"?screen=login&auth=recovery"});
  await find('main[data-auth-mode="recovery"] input[name=passwordConfirm]');
  await expect(`(() => {
    const card = document.querySelector('.noor-r332-auth').getBoundingClientRect();
    const fields = [...document.querySelectorAll('.noor-login-field input')];
    return document.querySelector('h1').textContent.trim() === 'تعيين كلمة مرور جديدة'
      && document.querySelector('.noor-login-brand img').naturalWidth > 0
      && Math.abs((card.top + card.bottom) / 2 - innerHeight / 2) <= 4
      && fields.length === 2 && fields.every(input => input.type === 'password'
        && input.autocomplete === 'new-password' && input.minLength === 8
        && parseFloat(getComputedStyle(input).fontSize) >= 16)
      && !document.querySelector('.noor-account-request-receipt, .noor-welcome-description');
  })()`,"Recovery callback matches the approved two-field layout");
  await snap(screen.name+"-new-password");
  const submitNewPassword = (password, confirmation) => run(`(() => {
    const form = document.querySelector('form');
    form.elements.password.value = ${JSON.stringify(password)};
    form.elements.passwordConfirm.value = ${JSON.stringify(confirmation)};
    form.requestSubmit();
  })()`);
  await submitNewPassword("ValidFixturePass!","DifferentFixturePass!");
  await expect("document.querySelector('.noor-welcome-error')?.textContent.includes('غير متطابقتين')&&!document.querySelector('dialog')","Password confirmation is checked");
  await submitNewPassword("ExpiredFixture!","ExpiredFixture!");
  await expect("document.querySelector('.noor-welcome-error')?.textContent.includes('رابط الاستعادة غير صالح')&&!document.querySelector('dialog')","Expired links can be retried without a success receipt");
  await submitNewPassword("ValidFixturePass!","ValidFixturePass!");
  await find(".noor-account-request-receipt:modal");
  await expect(`(() => {
    const dialog = document.querySelector('.noor-account-request-receipt');
    const box = dialog.getBoundingClientRect();
    return document.querySelector('main').dataset.authMode === 'login'
      && location.pathname === '/' && !location.search && !location.hash
      && !document.querySelector('input[name=password]').value
      && dialog.querySelector('h2').textContent === 'تم تغيير كلمة المرور'
      && document.activeElement === dialog.querySelector('.noor-account-request-receipt-return')
      && box.top >= 0 && box.bottom <= visualViewport.height;
  })()`,"A successful password update clears the fields and opens confirmation over login");
  await snap(screen.name+"-new-password-receipt");
  await run("document.querySelector('.noor-account-request-receipt-return').click()");
  await expect("document.querySelector('main').dataset.authMode==='login'&&!document.querySelector('.noor-account-request-receipt')","Password confirmation closes on sign-in");
  if(screen.mobile){
   await cdp("Emulation.setDeviceMetricsOverride",{width:390,height:480,mobile:true,deviceScaleFactor:1});
   await run("document.querySelector('input[name=email]').focus()");
   await expect("document.activeElement.getBoundingClientRect().bottom<=visualViewport.height&&visualViewport.scale===1","Focused field fits the reduced mobile viewport");
   await expect("document.querySelector('.noor-r322-admin-entry').getBoundingClientRect().bottom<=visualViewport.height","Login controls fit the reduced mobile viewport");
   await snap(screen.name+"-focused");
   await cdp("Emulation.setDeviceMetricsOverride",{width:screen.width,height:screen.height,deviceScaleFactor:1,mobile:true});
  }
  await cdp("Page.navigate",{url:url+"?screen=admin"});
  await find(".noor-admin-entry-panel input[name=email]");
  const checkAdminLayout = (mode, fields) => expect(`(() => {
    const main = document.querySelector('main');
    const card = main.querySelector('.noor-r332-auth').getBoundingClientRect();
    return main.dataset.authMode === ${JSON.stringify(mode)}
      && main.querySelector('.noor-login-brand img').naturalWidth > 0
      && main.querySelectorAll('.noor-login-field input').length === ${fields}
      && Math.abs((card.top + card.bottom) / 2 - innerHeight / 2) <= 4
      && main.querySelector('a[href="/"]').getBoundingClientRect().bottom <= innerHeight
      && !main.querySelector('.na315-caution, .noor-r329-brand-header');
  })()`,"Administrator form matches the approved centered layout");
  const submitAdminLogin = () => run(`(() => {
    const form = document.querySelector('.noor-admin-entry-panel form');
    form.elements.email.value = 'fixture@example.test';
    form.elements.password.value = 'fixture';
    form.requestSubmit();
  })()`);
  await checkAdminLayout("admin-login",2);
  await snap(screen.name+"-admin-login");
  await submitAdminLogin();
  await find("main[data-auth-mode='admin-verify'] .na315-code");
  await checkAdminLayout("admin-verify",1);
  await expect("document.querySelector('.na315-code').autocomplete==='one-time-code'&&document.querySelector('.noor-welcome-submit').disabled","Existing factor requires a six-digit code");
  if(screen.mobile){
   await cdp("Emulation.setDeviceMetricsOverride",{width:390,height:480,mobile:true,deviceScaleFactor:1});
   await run("document.querySelector('.na315-code').focus()");
   await expect(`(() => {
     const field = document.querySelector('.na315-code');
     const card = document.querySelector('.noor-r332-auth').getBoundingClientRect();
     return document.activeElement === field && visualViewport.scale === 1
       && parseFloat(getComputedStyle(field).fontSize) >= 16 && card.right <= innerWidth
       && card.bottom <= visualViewport.height && field.getBoundingClientRect().bottom <= card.bottom;
   })()`,"Focused administrator code and submit fit the reduced mobile viewport");
   await snap(screen.name+"-admin-code-compact");
   await cdp("Emulation.setDeviceMetricsOverride",{width:screen.width,height:screen.height,mobile:true,deviceScaleFactor:1});
  }
  await run("document.querySelector('.na315-code').focus()");
  await cdp("Input.insertText",{text:"123456"});
  await expect("document.querySelector('.na315-code').value==='123456'&&!document.querySelector('.noor-welcome-submit').disabled","Six digits enable administrator verification");
  await snap(screen.name+"-admin-code");
  await run("document.querySelector('.noor-welcome-submit').click()");
  await find(".na315-panel[data-step='complete']");
  await cdp("Page.navigate",{url:url+"?screen=admin&factor=new"});
  await find(".noor-admin-entry-panel input[name=email]");
  await submitAdminLogin();
  await find(".noor-admin-entry-panel[data-step='enroll']");
  await expect("document.querySelector('.noor-login-title').textContent.trim()==='إضافة تطبيق المصادقة'&&!document.querySelector('.noor-admin-setup-dialog')","Enrollment starts with the approved create action");
  await snap(screen.name+"-admin-enroll");
  if (screen.mobile) await cdp("Emulation.setDeviceMetricsOverride",{width:320,height:380,mobile:true,deviceScaleFactor:1});
  await run("document.querySelector('.noor-welcome-submit').click()");
  await expect("document.querySelector('.noor-admin-setup-dialog:modal .noor-admin-setup-qr')?.naturalWidth>0","Enrollment opens a modal with the QR code");
  const checkSetupFit = () => expect(`(() => {
    const dialog = document.querySelector('.noor-admin-setup-dialog:modal');
    const box = dialog.getBoundingClientRect();
    const action = dialog.querySelector('.noor-account-request-receipt-return').getBoundingClientRect();
    return box.left >= 0 && box.right <= visualViewport.width && box.top >= 0
      && box.bottom <= visualViewport.height && action.bottom <= box.bottom
      && dialog.scrollHeight <= dialog.clientHeight + 1;
  })()`,"Enrollment dialog and its primary action fit without scrolling");
  await checkSetupFit();
  await snap(screen.name+"-admin-setup-qr");
  await run("document.querySelector('.noor-admin-setup-dialog .noor-auth-return-r312').click()");
  await expect("document.querySelector('.noor-admin-setup-dialog:modal .noor-admin-setup-key')?.textContent==='TEST-KEY'&&!document.querySelector('.noor-admin-setup-qr')","Manual setup key appears on request");
  await checkSetupFit();
  await snap(screen.name+"-admin-setup-key");
  await run("document.querySelector('.noor-admin-setup-dialog .noor-auth-return-r312').click()");
  await find(".noor-admin-setup-dialog:modal .noor-admin-setup-qr");
  await cdp("Input.dispatchKeyEvent",{type:"keyDown",key:"Escape",code:"Escape",windowsVirtualKeyCode:27});
  await cdp("Input.dispatchKeyEvent",{type:"keyUp",key:"Escape",code:"Escape",windowsVirtualKeyCode:27});
  await expect("!document.querySelector('.noor-admin-setup-dialog')&&document.activeElement?.textContent.trim()==='عرض إعداد التطبيق'","Escape closes the modal and focuses the reopen action");
  await run("[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='عرض إعداد التطبيق').click()");
  await find(".noor-admin-setup-dialog:modal");
  await run("document.querySelector('.noor-admin-setup-dialog .noor-account-request-receipt-return').click()");
  await expect("!document.querySelector('.noor-admin-setup-dialog')&&document.activeElement?.classList.contains('na315-code')","Continue closes setup and focuses the verification code");
  if (screen.mobile) await cdp("Emulation.setDeviceMetricsOverride",{width:screen.width,height:screen.height,mobile:true,deviceScaleFactor:1});
  await cdp("Input.insertText",{text:"123456"});
  await expect("document.querySelector('.na315-code').value==='123456'&&!document.querySelector('.noor-welcome-submit').disabled","First-time verification enables submit at six digits");
  await run("document.querySelector('.noor-welcome-submit').click()");
  await find(".na315-panel[data-step='complete']");
  await expect("!document.querySelector('.noor-admin-setup-dialog, .noor-admin-setup-key, .noor-admin-setup-qr')","Completion removes setup material from the page");
  await cdp("Page.navigate",{url:url+"?screen=admin"});
  await find("main[data-auth-mode=admin-login]");
  await run("document.querySelector('.noor-auth-return-r312').click()");
  await find("main[data-auth-mode=admin-recover-request] input[name=email]");
  await checkAdminLayout("admin-recover-request",1);
  await snap(screen.name+"-admin-recover-request");
  const requestAdminLink = email => run(`(() => {
    const form = document.querySelector('form');
    form.elements.email.value = ${JSON.stringify(email)};
    form.requestSubmit();
  })()`);
  await requestAdminLink("failed@example.test");
  await find(".na315-error");
  await expect("!document.querySelector('dialog')&&document.querySelector('input[name=email]').value==='failed@example.test'","Admin delivery failure keeps the address for retry");
  await requestAdminLink("fixture@example.test");
  await find(".noor-account-request-receipt:modal");
  await expect("document.querySelector('dialog h2').textContent==='تم استلام طلب الاستعادة'&&!document.querySelector('input[name=email]').value","Admin recovery confirms a request without claiming an account exists");
  await snap(screen.name+"-admin-recover-sent");
  await run("document.querySelector('.noor-account-request-receipt-return').click()");
  await find("main[data-auth-mode=admin-login]");

  await cdp("Page.navigate",{url:url+"?screen=admin&auth=recovery"});
  await find("main[data-auth-mode=admin-recover-finish] input[name=confirm]");
  await checkAdminLayout("admin-recover-finish",2);
  await expect("[...document.querySelectorAll('input')].every(i=>i.minLength===12&&i.maxLength===128&&i.autocomplete==='new-password')","Administrator password minimum remains distinct");
  await snap(screen.name+"-admin-recover-finish");
  const submitAdminPassword = (password, confirm) => run(`(() => {
    const form = document.querySelector('form');
    form.elements.password.value = ${JSON.stringify(password)};
    form.elements.confirm.value = ${JSON.stringify(confirm)};
    form.requestSubmit();
  })()`);
  await submitAdminPassword("FixturePassword1!","FixturePassword2!");
  await expect("document.querySelector('.na315-error')?.textContent.includes('غير متطابقتين')","Administrator confirmation rejects mismatched passwords");
  await submitAdminPassword("ExpiredFixturePass!","ExpiredFixturePass!");
  await expect("document.querySelector('.na315-error')?.textContent.includes('الرابط منتهي')&&!document.querySelector('dialog')","Expired administrator link shows retry state");
  await submitAdminPassword("FixturePassword1!","FixturePassword1!");
  await find(".noor-account-request-receipt:modal");
  await expect("location.pathname==='/admin/security'&&!location.search&&document.querySelector('main').dataset.authMode==='admin-login'&&!document.querySelector('input[name=password]').value&&document.querySelector('dialog h2').textContent==='تم تغيير كلمة المرور'","Update clears the form and returns to sign-in with confirmation");
  if (screen.mobile) {
   await cdp("Emulation.setDeviceMetricsOverride",{width:320,height:420,mobile:true,deviceScaleFactor:1});
   await expect("document.querySelector('dialog').getBoundingClientRect().bottom<=visualViewport.height","Administrator recovery confirmation fits a short viewport");
   await cdp("Emulation.setDeviceMetricsOverride",{width:screen.width,height:screen.height,mobile:true,deviceScaleFactor:1});
  }
  await snap(screen.name+"-admin-recover-saved");
  await run("document.querySelector('.noor-account-request-receipt-return').click()");
  await expect("!document.querySelector('dialog')&&document.querySelector('main').dataset.authMode==='admin-login'","Recovery receipt closes on administrator sign-in");
  await cdp("Page.navigate",{url:url+"?screen=personal"});
  await find("[data-testid=r323-approved-dashboard]");
  await expect(visible(".np-r323-rhythm"),"Active timer visible");
  await expect(visible("[data-testid=r328-night-total-duration]"),"Trusted whole-night duration visibly distinct from the timer");
  await expect("document.querySelector('.np-r339-wordmark')?.textContent==='NOOR Personal'&&!!document.querySelector('.np-r339-smile')","Approved centered Personal wordmark");

  const headerGeometry=await run("(()=>{const rect=x=>{const r=x.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height,top:r.top,bottom:r.bottom,left:r.left,right:r.right}},b=document.querySelector('.np-r323-header .np-brand'),h=document.querySelector('.np-r339-wordmark'),g=document.querySelector('.np-r323-greeting');return {viewport:{width:innerWidth,height:innerHeight},brand:rect(b),image:rect(h),greeting:rect(g)}})()");
  console.log("R323_HEADER_LAYOUT",screen.name,JSON.stringify(headerGeometry));
  await expect("(()=>{const b=document.querySelector('.np-r339-brand').getBoundingClientRect(),h=document.querySelector('.np-r339-wordmark').getBoundingClientRect(),a=document.querySelector('.np-top-actions').getBoundingClientRect();return b.height>=70&&Math.abs((b.left+b.right-h.left-h.right)/2)<3&&(a.right<=h.left+1||a.top>=h.bottom)})()","Centered wordmark and header controls do not overlap");
  await expect("!!document.querySelector('[data-testid=prayer-card]').closest('[hidden]')","Prayer sheet initially closed");
  await run("Array.from(document.querySelectorAll('.np-r331-board-grid button')).find(b=>b.textContent.includes('الصلاة القادمة')).click()");
  await expect(visible("[data-testid=prayer-card]"),"Prayer card visible after opening sheet");
  await expect("document.querySelectorAll('.np-r339-friday-grid>div').length===5","Five Friday hours retained");
  await expect(`(() => {
    const prayers = [...document.querySelectorAll('.np-r339-overlay .np-prayer-times .np-prayer')].map(p => p.getBoundingClientRect());
    return prayers.length===5 && prayers.every((p,i) => p.width>=200 && p.height<=64 && (i===0 || p.top>prayers[i-1].bottom));
  })()`,"Each prayer is a readable full-width row");
  await expect(visible("[data-testid=night-countdown-midnight]")+"&&"+visible("[data-testid=night-countdown-last-third]"),"Both night countdowns visible in the prayer sheet");
  await expect(`(() => {
    const sheet=document.querySelector('[aria-label="مواقيت الصلوات"][role=dialog]');
    const rect=sheet.getBoundingClientRect();
    return getComputedStyle(sheet).borderRadius==="24px" && rect.top>=0 && rect.bottom<=innerHeight+1;
  })()`,"Prayer sheet uses the Noor surface and fits the viewport");
  await snap(screen.name+"-prayer-details");
  await run("document.querySelector('.np-r339-overlay .np-r331-sheet header button').click()");
  await expect(visible("[data-testid=today-summary]"),"Existing progress retained");
  await expect("(()=>{const c=document.querySelector('.np-caffeine-card-r299'),d=document.querySelector('[data-testid=today-summary]'),w=document.querySelector('[data-testid=r332-weekly-card]'),s=c?.querySelector('.np-caffeine-signal-r295');if(!c||!d||!w||!s)return false;const a=c.getBoundingClientRect(),b=d.getBoundingClientRect(),k=w.getBoundingClientRect(),p=s.getBoundingClientRect();return b.bottom<=k.top+1&&k.bottom<=a.top+1&&a.height<=200&&p.height<=34})()","Daily, weekly and drinks cards ordered without overlap");
  await expect("getComputedStyle(document.querySelector('.np-r323-header .np-brand'),'::before').display==='none'","No duplicated header art");
  await expect("(()=>{const c=document.querySelector('[data-testid=r332-weekly-card]'),ring=c?.querySelector('.np-r332-week-ring'),rows=c?.querySelectorAll('.np-r332-week-counts>div'),bars=c?.querySelectorAll('.np-week-day .np-week-value');if(!c||!ring||rows?.length!==3||bars?.length!==7)return false;const b=c.getBoundingClientRect(),r=ring.getBoundingClientRect();return r.width>=80&&r.height>=80&&b.left>=-1&&b.right<=innerWidth+1&&Array.from(bars).every(x=>Math.abs(x.getBoundingClientRect().top-bars[0].getBoundingClientRect().top)<2)})()","R332 approved weekly ring, three count rows and seven aligned daily bars fit screen");
  await expect("(()=>{const c=document.querySelector('[data-testid=r332-weekly-card]'),days=c?.querySelector('.np-week-days'),cells=days?.querySelectorAll('[data-week-date]');return !!days&&cells?.length===7&&getComputedStyle(days).direction==='rtl'&&cells[0].getBoundingClientRect().left>cells[6].getBoundingClientRect().left&&!c.querySelector('.np-r332-week-note')})()","R333 Saturday starts at the right and the weekly footer is absent");
  await expect("document.documentElement.scrollWidth<=innerWidth+2","Dashboard horizontal overflow");
  await expect("document.querySelector('.np-r323-home-grid').querySelectorAll('.np-r323-rhythm').length===1","No duplicate timer");
  await expect("document.querySelectorAll(\'[data-testid=r331-announcement-board] .np-r331-board-grid>.np-r331-tile\').length===6&&document.querySelectorAll(\'#noor-r331-prayers [data-prayer-key]\').length===5&&!document.querySelector(\'[data-testid=r296-reconnect-button]\')","Six functional tiles, five prayers, no refresh icon");
  await expect(`(() => {
   const board = document.querySelector('[data-testid=r331-announcement-board]');
   const tiles = [...board.querySelectorAll('.np-r331-board-grid > .np-r331-tile')];
   const bounds = board.getBoundingClientRect();
   const cells = tiles.map(tile => tile.getBoundingClientRect());
   return cells.length === 6 && cells.every((cell, i) => {
    const column = i % 3;
    const row = Math.floor(i / 3);
    return cell.width > 0 && cell.height > 0 &&
     cell.left >= bounds.left && cell.right <= bounds.right && cell.bottom <= bounds.bottom &&
     Math.abs(cell.top - cells[row * 3].top) < 1 &&
     Math.abs(cell.left - cells[column].left) < 1 &&
     Math.abs(cell.height - cells[0].height) < 1 &&
     (column === 0 || cell.right < cells[i - 1].left) &&
     (row === 0 || cell.top > cells[column].bottom);
   });
  })()`,"One outer card contains two aligned rows of three equal-height RTL tiles");
  await expect(visible(".np-r323-bottom-nav"),"Real bottom navigation exists");
  await expect(visible(".np-r339-profile"),"Profile shortcut in header");
  await expect("Array.from(document.querySelectorAll('.np-r324-bottom-nav button')).map(b=>b.dataset.testid).join(',')==='r324-nav-home,r324-nav-check,r324-nav-plus,r324-nav-bell,r324-nav-grid'","Approved RTL navigation order");
  await expect("(()=>{const ring=document.querySelector('.np-category-progress[aria-valuenow=\\\"100\\\"]'),label=ring?.querySelector(':scope > span');if(!ring||!label)return false;const range=document.createRange();range.selectNodeContents(label);const r=ring.getBoundingClientRect(),t=range.getBoundingClientRect();return t.width<=r.width*.7&&t.height<=r.height*.6&&Math.abs((t.left+t.right-r.left-r.right)/2)<2})()","R333 100 percent habit label fits inside the ring");
  await snap(screen.name+"-personal");
  await run("document.querySelector('.np-today-task-button')?.scrollIntoView({block:'center'})");
  await expect("!!document.querySelector('.np-today-task-button')","Compact task row is present");
  await snap(screen.name+"-compact-today-task");
  await run("document.querySelector('.np-today-task-button').click()");
  await expect("!!document.querySelector('.np-current-task-overlay [role=dialog]')","Task row opens floating task details");
  await snap(screen.name+"-floating-task");
  await run("document.querySelector('.np-current-task-overlay header button').click(); window.scrollTo(0,0)");

  await run("window.scrollTo(0, document.querySelector('[data-testid=today-summary]').getBoundingClientRect().top + scrollY)");
  await snap(screen.name+"-achievement");
  for (const [trigger, dialog, name] of [
    [".np-r338-bell", ".np-r338-alert-sheet", "alerts"],
    ["[data-testid=r286-remaining-trigger]", ".np-r286-remaining-dialog", "remaining"],
  ]) {
    await run(`document.querySelector(${JSON.stringify(trigger)}).click()`);
    await expect(visible(dialog),name+" opens");
    await expect(`(() => {
      const sheet=document.querySelector(${JSON.stringify(dialog)});
      const rect=sheet.getBoundingClientRect();
      return getComputedStyle(sheet).borderRadius==="24px" &&
        rect.top>=0 && rect.bottom<=innerHeight+1 && rect.right<=innerWidth+1;
    })()`,name+" Noor surface stays within the viewport");
    await snap(screen.name+"-"+name);
    await run(`document.querySelector(${JSON.stringify(dialog)}).querySelector('button[aria-label^="إغلاق"]').click()`);
    await expect("!("+visible(dialog)+")",name+" closes");
  }
  await run("window.scrollTo(0, 0)");
  for (const [tile,sheet,name] of [
    [".np-r331-board-grid > :nth-child(5)", ".np-r339-task-sheet", "tasks"],
    [".np-r331-board-grid > :nth-child(6)", '[aria-label="الأحداث التاريخية"][role=dialog]', "history"],
    [".np-r339-mini-days button", '[aria-label="تدارك الفائت"][role=dialog]', "recovery"],
  ]) {
    await run("(()=>{const trigger=document.querySelector("+JSON.stringify(tile)+");trigger.focus({preventScroll:true});trigger.click()})()");
    await expect(visible(sheet),name+" sheet opens when selected");
    await snap(screen.name+"-"+name+"-details");
    await run("document.querySelector("+JSON.stringify(sheet)+").closest('[role=dialog]').querySelector('header button').click()");
    await expect("!("+visible(sheet)+")",name+" sheet closes");
    await expect("document.activeElement===document.querySelector("+JSON.stringify(tile)+")",name+" sheet returns focus to its trigger");
  }
  await run("document.querySelector('.np-caffeine-details-r296 > summary').click()");
  await expect("document.querySelector('.np-caffeine-details-r296').open","Beverage details can open on demand");
  const liveBoardDate=await run("document.querySelector('[data-testid=r331-announcement-board]').dataset.boardDate");
  await run("document.querySelector('[data-week-state=past]').click()");
  await expect("(()=>{const b=document.querySelector('[data-testid=r331-announcement-board]');return !!b&&b.querySelectorAll('.np-r331-board-grid>.np-r331-tile').length===6&&Array.from(b.querySelectorAll('.np-r331-board-grid>.np-r331-tile')).every(x=>x.getBoundingClientRect().width>0&&x.getBoundingClientRect().height>0)&&b.querySelector('header small').textContent.includes('اليوم الحالي')&&b.dataset.boardDate==="+JSON.stringify(liveBoardDate)+"})()","R333 all six live board tiles remain visible when browsing historical days");
  await expect("(()=>{const d=document.querySelector('.np-caffeine-details-r296');return d&&!d.open&&d.querySelector('summary').textContent==='تفاصيل المشروبات'&&!d.querySelector('.np-caffeine-bedtime-settings-r296')})()","R333 selecting an earlier day keeps drinks collapsed and read-only");
  await run("document.querySelector('[data-week-state=today]').click()");
  await expect("!document.querySelector('.np-caffeine-details-r296').open","Returning to the current day keeps drinks collapsed");
  await expect("document.querySelectorAll('[data-testid=r331-announcement-board] .np-r331-board-grid>.np-r331-tile').length===6","Six board tiles remain after returning to today");
  await run("document.querySelector('[data-testid=r322-open-time-windows]').click()");
  await expect("(()=>{const r=document.querySelector('.np-r322-sheet')?.getBoundingClientRect();return r&&r.height>100&&r.top<innerHeight-100&&r.bottom<=innerHeight+3})()","Timer sheet must actually be inside the viewport");
  await snap(screen.name+"-timer-details");
  await run("document.querySelector('[aria-label=\"إغلاق مؤقتات اليوم\"]').click()");
  await expect("document.querySelector('.np-r322-modal').dataset.open==='false'","Timer sheet closes");
  const more=await run("!!document.querySelector('[data-testid=r322-open-appointments]')");
  if(more){await run("document.querySelector('[data-testid=r322-open-appointments]').click()");await expect("(()=>{const r=document.querySelector('.np-r322-appointments-sheet')?.getBoundingClientRect();return r&&r.height>50&&r.top<innerHeight-50&&r.bottom<=innerHeight+3})()","Appointment sheet must actually be visible in the viewport");await expect("(()=>{const a=document.querySelector(\".np-r332-schedule-overlay[data-open=true]\"),rows=a?.querySelectorAll(\".np-r324-event-row\");return a?.parentElement===document.body&&(rows?.length>0||a?.textContent.includes('لا توجد مواقيت'))&&Array.from(rows??[]).every(r=>r.querySelector(\".np-r332-event-countdown [role=timer]\")?.textContent)})()","Floating schedule has a countdown for each event");await snap(screen.name+"-appointments");await run("document.querySelector('[aria-label=\"إغلاق المواعيد\"]').click()");}
  await run("document.querySelector('[data-testid=r324-nav-grid]').click()");
  await find(".np-cc-shell");
  await expect(visible("[data-testid=r324-persistent-navigation]"),"Navigation stays in control center");
  await snap(screen.name+"-tools");
  await run("Array.from(document.querySelectorAll('.np-cc-nav-item')).find(b=>b.textContent.includes('الأوزان')).click()");
  await find('[data-testid=r334-prayer-policy-editor]');
  await run("document.querySelector('[data-testid=r334-prayer-policy-editor]>summary').click()");
  await expect("document.querySelector('[data-testid=r334-prayer-base-weight]').value===''&&document.querySelector('[data-testid=r334-share-excused-ontime]').value===''&&document.querySelector('[data-testid=r334-policy-save]').disabled","R334 no implicit policy approval");
  await expect("document.documentElement.scrollWidth<=innerWidth+2","R334 policy editor fits viewport");
  await run("document.querySelector('[data-testid=r334-prayer-policy-editor]').scrollIntoView({block:'start'})");
  await snap(screen.name+"-prayer-policy");

  await run("document.querySelector('[data-testid=r324-nav-bell]').click()");
  await expect("document.querySelector('[data-testid=r324-nav-bell]').getAttribute('aria-current')==='page'","Reminders navigation active");
  await run("document.querySelector('[data-testid=r324-nav-home]').click()");
  await find(".np-r340-settings");
  await run("document.querySelector('.np-r340-settings').click()");
  await expect("document.querySelector('.np-cc-nav-item[aria-current=page]')?.textContent==='المظهر'","Settings opens from the top bar");
  await run("document.querySelector('[data-testid=r324-nav-home]').click()");
  await find("[data-testid=r323-approved-dashboard]");
  await expect("document.querySelector('[data-testid=r324-nav-home]').getAttribute('aria-current')==='page'","Home navigation active");
  await run("document.querySelector('[data-testid=r324-nav-plus]').click()");
  await find(".np-r324-quick-sheet");
  await expect("document.querySelectorAll('.np-r324-quick-sheet > button').length===3","Quick add exposes task habit and appointment");
  await snap(screen.name+"-quick-add");
  await run("document.querySelector('.np-r324-quick-sheet > button').click()");
  await expect("Array.from(document.querySelector(\'#definition-kind\')?.options??[]).map(o=>o.value).includes(\'appointment\')","Add form exposes appointment as a selectable type");
  await find("#definition-title");
  await expect("document.querySelector('[data-testid=r324-nav-plus]').getAttribute('aria-current')==='page'","Quick task navigation active");
  await snap(screen.name+"-quick-task");
  await cdp("Page.navigate",{url:url+"?screen=personal&task-preview=1"});
  await find(".np-today-task-button");
  await snap(screen.name+"-header-preview");
  await run("document.querySelector('.np-today-task-button').scrollIntoView({block:'center'})");
  await snap(screen.name+"-compact-task-preview");
  await run("document.querySelector('.np-today-task-button').click()");
  await expect("!!document.querySelector('.np-current-task-overlay .nts-list[open]')","Reading sessions open inside the floating sheet");
  await expect(`(() => {
    const card=document.querySelector(".np-task-detail-card");
    if(!card)return false;
    const controls=card.querySelector(".np-activity-actions");
    const title=card.querySelector(".np-item-main");
    const sessions=card.querySelector(".nts-list");
    const pencil=card.querySelector(".np-pencil");
    const label=pencil?.querySelector("span");
    if(!controls||!title||!sessions||!pencil||!label)return false;
    return !card.querySelector(".np-r332-task-icon") &&
      title.getBoundingClientRect().bottom <= controls.getBoundingClientRect().top &&
      controls.getBoundingClientRect().bottom <= sessions.getBoundingClientRect().top &&
      (() => {
        const bounds=pencil.getBoundingClientRect(), text=label.getBoundingClientRect();
        return text.left>=bounds.left && text.right<=bounds.right &&
          text.top>=bounds.top && text.bottom<=bounds.bottom;
      })();
  })()`,"Task progress, actions, and sessions are stacked without overlap");
  await snap(screen.name+"-task-sessions-preview");
  report.push({viewport:screen.name,width:screen.width,height:screen.height,appointmentFixtureVisible:more,layout:await run("Array.from(document.querySelectorAll('.np-r323-home-grid>.np-card')).filter(x=>x.getBoundingClientRect().height>0).map(x=>({className:x.className,width:Math.round(x.getBoundingClientRect().width),height:Math.round(x.getBoundingClientRect().height),top:Math.round(x.getBoundingClientRect().top)}))")});
 }
 for (const viewport of [
   {width:320,height:568,mobile:true},
   {width:390,height:844,mobile:true},
   {width:430,height:932,mobile:true},
   {width:1440,height:900,mobile:false},
 ]) {
   await cdp("Emulation.setDeviceMetricsOverride",{...viewport,deviceScaleFactor:1});
   for (const [daylight,weather] of [["day","clear"],["day","cloudy"],["night","clear"],["night","cloudy"],["day","unknown"],["day","fog"],["night","partly"],["day","precipitation"]]) {
     await cdp("Page.navigate",{url:url+"?screen=personal&daylight="+daylight+"&weather="+weather});
     await expect("!!document.querySelector('.np-r339-header[data-daylight="+daylight+"][data-sky="+weather+"]')","Confirmed weather and solar state applied: "+daylight+"/"+weather).catch(async error => {
       console.error("Weather fixture state",await run("JSON.stringify(document.querySelector('.np-r339-header')?.dataset)"));
       throw error;
     });
     await expect("document.documentElement.scrollWidth<=innerWidth+2","Weather dashboard fits width "+viewport.width);
     await expect(`(() => {
       const days = [...document.querySelectorAll(".np-r339-header .np-header-date-main")];
       return days.length === 2 && days.every(el => parseFloat(getComputedStyle(el).fontSize) >= 12) &&
         Math.abs(days[0].getBoundingClientRect().top-days[1].getBoundingClientRect().top) < 2;
     })()`,"Both dates share one readable row at "+viewport.width);
     await expect(`(() => {
       const rect = selector => document.querySelector(selector).getBoundingClientRect();
       const wordmark = rect(".np-r339-wordmark"), actions = rect(".np-top-actions"), settings = rect(".np-r340-settings");
       const profile = rect(".np-top-actions .np-r339-profile"), bell = rect(".np-r338-bell");
       const brand = rect(".np-r339-brand");
       const centered = box => Math.abs((box.top + box.bottom - brand.top - brand.bottom) / 2) < 2;
       return actions.right <= wordmark.left + 1 && wordmark.right <= settings.left + 1 &&
         [profile, bell, settings].every(box => centered(box) && Math.abs(box.width-profile.width)<1);
     })()`,"Header shortcuts fit width "+viewport.width);
     await expect(`(() => {
       const root=document.querySelector(".np-page[data-appearance]");
       const clock=document.querySelector("[data-testid=live-clock]");
       const date=document.querySelector(".np-header-date-main");
       const divider=document.querySelector(".np-header-date-divider");
       const backdrop=getComputedStyle(root,"::before");
       const image=backdrop.backgroundImage;
       const fill=getComputedStyle(root,"::after");
       return !!document.querySelector("[data-testid=header-temperature]") &&
         !!document.querySelector("[data-testid=header-weather-details]") &&
         image.includes("personal-${daylight}-r340.webp") &&
         backdrop.position==="fixed" &&
         fill.position==="fixed" && fill.backgroundImage.includes("personal-${daylight}-r340.webp") &&
         fill.backgroundSize.split(",").at(-1).trim()==="cover" &&
         backdrop.backgroundSize.split(",").at(-1).trim()==="contain" &&
         backdrop.backgroundRepeat.split(",").every(repeat=>repeat.trim()==="no-repeat") &&
         parseFloat(getComputedStyle(clock).fontSize)>=32 &&
         parseFloat(getComputedStyle(date).fontSize)<=14 &&
         divider.getBoundingClientRect().width>=2 &&
         clock.getBoundingClientRect().bottom<=date.getBoundingClientRect().top;
     })()`,"Clock, dates, weather details, and "+daylight+" landscape render at "+viewport.width);
     await expect(`(() => {
       const primary=document.querySelector(".np-weather-primary");
       const details=document.querySelector(".np-weather-details");
       return Boolean(primary.querySelector("svg"))===${weather!=="unknown"} &&
         Boolean(primary.querySelector(".np-weather-condition"))===${weather!=="unknown"} &&
         primary.getBoundingClientRect().bottom<=details.getBoundingClientRect().top;
     })()`,"Weather icon follows the sky state and details stay below the reading");
     await snap(viewport.width+"-"+daylight+"-"+weather);
   }
 }
 await writeFile(resolve(output,"report.json"),JSON.stringify(report,null,2));
 console.log("R323_BROWSER_SMOKE_PASS "+JSON.stringify(report));
}finally{
 socket?.close();chrome?.kill();vite?.kill();await rm(htmlFile,{force:true});await rm(scriptFile,{force:true});await rm(profile,{recursive:true,force:true}).catch(()=>{});
}
