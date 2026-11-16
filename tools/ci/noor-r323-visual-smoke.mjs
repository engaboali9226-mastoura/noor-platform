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
 'Date.now=()=>Date.parse("2026-11-06T18:02:00Z");',
 'window.fetch=async()=>new Response(JSON.stringify({current:{temperature_2m:22}}),{status:200,headers:{"Content-Type":"application/json"}});'
 ].join("\n");
 const render=[
 'const root=createRoot(document.getElementById("root")!);',
 'const isLogin=new URLSearchParams(location.search).get("screen")==="login";',
 'const isSelector=new URLSearchParams(location.search).get("screen")==="selector";',
 'import {applyAppearance,readAppearance} from "./src/appearance-preference-store";',
 'applyAppearance(readAppearance());',
 'const accountService={requestPasswordReset:async()=>"sent" as const,registerPendingAccount:async()=>"sent" as const,completePasswordRecovery:async()=>"updated" as const,requestEmailChange:async()=>"sent" as const};',
 'const appointments=[{id:"visual-appointment-1",kind:"Task",title:"اجتماع فريق العمل",state:"Active",category:"العمل",schedule:{kind:"Daily"},effectiveFromDate:"2026-11-06",importance:"Important",countdownPlan:{kind:"appointment",date:"2026-11-07",time:"15:00"}},{id:"visual-appointment-2",kind:"Task",title:"موعد طبي",state:"Active",category:"الصحة",schedule:{kind:"Daily"},effectiveFromDate:"2026-11-06",importance:"Important",countdownPlan:{kind:"appointment",date:"2026-11-08",time:"10:00"}}];',
 'root.render(new URLSearchParams(location.search).get("screen")==="admin"?<NoorAdminMfaPageR315 createMfa={()=>({signIn:async()=>"challenge-needed",enroll:async()=>null,verify:async()=>"invalid",accessToken:async()=>null,signOut:async()=>{}})}/>:(isLogin||isSelector)?<PlatformShell state={{kind:"no-application-selected"}} navigate={()=>{}} signIn={async()=>{}} authenticationState={isSelector?"authenticated":"idle"} accountService={accountService}/>:<NoorPersonalApplicationView initialResult={{...today,today:{...today.today,habits:today.today.habits.map(h=>({...h,status:"Completed"}))}} as any} initialWorkspace={{...workspace,workspace:{...workspace.workspace,definitions:[...workspace.workspace.definitions,...appointments]}} as any}/>);'
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
  await expect("document.querySelector('.noor-welcome-eyebrow').textContent==='NOOR Platform'","Platform branding");
  await expect("document.querySelector('.noor-r322-admin-entry').getBoundingClientRect().bottom<=innerHeight","Login controls fit without scrolling");
  await expect("document.querySelector('.noor-welcome-logo').getBoundingClientRect().top<80","Brand begins near the top of the screen");
  await expect("document.querySelector('.noor-welcome-field input') && parseFloat(getComputedStyle(document.querySelector('.noor-welcome-field input')).fontSize)>=16","Login input does not trigger iOS auto zoom");
  await expect("document.querySelector('.noor-welcome-logo').getAttribute('src')==='/brand/platform-header.webp'&&document.querySelector('.noor-welcome-logo').naturalWidth>0","Shared login logo");
  await run("document.querySelector('input[name=email]').focus()");
  await expect("(()=>{const i=document.querySelector('input[name=email]'),s=getComputedStyle(i);return s.borderTopWidth==='0px'&&s.boxShadow==='none'&&s.outlineStyle==='none'})()","No nested focus border");
  await run("document.querySelector('.noor-r328-password-toggle').click()");
  await expect("document.querySelector('input[name=password]').type==='text'","Password visibility works");
  await run("document.querySelector('.noor-r328-password-toggle').click()");
  await expect("document.querySelector('input[name=password]').type==='password'","Password can be concealed");
  await run("document.activeElement.blur()");
  await snap(screen.name+"-login");
  await cdp("Page.navigate",{url:url+"?screen=selector"});
  await find(".noor-welcome-app-card");
  await expect("Array.from(document.querySelectorAll('.noor-welcome-app-mark')).length===2&&Array.from(document.querySelectorAll('.noor-welcome-app-mark')).every(x=>{const width=x.getBoundingClientRect().width;return width>=48&&width<=64&&x.querySelector('img').naturalWidth>0})","Both scoped circular logos are compact and decoded");
  await expect("document.documentElement.scrollWidth<=innerWidth+1","Application picker fits viewport");
  await expect(`(() => {
   const cards = [...document.querySelectorAll('.noor-welcome-app-card')];
   const [personal, work] = cards.map(card => card.getBoundingClientRect());
   return cards.length === 2 &&
    cards.map(card => card.getAttribute('href')).join(',') === '/personal,/work' &&
    (innerWidth >= 720 ? Math.abs(personal.top - work.top) < 1 && work.right < personal.left
     : personal.bottom < work.top) && work.bottom <= innerHeight;
  })()`,"Application links fit side by side on desktop and stack on mobile");
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
  await expect("document.querySelector('.noor-welcome-logo').getAttribute('src')==='/brand/platform-header.webp'&&document.querySelector('.noor-welcome-logo').naturalWidth>0","Registration retains approved shared artwork");
  await expect("document.documentElement.scrollWidth<=innerWidth+1&&document.querySelector('.noor-auth-return-r312').getBoundingClientRect().bottom<=innerHeight","Registration controls fit the normal viewport");
  await expect("Array.from(document.querySelectorAll('.noor-welcome-field input')).every(i=>parseFloat(getComputedStyle(i).fontSize)>=16)","Registration fields avoid mobile auto zoom");
  await snap(screen.name+"-registration");
  await run("document.querySelector('.noor-auth-return-r312').click()");
  await run("document.querySelector('.noor-auth-forgot').click()");
  await wait(()=>run("!document.querySelector('input[name=password]')"));
  await expect("document.querySelector('.noor-welcome-logo').getAttribute('src')==='/brand/platform-header.webp'&&document.querySelector('.noor-welcome-logo').naturalWidth>0","Password reset retains approved shared artwork");
  await expect("document.documentElement.scrollWidth<=innerWidth+1&&document.querySelector('.noor-auth-return-r312').getBoundingClientRect().bottom<=innerHeight","Password reset controls fit the normal viewport");
  await snap(screen.name+"-recovery");
  if(screen.mobile){
   await cdp("Emulation.setDeviceMetricsOverride",{width:390,height:480,deviceScaleFactor:1,mobile:true});
   await run("document.querySelector('.noor-auth-return-r312').click()");
   await run("document.querySelector('input[name=email]').focus()");
   await expect("document.activeElement.getBoundingClientRect().bottom<=visualViewport.height&&visualViewport.scale===1","Focused field fits the reduced mobile viewport");
   await expect("document.querySelector('.noor-r322-admin-entry').getBoundingClientRect().bottom<=visualViewport.height","Login controls fit the reduced mobile viewport");
   await snap(screen.name+"-focused");
   await cdp("Page.navigate",{url:url+"?screen=admin"});
   await find(".na315-panel input[name=email]");
   await run("(()=>{const f=document.querySelector('.na315-panel form');f.elements.email.value='fixture@example.test';f.elements.password.value='fixture';f.requestSubmit()})()");
   await find(".na315-code");
   await run("document.querySelector('.na315-code').focus()");
   await expect("(()=>{const input=document.querySelector('.na315-code'),panel=document.querySelector('.na315-panel'),r=panel.getBoundingClientRect();return document.activeElement===input&&parseFloat(getComputedStyle(input).fontSize)>=16&&r.bottom<=visualViewport.height&&r.right<=innerWidth&&input.getBoundingClientRect().bottom<=r.bottom})()","MFA code and panel fit reduced viewport without zoom");
   await snap(screen.name+"-admin-code");
   await cdp("Emulation.setDeviceMetricsOverride",{width:screen.width,height:screen.height,deviceScaleFactor:1,mobile:true});
  }
  await cdp("Page.navigate",{url:url+"?screen=personal"});
  await find("[data-testid=r323-approved-dashboard]");
  await expect(visible(".np-r323-rhythm"),"Active timer visible");
  await expect(visible("[data-testid=r328-night-total-duration]"),"Trusted whole-night duration visibly distinct from the timer");
  await expect("(()=>{const h=document.querySelector('[data-testid=r329-personal-header]');return h&&h.getAttribute('src')==='/brand/personal-header.webp'&&h.naturalWidth>0&&h.getBoundingClientRect().height>0&&!document.querySelector('.np-r328-personal-watermark')})()","Approved Personal glass header decodes, with no obsolete watermark");

  const headerGeometry=await run("(()=>{const rect=x=>{const r=x.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height,top:r.top,bottom:r.bottom,left:r.left,right:r.right}},b=document.querySelector('.np-r323-header .np-brand'),h=document.querySelector('[data-testid=r329-personal-header]'),g=document.querySelector('.np-r323-greeting');return {viewport:{width:innerWidth,height:innerHeight},brand:rect(b),image:rect(h),greeting:rect(g)}})()");
  console.log("R323_HEADER_LAYOUT",screen.name,JSON.stringify(headerGeometry));
  await expect("(()=>{const b=document.querySelector('.np-r323-header .np-brand'),h=document.querySelector('[data-testid=r329-personal-header]'),g=document.querySelector('.np-r323-greeting');return b&&h&&g&&b.getBoundingClientRect().width>=Math.min(innerWidth-40,1000)&&h.getBoundingClientRect().bottom<=g.getBoundingClientRect().top+3})()","Full-width background header does not overlap dashboard information");
  await expect(visible("[data-testid=prayer-card]"),"Existing prayer card retained");
  await expect(visible("[data-testid=today-summary]"),"Existing progress retained");
  await expect("(()=>{const c=document.querySelector('.np-caffeine-card-r299'),d=document.querySelector('[data-testid=today-summary]'),w=document.querySelector('[data-testid=r332-weekly-card]'),s=c?.querySelector('.np-caffeine-signal-r295');if(!c||!d||!w||!s)return false;const a=c.getBoundingClientRect(),b=d.getBoundingClientRect(),k=w.getBoundingClientRect(),p=s.getBoundingClientRect();return a.bottom<=b.top+1&&b.bottom<=k.top+1&&Math.abs(p.width-p.height)<1&&getComputedStyle(s).borderTopLeftRadius==='50%'})()","Coffee indicator is circular and coffee, daily and weekly cards do not overlap");
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
  await expect("!document.querySelector(\'.np-r323-header [aria-label=\\\"فتح مركز التحكم\\\"]\')","No top control shortcut");
  await expect("(()=>{const ring=document.querySelector('.np-category-progress[aria-valuenow=\\\"100\\\"]'),label=ring?.querySelector(':scope > span');if(!ring||!label)return false;const range=document.createRange();range.selectNodeContents(label);const r=ring.getBoundingClientRect(),t=range.getBoundingClientRect();return t.width<=r.width*.7&&t.height<=r.height*.6&&Math.abs((t.left+t.right-r.left-r.right)/2)<2})()","R333 100 percent habit label fits inside the ring");
  await snap(screen.name+"-personal");
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
  if(more){await run("document.querySelector('[data-testid=r322-open-appointments]').click()");await expect("(()=>{const r=document.querySelector('.np-r322-appointments-sheet')?.getBoundingClientRect();return r&&r.height>50&&r.top<innerHeight-50&&r.bottom<=innerHeight+3})()","Appointment sheet must actually be visible in the viewport");await expect("(()=>{const a=document.querySelector(\".np-r332-schedule-overlay[data-open=true]\"),rows=a?.querySelectorAll(\".np-r324-event-row\");return a?.parentElement===document.body&&rows?.length>0&&Array.from(rows).every(r=>r.querySelector(\".np-r332-event-countdown [role=timer]\")?.textContent)})()","Floating schedule has a countdown for each event");await snap(screen.name+"-appointments");await run("document.querySelector('[aria-label=\"إغلاق المواعيد\"]').click()");}
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
  await find("[data-testid=r323-approved-dashboard]");
  await expect("document.querySelector('[data-testid=r324-nav-home]').getAttribute('aria-current')==='page'","Home navigation active");
  await run("document.querySelector('[data-testid=r324-nav-plus]').click()");
  await find(".np-r324-quick-sheet");
  await expect("document.querySelectorAll('.np-r324-quick-sheet > button').length===3","Quick add exposes task habit and appointment");
  await snap(screen.name+"-quick-add");
  await run("document.querySelector('.np-r324-quick-sheet > button').click()");
  await find("#definition-title");
  await expect("document.querySelector('[data-testid=r324-nav-plus]').getAttribute('aria-current')==='page'","Quick task navigation active");
  await snap(screen.name+"-quick-task");
  report.push({viewport:screen.name,width:screen.width,height:screen.height,appointmentFixtureVisible:more,layout:await run("Array.from(document.querySelectorAll('.np-r323-home-grid>.np-card')).filter(x=>x.getBoundingClientRect().height>0).map(x=>({className:x.className,width:Math.round(x.getBoundingClientRect().width),height:Math.round(x.getBoundingClientRect().height),top:Math.round(x.getBoundingClientRect().top)}))")});
 }
 await writeFile(resolve(output,"report.json"),JSON.stringify(report,null,2));
 console.log("R323_BROWSER_SMOKE_PASS "+JSON.stringify(report));
}finally{
 socket?.close();chrome?.kill();vite?.kill();await rm(htmlFile,{force:true});await rm(scriptFile,{force:true});await rm(profile,{recursive:true,force:true}).catch(()=>{});
}
