import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { DefinitionForm, NoorPersonalApplicationView, liveNextPrayer, nightCountdownState, civilDateLabels, formatLiveClock, headerLocationForTimeZone, nightMilestones, personalGreeting, remainingPrayerSeconds } from "../src/noor-personal-application-view.js";

function installDom(){
  const dom=new JSDOM(
    '<!doctype html><html lang="ar" dir="rtl"><head><title>Noor Personal test</title></head><body><div id="root"></div></body></html>',
    {url:"https://noor.test/personal",runScripts:"outside-only"},
  );
  // React is imported before JSDOM, so its input-event feature detection uses
  // the legacy listener branch. Bridge that listener API in this synthetic DOM.
  Object.defineProperties(dom.window.HTMLElement.prototype,{
    attachEvent:{value:function(this:HTMLElement,event:string,listener:EventListener){this.addEventListener(event.replace(/^on/,""),listener);}},
    detachEvent:{value:function(this:HTMLElement,event:string,listener:EventListener){this.removeEventListener(event.replace(/^on/,""),listener);}},
  });
  const globals={
    window:dom.window,
    document:dom.window.document,
    navigator:dom.window.navigator,
    Node:dom.window.Node,
    Element:dom.window.Element,
    HTMLElement:dom.window.HTMLElement,
    MutationObserver:dom.window.MutationObserver,
    getComputedStyle:dom.window.getComputedStyle.bind(dom.window),
    fetch:async()=>new Response(JSON.stringify({current:{temperature_2m:29.4}}),{status:200,headers:{"content-type":"application/json"}}),
    IS_REACT_ACT_ENVIRONMENT:true,
  } as const;
  const previous=new Map<string,PropertyDescriptor|undefined>();
  for(const [key,value] of Object.entries(globals)){
    previous.set(key,Object.getOwnPropertyDescriptor(globalThis,key));
    Object.defineProperty(globalThis,key,{configurable:true,writable:true,value});
  }
  const container=dom.window.document.getElementById("root")!;
  return{
    dom,
    container,
    restore(){
      for(const [key,descriptor] of previous){
        if(descriptor) Object.defineProperty(globalThis,key,descriptor);
        else Reflect.deleteProperty(globalThis,key);
      }
    },
  };
}

test("new task form saves a dated session per selected day and a separate topic",async()=>{
  const t=installDom(),root=createRoot(t.container);
  const oldFormData=globalThis.FormData;
  Object.defineProperty(globalThis,"FormData",{configurable:true,writable:true,value:t.dom.window.FormData});
  const commands:unknown[]=[];
  try{
    await act(async()=>root.render(createElement(DefinitionForm,{
      defaultKind:"Task",defaultStartDate:"2026-11-16",categories:["قراءة"],busy:false,
      onCommand:async command=>{commands.push(command);return true;},
    })));
    const form=t.container.querySelector<HTMLFormElement>("form")!;
    const field=<T extends HTMLInputElement|HTMLSelectElement>(selector:string)=>form.querySelector<T>(selector)!;
    const change=async(selector:string,value:string,type="change")=>act(async()=>{
      field(selector).value=value;field(selector).dispatchEvent(new t.dom.window.Event(type,{bubbles:true}));
    });
    field("#definition-title").value="قراءة كتاب";
    field("#definition-subcategory").value="تطوير الذات";
    await change('[aria-label="نهاية المدة: اليوم الميلادي"]',"20");
    await change('[aria-label="نهاية المدة: الشهر الميلادي"]',"11");
    await change('[aria-label="نهاية المدة: السنة الميلادية"]',"2026");
    await change("#definition-repeat","Weekdays");
    for(const day of [1,3,5])await act(async()=>field<HTMLInputElement>(`[name="weekday"][value="${day}"]`).click());
    await change("#progress-target","10","input");
    assert.match(form.querySelector(".np-task-plan-preview")?.textContent??"",/3 جلسة موزعة تلقائيًا/);
    await act(async()=>form.dispatchEvent(new t.dom.window.Event("submit",{bubbles:true,cancelable:true})));
    const saved=commands[0] as {subcategory:string;sessionPlan:{sessions:{scheduledDate:string;target:number}[]}};
    assert.equal(saved.subcategory,"تطوير الذات");
    assert.deepEqual(saved.sessionPlan.sessions.map(x=>[x.scheduledDate,x.target]),[["2026-11-16",4],["2026-11-18",3],["2026-11-20",3]]);
  }finally{
    await act(async()=>root.unmount());
    Object.defineProperty(globalThis,"FormData",{configurable:true,writable:true,value:oldFormData});
    t.restore();t.dom.window.close();
  }
});

test("sleep completion opens its editor and cancellation leaves the habit unchecked",async()=>{
 const t=installDom(),root=createRoot(t.container);
 const sleep={...workspace.workspace.definitions[1]!,title:"النوم مبكرًا"};
 const input={...workspace,workspace:{...workspace.workspace,definitions:[workspace.workspace.definitions[0]!,sleep]}};
 try{
  await act(async()=>root.render(createElement(NoorPersonalApplicationView,{initialResult:today,initialWorkspace:input})));
  const checkbox=t.container.querySelector<HTMLButtonElement>('[role="checkbox"][aria-label="تسجيل النوم"]')!;
  assert.equal(checkbox.getAttribute("aria-checked"),"false");
  await act(async()=>checkbox.click());
  const dialog=document.querySelector('[role="dialog"][aria-label="متابعة النوم"]');
  assert.ok(dialog);
  assert.equal(dialog.querySelector<HTMLInputElement>('input[type="date"]')?.readOnly,true);
  assert.equal(checkbox.getAttribute("aria-checked"),"false");
  await act(async()=>dialog.querySelector<HTMLButtonElement>('[aria-label="إغلاق متابعة النوم"]')!.click());
  assert.equal(document.querySelector('[role="dialog"][aria-label="متابعة النوم"]'),null);
  assert.equal(checkbox.getAttribute("aria-checked"),"false");
 }finally{
  await act(async()=>root.unmount());t.restore();t.dom.window.close();
 }
});

test("prayer habit opens the prayer editor and saves against its own execution",async()=>{
 const t=installDom(),root=createRoot(t.container),commands:unknown[]=[];
 const fetcher=globalThis.fetch;
 let resolveSave:(response:Response)=>void=()=>{};
 const habit={...workspace.workspace.definitions[1]!,title:"صلاة الفجر"};
 const input={...workspace,workspace:{...workspace.workspace,definitions:[workspace.workspace.definitions[0]!,habit]}};
 const initialResult={...today,today:{...today.today,islamicContext:{...today.today.islamicContext,prayerTimes:{...today.today.islamicContext.prayerTimes,fajr:new Date(Date.now()-60_000).toISOString()}}}};
 globalThis.fetch=async(url,options)=>{
  if(String(url).includes("/command")){
   commands.push(JSON.parse(String(options?.body)));
   return new Promise<Response>(resolve=>{resolveSave=resolve;});
  }
  return fetcher(url,options);
 };
 try{
  await act(async()=>root.render(createElement(NoorPersonalApplicationView,{initialResult,initialWorkspace:input})));
  const checkbox=t.container.querySelector<HTMLButtonElement>('[role="checkbox"][aria-label="تسجيل أداء صلاة الفجر"]')!;
  assert.ok(checkbox);
  await act(async()=>checkbox.click());
  assert.equal(checkbox.getAttribute("aria-checked"),"false");
  assert.equal(commands.length,0);
  const dialog=document.querySelector('.np-prayer-record-dialog')!;
  const save=[...dialog.querySelectorAll<HTMLButtonElement>("button")].find(button=>button.textContent==="حفظ الأداء")!;
  await act(async()=>save.click());
  assert.equal((commands[0] as {habitExecutionId:string})?.habitExecutionId,"e2");
  assert.equal(document.querySelector('.np-prayer-record-dialog'),null);
  assert.equal(checkbox.getAttribute("aria-checked"),"true");
  assert.match(t.container.querySelector(".np-day-achievement-copy")!.textContent!,/1 من 2/);
  await act(async()=>resolveSave(new Response(null,{status:503})));
  assert.equal(checkbox.getAttribute("aria-checked"),"false");
  assert.ok(t.container.querySelector(".np-failed-save"));
 }finally{await act(async()=>root.unmount());t.restore();t.dom.window.close();}
});

test("midnight rollover keeps compact task cards and past prayer recording on its own date",async()=>{
 const t=installDom(),root=createRoot(t.container),date="2026-10-24";
 const definitions=[workspace.workspace.definitions[0]!,{...workspace.workspace.definitions[1]!,title:"صلاة العصر"}];
 const rows=[
  {date,id:"past-task",definitionId:"d1",kind:"Task",title:"تمرين",status:"Planned",weight:1,amount:0,unit:""},
  {date,id:"past-asr",definitionId:"d2",kind:"Habit",title:"صلاة العصر",status:"Missed",weight:1,amount:0,unit:""},
  {date:"2026-10-21",id:"archived-miss",definitionId:"d1",kind:"Task",title:"مهمة قديمة",status:"Missed",weight:5,amount:0,unit:""},
 ];
 const beforeMidnight={...today,today:{...today.today,personalDay:{...today.today.personalDay,boundary:{...today.today.personalDay.boundary,endAt:"2026-10-24T21:00:00Z"}}}};
 const nextDay={...today.today,personalDay:{...today.today.personalDay,id:"next-day",boundary:{...today.today.personalDay.boundary,localDate:"2026-10-25",endAt:"2026-10-25T21:00:00Z"}}};
 const originalNow=Date.now,originalInterval=t.dom.window.setInterval;
 let now=Date.parse("2026-10-24T20:59:59Z"),tick:()=>void=()=>{},todayReads=0;
 Date.now=()=>now;
 t.dom.window.setInterval=((handler:TimerHandler,delay?:number,...args:unknown[])=>{
  if(delay===1000){tick=handler as ()=>void;return 99999;}
  return originalInterval.call(t.dom.window,handler,delay,...args);
 }) as typeof t.dom.window.setInterval;
 const initialWorkspace={...workspace,workspace:{...workspace.workspace,definitions,statistics:{currentDate:"2026-10-25",rows}}};
 const fetcher=globalThis.fetch;
 let command:unknown,resolveSave:(response:Response)=>void=()=>{};
 globalThis.fetch=async(url,options)=>{
  if(String(url).endsWith("/today")){
   todayReads++;
   return new Response(JSON.stringify({...nextDay,workspace:initialWorkspace.workspace}),{headers:{"content-type":"application/json"}});
  }
  if(!String(url).includes("/command"))return fetcher(url,options);
  command=JSON.parse(String(options?.body));
  return new Promise<Response>(resolve=>{resolveSave=resolve;});
 };
 try{
  await act(async()=>root.render(createElement(NoorPersonalApplicationView,{initialResult:beforeMidnight,initialWorkspace})));
  const currentTask=()=>t.container.querySelector("#noor-r323-tasks .np-today-task-button");
  assert.ok(currentTask());
  now+=1000;
  await act(async()=>tick());
  assert.equal(todayReads,1);
  assert.equal(t.container.querySelector("[data-board-date]")?.getAttribute("data-board-date"),"2026-10-25");
  assert.ok(currentTask());
  const todayAsr=t.container.querySelector<HTMLButtonElement>('[data-testid="activity-card-e2"] [role="checkbox"]')!;
  assert.equal(todayAsr.disabled,true);
  const recoveryButton=t.container.querySelector<HTMLButtonElement>(".np-r339-recovery")!;
  assert.equal(recoveryButton.querySelector("strong")?.textContent,"1");
  await act(async()=>recoveryButton.click());
  const recentSheet=document.querySelector('[role="dialog"][aria-label="تدارك الفائت"]')!;
  assert.equal(recentSheet.querySelectorAll(".np-r339-recovery-days button").length,1);
  assert.match(recentSheet.textContent??"",/تمرين/);
  assert.doesNotMatch(recentSheet.textContent??"",/مهمة قديمة|صلاة العصر/);
  await act(async()=>recentSheet.querySelector<HTMLButtonElement>('[aria-label="إغلاق التدارك"]')!.click());
  await act(async()=>t.container.querySelector<HTMLButtonElement>(`[data-week-date="${date}"]`)!.click());
  const task=t.container.querySelector<HTMLButtonElement>("#noor-r323-tasks .np-today-task-button")!;
  assert.equal(task.querySelector("strong")?.textContent,"تمرين");
  assert.equal(t.container.querySelector("#noor-r323-tasks .np-activity-item"),null);
  await act(async()=>task.click());
  const taskDialog=document.querySelector('[role="dialog"][aria-label="المهام"]')!;
  assert.ok(taskDialog.querySelector('[data-testid="activity-card-past-task"]'));
  assert.match(taskDialog.textContent??"",/تصحيح السجل/);
  await act(async()=>[...taskDialog.querySelectorAll<HTMLButtonElement>("button")].find(button=>button.textContent==="تصحيح السجل")!.click());
  const recovery=document.querySelector<HTMLElement>('.np-recovery-date-sheet')!;
  assert.ok(recovery);
  assert.equal(command,undefined);
  await act(async()=>recovery.querySelector<HTMLInputElement>(`input[value="${date}"]`)!.click());
  await act(async()=>recovery.querySelector("form")!.dispatchEvent(new t.dom.window.Event("submit",{bubbles:true,cancelable:true})));
  assert.deepEqual(command,{type:"recover-historical-execution",executionId:"past-task",localDate:date,performedOn:date,expectedStatus:"Planned"});
  await act(async()=>resolveSave(new Response(null,{status:503})));
  await act(async()=>recovery.querySelector<HTMLButtonElement>('[aria-label="إغلاق تسجيل الإتمام"]')!.click());
  command=undefined;

  await act(async()=>taskDialog.querySelector<HTMLButtonElement>('[aria-label="إغلاق المهام"]')!.click());
  const checkbox=t.container.querySelector<HTMLButtonElement>('[data-testid="activity-card-past-asr"] [role="checkbox"]')!;
  await act(async()=>checkbox.click());
  assert.equal(checkbox.getAttribute("aria-checked"),"false");
  assert.equal(command,undefined);
  const editor=document.querySelector(".np-prayer-record-dialog")!;
  assert.ok(editor);
  await act(async()=>[...editor.querySelectorAll<HTMLButtonElement>("button")].find(button=>button.textContent==="حفظ الأداء")!.click());
  assert.deepEqual(command,{type:"record-prayer-r331",localDate:date,key:"asr",mode:"group",timing:"ontime",expectedRecordedAt:null,habitExecutionId:"past-asr"});
  assert.equal(checkbox.getAttribute("aria-checked"),"true");
  await act(async()=>resolveSave(new Response(null,{status:503})));
  assert.equal(checkbox.getAttribute("aria-checked"),"false");
 }finally{await act(async()=>root.unmount());Date.now=originalNow;t.dom.window.setInterval=originalInterval;t.restore();t.dom.window.close();}
});

test("R367 quick add changes form inside one centered overlay",async()=>{
 const t=installDom(),root=createRoot(t.container);
 try{
  await act(async()=>root.render(createElement(NoorPersonalApplicationView,{initialResult:today,initialWorkspace:workspace})));
  await act(async()=>t.container.querySelector<HTMLButtonElement>('[data-testid="r324-nav-plus"]')!.click());
  const dialog=document.querySelector<HTMLElement>(".np-r324-quick-sheet")!;
  assert.deepEqual([...dialog.querySelectorAll(":scope > button")].map(button=>button.textContent),["إضافة مهمة","إضافة عادة","إضافة موعد"]);
  await act(async()=>dialog.querySelector<HTMLButtonElement>(":scope > button")!.click());
  assert.ok(document.querySelector(".np-r324-quick-sheet")===dialog);
  assert.ok(dialog.querySelector("#np-definition-edit-form"));
  assert.ok(t.container.querySelector('[data-testid="r331-announcement-board"]'));
  await act(async()=>[...dialog.querySelectorAll<HTMLButtonElement>("footer button")].find(button=>button.textContent==="رجوع")!.click());
  assert.equal(dialog.querySelectorAll(":scope > button").length,3);
 }finally{await act(async()=>root.unmount());t.restore();t.dom.window.close();}
});

test("daily percentage rounds the combined total and each session earns the task’s weight",async()=>{
 const t=installDom(),root=createRoot(t.container);
 const date=today.today.personalDay.boundary.localDate;
 const def={...workspace.workspace.definitions[0]!,weight:4,measurement:{target:4,unit:"صفحة"},
  sessionPlan:{distribution:"equal",sessions:Array.from({length:4},(_,i)=>({
   id:`s-${i}`,title:`الجلسة ${i+1}`,objective:"",target:1,rangeStart:null,rangeEnd:null,scheduledDate:date,
   order:i+1,note:"",revision:0,createdAt:date+"T00:00:00Z",updatedAt:date+"T00:00:00Z",completedAt:null,
  }))}};
 const heavyHabit={...today.today.habits[0]!,weight:99};
 const input={...today,today:{...today.today,habits:[heavyHabit],tasks:[{...today.today.tasks[0]!,weight:4}]}};
 const fetcher=globalThis.fetch;
 let resolve:(response:Response)=>void=()=>{};
 globalThis.fetch=async(url,options)=>String(url).includes("/command")
  ?new Promise<Response>(r=>{resolve=r;})
  :fetcher(url,options);
 const score=()=>t.container.querySelector('[data-testid="today-completion-rate"]')?.textContent;
 try{
  await act(async()=>root.render(createElement(NoorPersonalApplicationView,{initialResult:input,initialWorkspace:{...workspace,workspace:{...workspace.workspace,definitions:[def,workspace.workspace.definitions[1]!]}}})));
  assert.equal(score(),"0%");
  await act(async()=>t.container.querySelector<HTMLButtonElement>('.np-today-task-button')!.click());
  await act(async()=>document.querySelector<HTMLInputElement>('[data-testid="r285-session-complete-s-0"]')!.click());
  assert.equal(score(),"3%");
  assert.match(t.container.querySelector('[data-testid="daily-session-achievement"]')?.textContent??"",/4 نقطة/);
  await act(async()=>resolve(new Response(null,{status:503})));
  assert.equal(score(),"0%");
 }finally{await act(async()=>root.unmount());t.restore();t.dom.window.close();}
});

const futurePrayerAt=new Date(Date.now()+3_600_000).toISOString();
const today={kind:"success" as const,today:{personalDay:{id:"day",userId:"user",state:"Open",boundary:{localDate:"2026-10-24",timeZone:"Asia/Riyadh"}},islamicContext:{hijriDate:{day:13,month:5,year:1448},prayerTimes:{fajr:"2026-10-25T01:37:00.000Z",nextFajr:"2026-10-26T01:38:00.000Z",sunrise:"2026-10-25T02:54:00.000Z",dhuhr:"2026-10-25T08:38:00.000Z",asr:"2026-10-25T11:52:00.000Z",maghrib:"2026-10-25T14:20:00.000Z",isha:"2026-10-25T15:50:00.000Z"}},nextPrayer:{name:"Fajr",at:futurePrayerAt,secondsRemaining:3600},tasks:[{id:"e1",definitionId:"d1",kind:"Task",title:"تمرين",status:"Planned"}],habits:[{id:"e2",definitionId:"d2",kind:"Habit",title:"المشي",status:"Pending"}],automationPending:0}};
const workspace={kind:"success" as const,workspace:{definitions:[{id:"d1",kind:"Task",title:"تمرين",state:"Active",category:"الصحة والرياضة",schedule:{kind:"Weekdays",weekdays:[0,2,4]},effectiveFromDate:"2026-10-25",importance:"Important"},{id:"d2",kind:"Habit",title:"المشي",state:"Active",category:"الصحة والرياضة",schedule:{kind:"Daily"},effectiveFromDate:"2026-10-25",importance:"Supporting"}],insights:{currentStreakDays:2,bestStreakDays:4,periods:{week:{windowDays:7,scheduled:2,completed:0,completionRate:0,successfulDays:0},month:{windowDays:30,scheduled:2,completed:0,completionRate:0,successfulDays:0},quarter:{windowDays:90,scheduled:2,completed:0,completionRate:0,successfulDays:0},year:{windowDays:365,scheduled:2,completed:0,completionRate:0,successfulDays:0}}}}};


test("R287 regression: Personal renders a task with scheduled reading sessions without crashing the entire app",async()=>{
 const t=installDom();
 const root=createRoot(t.container);
 let resolveSave:(response:Response)=>void=()=>{};
 let command:unknown;
 const fetcher=globalThis.fetch;
 globalThis.fetch=async(url,options)=>{
  if(!String(url).includes("/command"))return fetcher(url,options);
  command=JSON.parse(String(options?.body));
  return new Promise<Response>(resolve=>{resolveSave=resolve;});
 };
 const readingTask={
  ...workspace.workspace.definitions[0]!,
  title:"قراءة كتاب",revisionId:"revision-reading",measurement:{target:12,unit:"صفحة"},
  sessionPlan:{distribution:"custom",sessions:[{
   id:"reading-session-one",title:"الجلسة الأولى",objective:"قراءة 12 صفحة",
   target:12,rangeStart:1,rangeEnd:12,scheduledDate:"2026-10-24",
   order:1,note:"",revision:0,createdAt:"2026-10-24T00:00:00Z",
   updatedAt:"2026-10-24T00:00:00Z",completedAt:null,
  }]},
 };
 const input={...workspace,workspace:{...workspace.workspace,definitions:[readingTask,workspace.workspace.definitions[1]!]}};
 try{
  await act(async()=>{root.render(createElement(NoorPersonalApplicationView,{initialResult:today,initialWorkspace:input}));});
  assert.ok(t.container.querySelector('[data-testid="today-summary"]'),"Personal view should remain mounted");
  await act(async()=>t.container.querySelector<HTMLButtonElement>(".np-today-task-button")!.click());
  assert.ok(t.dom.window.document.querySelector('[data-testid="task-sessions-r254"]'),"Scheduled reading session should be rendered");
  assert.ok(t.dom.window.document.querySelector('[data-testid="r285-session-complete-reading-session-one"]'),"Session completion checkbox should be visible");
  assert.equal(t.dom.window.document.querySelector('[data-testid="r285-session-complete-reading-session-one"]')?.hasAttribute("disabled"),false,
   "Today-owned scheduled session must remain actionable");
  const completion=t.dom.window.document.querySelector<HTMLButtonElement>('[role="checkbox"][aria-label="تسجيل تفاصيل قراءة كتاب"]')!;
  assert.equal(completion.getAttribute("aria-checked"),"false");
  await act(async()=>completion.click());
  const editor=t.dom.window.document.querySelector('[role="dialog"][aria-label="تسجيل قراءة كتاب"]');
  assert.ok(editor?.querySelector('[data-testid="r285-session-complete-reading-session-one"]'));
  assert.equal(completion.getAttribute("aria-checked"),"false");
  const sessionCheckbox=editor!.querySelector<HTMLInputElement>('[data-testid="r285-session-complete-reading-session-one"]')!;
  await act(async()=>sessionCheckbox.click());
  assert.equal((command as {type:string}).type,"record-task-session-progress");
  assert.equal(sessionCheckbox.checked,true);
  assert.equal(t.container.querySelector(".np-today-task-button span")!.textContent,"100%");
  await act(async()=>resolveSave(new Response(null,{status:503})));
  assert.equal(sessionCheckbox.checked,false);
  assert.equal(t.container.querySelector(".np-today-task-button span")!.textContent,"0%");
  assert.ok(t.container.querySelector(".np-failed-save"));
 } finally{
  await act(async()=>{root.unmount();});
  t.restore();t.dom.window.close();
 }
});

test("civil header uses Latin 0-9 digits and no year grouping",()=>{const labels=civilDateLabels(Date.parse("2026-10-25T12:00:00.000Z"),"Asia/Riyadh");assert.match(labels.hijri,/1448/);assert.doesNotMatch(labels.hijri,/1,448/);assert.match(labels.gregorian,/2026/);assert.doesNotMatch(`${labels.gregorian} ${labels.hijri}`,/[٠-٩]/);});
test("prayer countdown derives continuously from prayer instant rather than stored secondsRemaining",()=>{const at="2026-10-25T12:00:10.000Z";assert.equal(remainingPrayerSeconds(at,Date.parse("2026-10-25T12:00:00.000Z")),10);assert.equal(remainingPrayerSeconds(at,Date.parse("2026-10-25T12:00:03.000Z")),7);});
test("night milestones are the midpoint and start of the final third between maghrib and the following fajr",()=>{const milestones=nightMilestones([{key:"fajr",label:"الفجر",at:"2026-10-25T01:00:00.000Z"},{key:"maghrib",label:"المغرب",at:"2026-10-25T15:00:00.000Z"}],"2026-10-26T01:00:00.000Z");assert.ok(milestones);assert.equal(milestones.midnight,"2026-10-25T20:00:00.000Z");assert.equal(milestones.lastThird,"2026-10-25T21:40:00.000Z");});
test("header location follows the active Noor timezone for Riyadh and Cairo",()=>{assert.deepEqual(headerLocationForTimeZone("Asia/Riyadh"),{city:"الرياض",country:"السعودية",latitude:24.7136,longitude:46.6753});assert.deepEqual(headerLocationForTimeZone("Africa/Cairo"),{city:"القاهرة",country:"مصر",latitude:30.0444,longitude:31.2357});});
test("live clock uses Latin 0-9 digits in the requested timezone",()=>{const value=formatLiveClock(Date.parse("2026-10-25T11:03:04.000Z"),"Asia/Riyadh");assert.match(value,/2/);assert.match(value,/03/);assert.doesNotMatch(value,/[٠-٩]/);});
test("personal greeting follows the account time zone at all four boundaries",()=>{
 const riyadh=(hour:string)=>personalGreeting(Date.parse(`2026-11-17T${hour}:00+03:00`),"Asia/Riyadh");
 assert.deepEqual(["00:00","04:59","05:00","11:59","12:00","16:59","17:00","20:59","21:00"].map(riyadh),
  ["طابت ليلتك","طابت ليلتك","صباح الخير","صباح الخير","طاب يومك","طاب يومك","مساء الخير","مساء الخير","طابت ليلتك"]);
 assert.equal(personalGreeting(Date.parse("2026-11-17T21:30:00+03:00"),"Europe/London"),"مساء الخير");
});
test("greeting switches at Fajr, the configured end of Duha, Asr and Isha",()=>{
 const at=(time:string)=>`2026-11-17T${time}:00+03:00`;
 const times=Object.entries({fajr:"04:48",sunrise:"06:10",dhuhr:"11:40",asr:"14:54",maghrib:"17:05",isha:"18:35"}).map(([key,time])=>({key,at:at(time)}));
 assert.deepEqual(["04:47","04:48","11:24","11:25","14:54","18:35"].map(time=>personalGreeting(Date.parse(at(time)),"Asia/Riyadh",times)),
  ["طابت ليلتك","صباح الخير","صباح الخير","طاب يومك","مساء الخير","طابت ليلتك"]);
});
test("dashboard groups items into category cards and opens a separate control center",async()=>{const t=installDom();const root=createRoot(t.container);try{await act(async()=>{root.render(createElement(NoorPersonalApplicationView,{initialResult:today,initialWorkspace:workspace}));});const wordmark=t.container.querySelector(".np-r339-wordmark");assert.equal(wordmark?.textContent,"NOOR Personal");assert.equal(wordmark?.querySelector("img"),null);assert.ok(t.container.querySelector('button[aria-label="الملف الشخصي"]'));assert.doesNotMatch(t.container.textContent??"",/نور بيرسونال/);assert.ok(t.container.querySelector('[data-testid="header-information"]'));assert.match(t.container.textContent??"",/الرياض/);assert.match(t.container.textContent??"",/السعودية/);assert.ok(t.container.querySelector('[data-testid="live-clock"]'));assert.ok(t.container.querySelector('[data-testid="header-temperature"]'));assert.ok(t.container.querySelector('[data-testid="prayer-card"]'));assert.ok(t.container.querySelector('[data-testid="today-summary"]'));assert.equal(t.container.querySelector('[data-testid="today-completion-rate"]')?.textContent,"0%");assert.equal(t.container.querySelector('section[data-design-version="r62-visible-layout-fix"]')?.getAttribute("dir"),"rtl");assert.ok(t.container.querySelector('[data-testid="prayer-times-strip"]'));assert.equal(t.container.querySelector('[data-testid="prayer-card"]')?.getAttribute("data-prayer-layout"),"compact-five-obligatory-r331");assert.equal(t.container.querySelector('[data-header-layout="padding-only-132"]')?.getAttribute("data-header-layout"),"padding-only-132");assert.equal(t.container.querySelectorAll("[data-prayer-key]").length,5);assert.equal(t.container.querySelectorAll("[data-testid=r331-announcement-board] .np-r331-board-grid>.np-r331-tile").length,6);const recovery=t.container.querySelector<HTMLButtonElement>(".np-r339-recovery")!;assert.match(recovery.textContent??"",/تدارك ما فاتك/);await act(async()=>recovery.click());const recoveryDialog=document.querySelector('[role="dialog"][aria-label="تدارك الفائت"]')!;assert.equal(recoveryDialog.querySelectorAll(".np-r339-recovery-days button").length,0);assert.match(recoveryDialog.textContent??"",/لا يوجد فائت قابل للتدارك/);await act(async()=>recoveryDialog.querySelector<HTMLButtonElement>('button[aria-label="إغلاق التدارك"]')!.click());assert.match(t.container.querySelector("[data-testid=r331-announcement-board]")?.textContent??"",/الأحداث التاريخية/);assert.ok(t.container.querySelector('[data-testid="prayer-card"]')?.closest("[hidden]"));const prayerButton=[...t.container.querySelectorAll<HTMLButtonElement>(".np-r331-board-grid button")].find(b=>b.textContent?.includes("الصلاة القادمة"))!;await act(async()=>prayerButton.click());assert.equal(t.container.querySelector('[data-testid="prayer-card"]')?.closest("[hidden]"),null);assert.equal(t.container.querySelectorAll(".np-r339-friday-grid>div").length,5);await act(async()=>t.container.querySelector<HTMLButtonElement>('button[aria-label="إغلاق مواقيت الصلوات"]')!.click());assert.ok(t.container.querySelector('[data-testid="prayer-card"]')?.closest("[hidden]"));assert.ok(t.container.querySelector("[data-testid=noor-day-night-friday-r232]"),"Night and solar details remain in the timer sheet");assert.ok(t.container.querySelector(".np-r324-schedule-sheet"),"Additional verified times remain in the schedule sheet");assert.deepEqual([...t.container.querySelectorAll("[data-prayer-key]")].map(node=>node.getAttribute("data-prayer-key")),["fajr","dhuhr","asr","maghrib","isha"]);assert.match(t.container.querySelector("[data-testid=r331-announcement-board]")?.textContent??"",/الصلاة القادمة/);assert.match(t.container.textContent??"",/الصحة والرياضة/);const countdown=t.container.querySelector('[data-testid="prayer-countdown"]');assert.ok(countdown);assert.ok(countdown.closest('[data-prayer-key="fajr"]'));assert.doesNotMatch(t.container.textContent??"",/[٠-٩]/);assert.doesNotMatch(t.container.textContent??"",/أضف مهمة لليوم/);const gear=t.container.querySelector('button[aria-label="فتح مركز التحكم"]') as HTMLButtonElement;assert.ok(gear);await act(async()=>{gear.click();});assert.match(t.container.textContent??"",/أدوات نور/);assert.equal(t.container.querySelectorAll('.np-r356-overview-card').length,7);assert.ok(t.container.querySelector('img[alt="شعار NOOR Personal"][src="/brand/icon-r369-192.png"]'));assert.doesNotMatch(t.container.textContent??"",/نور بيرسونال/);assert.ok(t.container.querySelector('#definition-title') === null);}finally{await act(async()=>{root.unmount();});t.restore();t.dom.window.close();}});

test('habit duration switches between continuous and required end date, and edit preloads the saved schedule',async()=>{const t=installDom(),root=createRoot(t.container);const data={...workspace,workspace:{...workspace.workspace,definitions:workspace.workspace.definitions.map(d=>({...d,revisionId:'r1'}))}};try{await act(async()=>root.render(createElement(NoorPersonalApplicationView,{initialResult:today,initialWorkspace:data})));await act(async()=>(t.container.querySelector('button[aria-label="فتح مركز التحكم"]') as HTMLButtonElement).click());await act(async()=>[...t.container.querySelectorAll<HTMLButtonElement>('.np-cc-nav-item')].find(b=>b.textContent?.includes('العادات'))!.click());await act(async()=>(t.container.querySelector('[aria-controls="np-detail-d2"]') as HTMLButtonElement).click());await act(async()=>[...t.container.querySelectorAll('button')].find(b=>b.textContent==='تعديل البيانات والجدول')!.click());assert.equal((t.container.querySelector('#definition-title') as HTMLInputElement).value,'المشي');assert.equal((t.container.querySelector('#definition-start') as HTMLInputElement).value,'2026-10-25');const duration=t.container.querySelector('#definition-duration') as HTMLSelectElement;assert.equal(duration.value,'continuous');assert.equal(t.container.querySelector('#definition-end'),null);await act(async()=>{duration.value='limited';duration.dispatchEvent(new t.dom.window.Event('change',{bubbles:true}));});assert.equal((t.container.querySelector('#definition-end') as HTMLInputElement).required,true);const repeat=t.container.querySelector('#definition-repeat') as HTMLSelectElement;await act(async()=>{repeat.value='Weekdays';repeat.dispatchEvent(new t.dom.window.Event('change',{bubbles:true}));});assert.equal(t.container.querySelectorAll('input[name="weekday"]').length,7);await act(async()=>(t.container.querySelector('input[name="weekday"][value="1"]') as HTMLInputElement).click());assert.match(t.container.textContent??'',/أيام التكرار: 1 من 7/);}finally{await act(async()=>root.unmount());t.restore();t.dom.window.close();}});

test('category names come from account and EGP debt payments remain outside SAR accounts',async()=>{const t=installDom(),root=createRoot(t.container);const finance={userId:'user',currency:'SAR',accounts:[],debts:[{id:'d',person:'جهة اختبار',direction:'receivable',currency:'EGP',dueDate:null,note:'ملاحظة'}],entries:[{id:'debt:d',kind:'opening-receivable',amountMinor:10000,date:'2026-10-01',accountId:null,targetAccountId:null,debtId:'d',category:'دين',note:'',createdAt:'2026-10-01T00:00:00Z'},{id:'p',kind:'repay',amountMinor:2500,date:'2026-10-20',accountId:null,targetAccountId:null,debtId:'d',category:'سداد',note:'دفعة',createdAt:'2026-10-20T00:00:00Z'}],requests:[]};try{await act(async()=>root.render(createElement(NoorPersonalApplicationView,{initialResult:today,initialWorkspace:{...workspace,workspace:{...workspace.workspace,categories:['تصنيف مخصص'],finance}}})));await act(async()=>(t.container.querySelector('button[aria-label="فتح مركز التحكم"]') as HTMLButtonElement).click());await act(async()=>[...t.container.querySelectorAll<HTMLButtonElement>('.np-cc-nav-item')].find(b=>b.textContent==='التصنيفات')!.click());assert.ok(t.container.querySelector('[aria-label="تعديل تصنيف تصنيف مخصص"]'));await act(async()=>(t.container.querySelector('[aria-label="تعديل تصنيف تصنيف مخصص"]') as HTMLButtonElement).click());assert.equal((t.container.querySelector('#category-name') as HTMLInputElement).value,'');const inline=t.container.querySelector('.np-r286-inline-category input[aria-label="تعديل اسم تصنيف تصنيف مخصص"]') as HTMLInputElement;assert.ok(inline,'editing must take place in the original category row');assert.equal(inline.value,'تصنيف مخصص');await act(async()=>[...t.container.querySelectorAll<HTMLButtonElement>('.np-cc-nav-item')].find(b=>b.textContent==='المالية')!.click());await act(async()=>[...t.container.querySelectorAll<HTMLButtonElement>('.nf-tabs button')].find(b=>b.textContent==='الدائن والمدين')!.click());await act(async()=>(t.container.querySelector('.nf-person') as HTMLButtonElement).click());assert.match(t.container.textContent??'',/19 يوم/);assert.match(t.container.textContent??'',/75\.00 ج\.م/);assert.match(t.container.textContent??'',/سداد جزئي/);await act(async()=>[...t.container.querySelectorAll<HTMLButtonElement>('.nf-debt-table button')].find(b=>b.textContent==='تسجيل تحصيل')!.click());const account=t.dom.window.document.querySelector('.nf-dialog select[name="accountId"]') as HTMLSelectElement;assert.equal(account.value,'');assert.equal(account.options.length,1);assert.match(t.dom.window.document.querySelector('.nf-dialog')?.textContent??'',/ج\.م/);}finally{await act(async()=>root.unmount());t.restore();t.dom.window.close();}});

test('Gregorian date fields use explicit civil months and clamp leap-day selections',async()=>{const t=installDom(),root=createRoot(t.container);try{await act(async()=>root.render(createElement(NoorPersonalApplicationView,{initialResult:today,initialWorkspace:workspace})));await act(async()=>(t.container.querySelector('button[aria-label="فتح مركز التحكم"]') as HTMLButtonElement).click());await act(async()=>[...t.container.querySelectorAll<HTMLButtonElement>('.np-cc-nav-item')].find(b=>b.textContent?.includes('العادات'))!.click());await act(async()=>[...t.container.querySelectorAll('button')].find(b=>b.textContent==='+ إضافة عادة')!.click());const fields=t.container.querySelectorAll<HTMLSelectElement>('.np-gregorian-parts select');const change=async(index:number,value:string)=>act(async()=>{fields[index]!.value=value;fields[index]!.dispatchEvent(new t.dom.window.Event('change',{bubbles:true}));});await change(2,'2028');await change(1,'02');await change(0,'29');assert.equal((t.container.querySelector('#definition-start') as HTMLInputElement).value,'2028-02-29');await change(2,'2027');assert.equal((t.container.querySelector('#definition-start') as HTMLInputElement).value,'2027-02-28');assert.equal(t.container.querySelectorAll('input[type="date"]').length,0);assert.match(fields[1]?.textContent??'',/فبراير/);}finally{await act(async()=>root.unmount());t.restore();t.dom.window.close();}});
test('permanent-delete confirmation lives outside clipped details, focuses input and cancels without a command',async()=>{const t=installDom(),root=createRoot(t.container);const viewport=Object.assign(new t.dom.window.EventTarget(),{height:300,offsetTop:20});Object.defineProperty(t.dom.window,'visualViewport',{configurable:true,value:viewport});const originalFetch=globalThis.fetch;let commands=0;Object.defineProperty(globalThis,'fetch',{configurable:true,writable:true,value:async(url:unknown,options?:RequestInit)=>{if(String(url).includes('/command'))commands++;return originalFetch(url as RequestInfo,options);}});try{await act(async()=>root.render(createElement(NoorPersonalApplicationView,{initialResult:today,initialWorkspace:workspace})));await act(async()=>(t.container.querySelector('button[aria-label="فتح مركز التحكم"]') as HTMLButtonElement).click());await act(async()=>[...t.container.querySelectorAll<HTMLButtonElement>('.np-cc-nav-item')].find(b=>b.textContent?.includes('العادات'))!.click());await act(async()=>(t.container.querySelector('[aria-controls="np-detail-d2"]') as HTMLButtonElement).click());const opener=[...t.container.querySelectorAll('button')].find(b=>b.textContent==='حذف نهائي من قاعدة البيانات')!;opener.focus();await act(async()=>opener.click());const dialog=t.dom.window.document.querySelector('[role="alertdialog"]')!;assert.ok(dialog);await act(async()=>{viewport.height=220;viewport.dispatchEvent(new t.dom.window.Event('resize'));});assert.equal((dialog as HTMLElement).style.maxHeight,'188px');assert.equal((dialog.parentElement as HTMLElement).style.height,'220px');assert.equal(dialog.closest('.np-cc-inline-detail'),null);assert.equal(t.container.contains(dialog),false);assert.equal(t.dom.window.document.activeElement?.id,'np-delete-phrase');const input=dialog.querySelector('#np-delete-phrase') as HTMLInputElement;await act(async()=>{input.value='حذف';input.dispatchEvent(new t.dom.window.Event('input',{bubbles:true}));});assert.equal((dialog.querySelector('button.confirm') as HTMLButtonElement).disabled,false);await act(async()=>dialog.dispatchEvent(new t.dom.window.KeyboardEvent('keydown',{key:'Escape',bubbles:true})));assert.equal(t.dom.window.document.querySelector('[role="alertdialog"]'),null);assert.equal(t.dom.window.document.body.style.overflow,'');assert.equal(commands,0);}finally{await act(async()=>root.unmount());t.restore();t.dom.window.close();}});

test('person edit preloads name and notes, submits a guarded command and retains failed input',async()=>{const t=installDom(),root=createRoot(t.container);const finance={userId:'user',currency:'SAR',accounts:[],debts:[],entries:[],requests:[],people:[{id:'p1',name:'شخص تجريبي',note:'ملاحظة قديمة'}]};const oldFormData=globalThis.FormData;Object.defineProperty(globalThis,'FormData',{configurable:true,writable:true,value:t.dom.window.FormData});let command:any;Object.defineProperty(globalThis,'fetch',{configurable:true,writable:true,value:async(url:unknown,options?:RequestInit)=>{if(String(url).includes('/command')){command=JSON.parse(String(options?.body));return new Response('{}',{status:409});}return new Response('{}',{status:500});}});try{await act(async()=>root.render(createElement(NoorPersonalApplicationView,{initialResult:today,initialWorkspace:{...workspace,workspace:{...workspace.workspace,finance}}})));await act(async()=>(t.container.querySelector('button[aria-label="فتح مركز التحكم"]') as HTMLButtonElement).click());await act(async()=>[...t.container.querySelectorAll<HTMLButtonElement>('.np-cc-nav-item')].find(b=>b.textContent==='المالية')!.click());await act(async()=>[...t.container.querySelectorAll<HTMLButtonElement>('.nf-tabs button')].find(b=>b.textContent==='الدائن والمدين')!.click());await act(async()=>(t.container.querySelector('.nf-person') as HTMLButtonElement).click());await act(async()=>[...t.container.querySelectorAll<HTMLButtonElement>('button')].find(b=>b.textContent==='تعديل الشخص')!.click());const dialog=t.dom.window.document.querySelector('.nf-dialog')!;const name=dialog.querySelector<HTMLInputElement>('[name="name"]')!,note=dialog.querySelector<HTMLTextAreaElement>('[name="note"]')!;assert.equal(name.value,'شخص تجريبي');assert.equal(note.value,'ملاحظة قديمة');name.value='اسم مصحح';note.value='ملاحظة جديدة';await act(async()=>dialog.querySelector('form')!.dispatchEvent(new t.dom.window.Event('submit',{bubbles:true,cancelable:true})));assert.equal(command.operation.action,'edit-person');assert.equal(command.operation.personId,'p1');assert.equal(command.operation.expectedName,'شخص تجريبي');assert.equal(command.operation.expectedNote,'ملاحظة قديمة');assert.equal(command.operation.name,'اسم مصحح');assert.equal(name.value,'اسم مصحح');assert.match(dialog.textContent??'',/تعذر التعديل/);await act(async()=>dialog.dispatchEvent(new t.dom.window.KeyboardEvent('keydown',{key:'Escape',bubbles:true})));assert.equal(t.dom.window.document.querySelector('.nf-dialog'),null);}finally{await act(async()=>root.unmount());Object.defineProperty(globalThis,'FormData',{configurable:true,writable:true,value:oldFormData});t.restore();t.dom.window.close();}});

test('direct person edit is discoverable and compact ledger pairs each payment with its date',async()=>{const t=installDom(),root=createRoot(t.container);const finance={userId:'user',currency:'SAR',accounts:[],people:[{id:'p',name:'شخص اختبار',note:'ملاحظة ملف'}],debts:[{id:'d',personId:'p',person:'شخص اختبار',direction:'receivable',currency:'SAR',dueDate:'2026-12-01',note:'ملاحظة مبلغ'}],entries:[{id:'debt:d',kind:'opening-receivable',amountMinor:10000,date:'2026-10-01',accountId:null,targetAccountId:null,debtId:'d',category:'دين',note:'',createdAt:'2026-10-01T00:00:00Z'},...['2026-10-10','2026-10-20'].map((date,i)=>({id:'pay'+i,kind:'repay',amountMinor:i?1500:2500,date,accountId:null,targetAccountId:null,debtId:'d',category:'سداد',note:'دفعة '+i,createdAt:date+'T00:00:00Z'}))],requests:[]};let commands=0;Object.defineProperty(globalThis,'fetch',{configurable:true,writable:true,value:async(url:unknown)=>{if(String(url).includes('/command'))commands++;return new Response('{}',{status:500});}});try{await act(async()=>root.render(createElement(NoorPersonalApplicationView,{initialResult:today,initialWorkspace:{...workspace,workspace:{...workspace.workspace,finance}}})));const click=async(selector:string,text?:string)=>act(async()=>{const nodes=[...t.container.querySelectorAll<HTMLButtonElement>(selector)];(text?nodes.find(b=>b.textContent===text):nodes[0])!.click();});await click('button[aria-label="فتح مركز التحكم"]');await click('.np-cc-nav-item','المالية');await click('.nf-tabs button','الدائن والمدين');const edit=t.container.querySelector<HTMLButtonElement>('[aria-label="تعديل بيانات شخص اختبار"]')!;assert.ok(edit);assert.equal(edit.parentElement?.closest('button'),null);assert.equal(t.container.querySelectorAll('.nf-person-card').length,1);edit.focus();await act(async()=>edit.click());const dialog=t.dom.window.document.querySelector('.nf-dialog')!;assert.equal(dialog.querySelector<HTMLInputElement>('[name="name"]')!.value,'شخص اختبار');await act(async()=>dialog.dispatchEvent(new t.dom.window.KeyboardEvent('keydown',{key:'Escape',bubbles:true})));assert.equal(t.dom.window.document.activeElement?.getAttribute('aria-label'),'تعديل بيانات شخص اختبار');await click('.nf-person');const table=t.container.querySelector('.nf-ledger-table')!;assert.equal(table.querySelectorAll('thead th').length,7);const payments=table.querySelectorAll('.nf-ledger-payments li');assert.equal(payments.length,2);assert.match(payments[0]!.textContent??'',/25\.00.*2026-10-10/);assert.match(payments[1]!.textContent??'',/15\.00.*2026-10-20/);assert.match(table.querySelector('[data-label="المتبقي"]')!.textContent??'',/60\.00/);assert.match(table.textContent??'',/2026-12-01/);assert.match(table.textContent??'',/ملاحظة مبلغ/);assert.equal(t.container.querySelectorAll('.nf-debt-totals article').length,2);assert.equal(commands,0);await click('.nf-debt-register nav button','عرض الجدول بصفحة كاملة');assert.ok(t.container.querySelector('.nf-ledger-expanded table'));await click('.nf-debt-register nav button','الإحصائيات');assert.equal(t.container.querySelector('[aria-label="الشخص في جدول الديون"] option:last-child')?.textContent,'شخص اختبار');const age=t.container.querySelector<HTMLSelectElement>('[aria-label="مدة الدين"]')!;await act(async()=>{age.value='long';age.dispatchEvent(new t.dom.window.Event('change',{bubbles:true}));});assert.equal(t.container.querySelector('.nf-ledger-table'),null);await click('.nf-debt-register nav button','إنهاء العرض الكامل');assert.equal(t.container.querySelector('.nf-ledger-expanded'),null);}finally{await act(async()=>root.unmount());t.restore();t.dom.window.close();}});

test('prayer selection advances exactly at zero, skips sunrise and uses only supplied next-day timings',()=>{
 const times=[{key:'fajr',at:'2026-10-31T01:40:00Z'},{key:'sunrise',at:'2026-10-31T02:59:00Z'},{key:'dhuhr',at:'2026-10-31T08:37:00Z'},{key:'asr',at:'2026-10-31T11:50:00Z'},{key:'maghrib',at:'2026-10-31T14:15:00Z'},{key:'isha',at:'2026-10-31T15:45:00Z'}];const old={name:'Fajr',at:times[0]!.at};
 assert.equal(liveNextPrayer(times,old,Date.parse('2026-10-31T01:39:59.999Z'))?.key,'fajr');assert.equal(remainingPrayerSeconds(times[0]!.at,Date.parse('2026-10-31T01:39:59.999Z')),1);
 assert.equal(liveNextPrayer(times,old,Date.parse(times[0]!.at))?.key,'dhuhr');assert.equal(liveNextPrayer(times,old,Date.parse(times[2]!.at))?.key,'asr');assert.equal(liveNextPrayer(times,old,Date.parse(times[5]!.at)),null);
 assert.equal(liveNextPrayer(times,{name:'Fajr',at:'2026-11-01T01:41:00Z'},Date.parse('2026-10-31T20:00:00Z'))?.at,'2026-11-01T01:41:00Z');assert.equal(liveNextPrayer([{key:'asr',at:'invalid'}],null,Date.now()),null);
 const night=nightCountdownState(times,Date.parse(times[5]!.at),"2026-11-01T01:41:00Z")!;assert.equal(night.enabled,true);assert.equal(remainingPrayerSeconds(night.midnight,Date.parse(night.midnight)),0);assert.ok(remainingPrayerSeconds(night.lastThird,Date.parse(night.midnight))>0);
});
test('open dashboard advances despite a failed refresh and retries without flooding on tick or resume',async()=>{
 const t=installDom(),root=createRoot(t.container);const originalNow=Date.now,originalInterval=t.dom.window.setInterval;let now=Date.parse('2026-10-25T08:37:59Z'),tick:(()=>void)|undefined,reads=0,commands=0;
 Date.now=()=>now;t.dom.window.setInterval=((handler:TimerHandler,delay?:number,...args:unknown[])=>{if(delay===1000){tick=handler as ()=>void;return 99999;}return originalInterval.call(t.dom.window,handler,delay,...args);}) as typeof t.dom.window.setInterval;
 Object.defineProperty(globalThis,'fetch',{configurable:true,writable:true,value:async(url:unknown)=>{if(String(url).endsWith('/today'))reads++;if(String(url).includes('/command'))commands++;return new Response('{}',{status:503});}});
 const data={...today,today:{...today.today,nextPrayer:{name:'Dhuhr',at:'2026-10-25T08:38:00Z',secondsRemaining:1}}};const active=()=>t.container.querySelector('[data-testid="prayer-countdown"]')?.closest('[data-prayer-key]')?.getAttribute('data-prayer-key');
 try{await act(async()=>root.render(createElement(NoorPersonalApplicationView,{initialResult:data,initialWorkspace:workspace})));assert.equal(active(),'dhuhr');now=Date.parse('2026-10-25T08:38:00Z');await act(async()=>tick!());assert.equal(active(),'asr');assert.equal(reads,1);now+=10_000;await act(async()=>tick!());assert.equal(reads,1);now+=21_000;await act(async()=>tick!());assert.equal(reads,2);now=Date.parse('2026-10-25T14:21:00Z');await act(async()=>t.dom.window.dispatchEvent(new t.dom.window.Event('focus')));assert.equal(active(),'isha');assert.equal(commands,0);}finally{await act(async()=>root.unmount());Date.now=originalNow;t.dom.window.setInterval=originalInterval;t.restore();t.dom.window.close();}
});

test('r90 today excludes unscheduled habits while control retains their saved schedule',async()=>{const t=installDom(),root=createRoot(t.container),d=workspace.workspace.definitions[1]!;const defs=[...workspace.workspace.definitions,{...d,id:'future',title:'دواء لاحق',category:' الصحة والرياضة ',effectiveFromDate:'2099-01-01',timeOfDay:'09:30'},{...d,id:'ended',title:'انتهت',effectiveUntilDate:'2000-01-01'},{...d,id:'paused',title:'موقوفة',state:'Paused'}].map(d=>({...d,revisionId:'r1'}));try{await act(async()=>root.render(createElement(NoorPersonalApplicationView,{initialResult:today,initialWorkspace:{...workspace,workspace:{...workspace.workspace,definitions:defs}}})));assert.equal(t.container.querySelectorAll('[data-testid="habit-category-card"]').length,1);assert.equal(t.container.querySelectorAll('.np-unscheduled').length,0);assert.doesNotMatch(t.container.textContent??'',/دواء لاحق|انتهت مدتها|موقوفة/);await act(async()=>(t.container.querySelector('[aria-label="فتح مركز التحكم"]') as HTMLButtonElement).click());await act(async()=>[...t.container.querySelectorAll<HTMLButtonElement>('.np-cc-nav-item')].find(b=>b.textContent?.includes('العادات'))!.click());await act(async()=>(t.container.querySelector('[aria-controls="np-detail-future"]') as HTMLButtonElement).click());await act(async()=>[...t.container.querySelectorAll<HTMLButtonElement>('button')].find(b=>b.textContent==='تعديل البيانات والجدول')!.click());assert.equal(t.container.querySelector<HTMLInputElement>('[name="timeOfDay"]')!.value,'09:30');}finally{await act(async()=>root.unmount());t.restore();t.dom.window.close();}});
test('instant completion queues different habits serially and rolls back only failed changes',async()=>{const t=installDom(),root=createRoot(t.container),h={...today.today.habits[0]!,id:'e3',definitionId:'d3',title:'عادة ثانية'},data={...today,today:{...today.today,habits:[...today.today.habits,h]}},w={...workspace,workspace:{...workspace.workspace,definitions:[...workspace.workspace.definitions,{...workspace.workspace.definitions[1]!,id:'d3',title:h.title}]}};const requests:{resolve:(r:Response)=>void}[]=[];Object.defineProperty(globalThis,'fetch',{configurable:true,writable:true,value:async(url:unknown)=>String(url).includes('/command')?new Promise<Response>(resolve=>requests.push({resolve})):new Response('{}',{status:503})});const check=(name:string)=>t.container.querySelector<HTMLInputElement>(`[aria-label="إتمام عادة ${name} اليوم"]`)!;try{await act(async()=>root.render(createElement(NoorPersonalApplicationView,{initialResult:data,initialWorkspace:w})));await act(async()=>check('المشي').click());assert.equal(check('المشي').checked,true);assert.equal(check('المشي').disabled,false);await act(async()=>check(h.title).click());assert.equal(check(h.title).checked,true);assert.equal(requests.length,1);const executions=[...data.today.tasks,...data.today.habits.map(e=>({...e,status:e.id==='e2'?'Completed':e.status}))];await act(async()=>requests[0]!.resolve(new Response(JSON.stringify({workspace:w.workspace,executions,personalDayId:'day',materializationRequired:false}),{status:200})));assert.equal(requests.length,2);await act(async()=>requests[1]!.resolve(new Response('{}',{status:503})));assert.equal(check('المشي').checked,true);assert.equal(check(h.title).checked,false);assert.ok(t.container.querySelector('.np-failed-save'));await act(async()=>[...t.container.querySelectorAll<HTMLButtonElement>('.np-failed-save button')].find(b=>b.textContent==='إعادة المحاولة')!.click());assert.equal(check(h.title).checked,true);await act(async()=>requests[2]!.resolve(new Response(JSON.stringify({workspace:w.workspace,executions:executions.map(e=>({...e,status:e.id==='e2'||e.id==='e3'?'Completed':e.status})),personalDayId:'day',materializationRequired:false}),{status:200})));assert.equal(check(h.title).checked,true);assert.equal(t.container.querySelector('.np-failed-save'),null);}finally{await act(async()=>root.unmount());t.restore();t.dom.window.close();}});
test('task progress is immediate and failed input remains available for retry',async()=>{const t=installDom(),root=createRoot(t.container),old=globalThis.FormData;Object.defineProperty(globalThis,'FormData',{configurable:true,writable:true,value:t.dom.window.FormData});let resolve:(r:Response)=>void=()=>{};Object.defineProperty(globalThis,'fetch',{configurable:true,writable:true,value:async(url:unknown)=>String(url).includes('/command')?new Promise<Response>(r=>{resolve=r;}):new Response('{}',{status:503})});const w={...workspace,workspace:{...workspace.workspace,definitions:workspace.workspace.definitions.map(d=>d.id==='d1'?{...d,measurement:{target:100,unit:'صفحة'}}:d)}};try{await act(async()=>root.render(createElement(NoorPersonalApplicationView,{initialResult:today,initialWorkspace:w})));await act(async()=>t.container.querySelector<HTMLButtonElement>('.np-today-task-button')!.click());await act(async()=>(t.dom.window.document.querySelector('[aria-label="تسجيل ملاحظة أو تقدم: تمرين"]') as HTMLButtonElement).click());const f=t.dom.window.document.querySelector('.np-activity-dialog form')!;f.querySelector<HTMLInputElement>('[name="amount"]')!.value='10';f.querySelector<HTMLTextAreaElement>('[name="note"]')!.value='تقدم تجريبي';await act(async()=>f.dispatchEvent(new t.dom.window.Event('submit',{bubbles:true,cancelable:true})));assert.equal(t.dom.window.document.querySelector('.np-activity-dialog'),null);assert.match(t.dom.window.document.querySelector('[data-testid="activity-card-e1"]')!.textContent??'',/10 \/ 100/);await act(async()=>resolve(new Response('{}',{status:503})));assert.match(t.dom.window.document.querySelector('[data-testid="activity-card-e1"]')!.textContent??'',/0 \/ 100/);assert.match(t.container.querySelector('.np-failed-save')!.textContent??'',/تقدم تجريبي/);}finally{await act(async()=>root.unmount());Object.defineProperty(globalThis,'FormData',{configurable:true,writable:true,value:old});t.restore();t.dom.window.close();}});
test('editing principal preloads amount and submits a guarded correction retaining failed values',async()=>{const t=installDom(),root=createRoot(t.container),old=globalThis.FormData;Object.defineProperty(globalThis,'FormData',{configurable:true,writable:true,value:t.dom.window.FormData});const finance={userId:'user',currency:'SAR',accounts:[],debts:[{id:'d',person:'شخص مالي',direction:'receivable',dueDate:null,note:'ملاحظة'}],entries:[{id:'debt:d',kind:'opening-receivable',amountMinor:10000,date:'2026-10-01',accountId:null,targetAccountId:null,debtId:'d',category:'دين',note:'ملاحظة',createdAt:'2026-10-01T00:00:00Z'}],requests:[]};let command:any;Object.defineProperty(globalThis,'fetch',{configurable:true,writable:true,value:async(url:unknown,init?:RequestInit)=>{if(String(url).includes('/command'))command=JSON.parse(String(init?.body));return new Response('{}',{status:409});}});try{await act(async()=>root.render(createElement(NoorPersonalApplicationView,{initialResult:today,initialWorkspace:{...workspace,workspace:{...workspace.workspace,finance}}})));const click=async(selector:string,text?:string)=>act(async()=>{const nodes=[...t.container.querySelectorAll<HTMLButtonElement>(selector)];(text?nodes.find(b=>b.textContent===text):nodes[0])!.click();});await click('[aria-label="فتح مركز التحكم"]');await click('.np-cc-nav-item','المالية');await click('.nf-tabs button','الدائن والمدين');await click('.nf-person-card-actions button','تعديل المبالغ');await click('.nf-ledger-actions button','تعديل المبلغ');const f=t.dom.window.document.querySelector('.nf-dialog form')!;assert.equal(f.querySelector<HTMLInputElement>('[name="amount"]')!.value,'100');f.querySelector<HTMLInputElement>('[name="amount"]')!.value='150';f.querySelector<HTMLTextAreaElement>('[name="reason"]')!.value='مراجعة';await act(async()=>f.dispatchEvent(new t.dom.window.Event('submit',{bubbles:true,cancelable:true})));assert.equal(command.operation.action,'edit-debt');assert.equal(command.operation.amountMinor,15000);assert.ok(command.operation.expected);assert.equal(f.querySelector<HTMLInputElement>('[name="amount"]')!.value,'150');assert.match(f.textContent??'',/تعذر التصحيح/);}finally{await act(async()=>root.unmount());Object.defineProperty(globalThis,'FormData',{configurable:true,writable:true,value:old});t.restore();t.dom.window.close();}});

test('checkbox commits visually before the request and stays interactive while writes are pending',async()=>{const t=installDom(),root=createRoot(t.container);const requests:{command:any;resolve:(r:Response)=>void}[]=[];const checkbox=()=>t.container.querySelector<HTMLInputElement>('[aria-label="إتمام عادة المشي اليوم"]')!;Object.defineProperty(globalThis,'fetch',{configurable:true,writable:true,value:async(url:unknown,init?:RequestInit)=>{if(String(url).includes('/command')){const command=JSON.parse(String(init?.body));assert.equal(checkbox().checked,command.completed,'checkbox must be committed before fetching');return new Promise<Response>(resolve=>requests.push({command,resolve}));}return new Response('{}',{status:503});}});const reply=(completed:boolean)=>new Response(JSON.stringify({workspace:workspace.workspace,executions:[...today.today.tasks,...today.today.habits.map(e=>({...e,status:completed?'Completed':'Pending'}))],personalDayId:'day',materializationRequired:false}),{status:200});try{await act(async()=>root.render(createElement(NoorPersonalApplicationView,{initialResult:today,initialWorkspace:workspace})));await act(async()=>checkbox().click());assert.equal(checkbox().checked,true);assert.equal(checkbox().disabled,false);assert.equal(checkbox().getAttribute('aria-busy'),'true');assert.equal(t.container.querySelector('.np-pending-save,.np-sync-status,.np-order-saving'),null);await act(async()=>checkbox().click());assert.equal(checkbox().checked,false);await act(async()=>checkbox().click());assert.equal(checkbox().checked,true);assert.equal(requests.length,1);await act(async()=>requests[0]!.resolve(reply(true)));assert.equal(requests.length,1,'unsent cancel/recheck must be collapsed');assert.equal(checkbox().checked,true);assert.equal(checkbox().disabled,false);assert.equal(t.container.querySelector('.np-pending-save'),null);}finally{await act(async()=>root.unmount());t.restore();t.dom.window.close();}});
test('an older save cannot overwrite the latest checkbox choice and latest-write failure can retry',async()=>{const t=installDom(),root=createRoot(t.container);const requests:{command:any;resolve:(r:Response)=>void}[]=[];const checkbox=()=>t.container.querySelector<HTMLInputElement>('[aria-label="إتمام عادة المشي اليوم"]')!;Object.defineProperty(globalThis,'fetch',{configurable:true,writable:true,value:async(url:unknown,init?:RequestInit)=>String(url).includes('/command')?new Promise<Response>(resolve=>requests.push({command:JSON.parse(String(init?.body)),resolve})):new Response('{}',{status:503})});const reply=(completed:boolean)=>new Response(JSON.stringify({workspace:workspace.workspace,executions:[...today.today.tasks,...today.today.habits.map(e=>({...e,status:completed?'Completed':'Pending'}))],personalDayId:'day',materializationRequired:false}),{status:200});try{await act(async()=>root.render(createElement(NoorPersonalApplicationView,{initialResult:today,initialWorkspace:workspace})));await act(async()=>checkbox().click());await act(async()=>checkbox().click());assert.equal(checkbox().checked,false);await act(async()=>requests[0]!.resolve(reply(true)));assert.equal(requests.length,2);assert.equal(requests[1]!.command.completed,false);assert.equal(checkbox().checked,false,'old successful reply must not flash its checked state');await act(async()=>requests[1]!.resolve(new Response('{}',{status:503})));assert.equal(checkbox().checked,true,'failure restores last confirmed state');assert.ok(t.container.querySelector('.np-failed-save'));await act(async()=>[...t.container.querySelectorAll<HTMLButtonElement>('.np-failed-save button')].find(b=>b.textContent==='إعادة المحاولة')!.click());assert.equal(checkbox().checked,false);await act(async()=>requests[2]!.resolve(reply(false)));assert.equal(checkbox().checked,false);assert.equal(t.container.querySelector('.np-failed-save'),null);}finally{await act(async()=>root.unmount());t.restore();t.dom.window.close();}});

test('r84 clean habit rows preserve controls and saved category and item ordering',async()=>{
 const t=installDom(),root=createRoot(t.container);const d=workspace.workspace.definitions[1]!;const definitions=[{...d,id:'h1',title:'الأولى',category:'ب',displayOrder:1},{...d,id:'h2',title:'الثانية',category:'ب',displayOrder:0},{...d,id:'h3',title:'الثالثة',category:'أ',displayOrder:2}];const habits=definitions.map((d,i)=>({id:'eh'+i,definitionId:d.id,kind:'Habit' as const,title:d.title,status:i?'Pending':'Completed'}));
 try{await act(async()=>root.render(createElement(NoorPersonalApplicationView,{initialResult:{...today,today:{...today.today,habits,tasks:[]}},initialWorkspace:{...workspace,workspace:{...workspace.workspace,categories:['ب','أ'],definitions}}})));const titles=[...t.container.querySelectorAll('.np-habit-row .np-item-title')].map(e=>e.textContent);assert.deepEqual(titles,['الثانية','الأولى','الثالثة']);assert.equal(t.container.querySelectorAll('.np-habit-row .np-item-meta').length,0);assert.equal(t.container.querySelectorAll('.np-habit-row input[type="checkbox"]').length,3);assert.equal(t.container.querySelectorAll('.np-habit-row .np-pencil').length,3);}finally{await act(async()=>root.unmount());t.restore();t.dom.window.close();}
});
test('r84 control ordering sends exact guarded permutation and retains failed ordering',async()=>{
 const t=installDom(),root=createRoot(t.container);let command:any;Object.defineProperty(globalThis,'fetch',{configurable:true,writable:true,value:async(url:unknown,options?:RequestInit)=>{if(String(url).includes('/command')){command=JSON.parse(String(options?.body));return new Response('{}',{status:409});}return new Response('{}',{status:500});}});
 try{await act(async()=>root.render(createElement(NoorPersonalApplicationView,{initialResult:today,initialWorkspace:{...workspace,workspace:{...workspace.workspace,categories:['أ','ب']}}})));await act(async()=>t.container.querySelector<HTMLButtonElement>('[aria-label="الضبط"]')!.click());await act(async()=>[...t.container.querySelectorAll<HTMLButtonElement>('.np-cc-nav-item')].find(b=>b.textContent==='تنظيم العرض')!.click());assert.equal(t.container.querySelector<HTMLButtonElement>('[aria-label="نقل أ لأعلى"]')!.disabled,true);await act(async()=>t.container.querySelector<HTMLButtonElement>('[aria-label="نقل أ لأسفل"]')!.click());assert.deepEqual(command,{type:'reorder-display',scope:'categories',expected:['أ','ب'],order:['ب','أ']});assert.match(t.container.textContent??'',/تعذر حفظ الترتيب/);assert.equal(t.container.querySelector('.np-order-list li span')!.textContent,'أ');}finally{await act(async()=>root.unmount());t.restore();t.dom.window.close();}
});

test('r84 saved task order updates dashboard and retains control selection',async()=>{
 const t=installDom(),root=createRoot(t.container);const d=workspace.workspace.definitions[0]!;let definitions=[{...d,id:'ta',title:'مهمة أولى'},{...d,id:'tb',title:'مهمة ثانية'}];const tasks=definitions.map((d,i)=>({id:'te'+i,definitionId:d.id,kind:'Task' as const,title:d.title,status:'Planned'}));let command:any;
 Object.defineProperty(globalThis,'fetch',{configurable:true,writable:true,value:async(url:unknown,options?:RequestInit)=>{if(String(url).includes('/command')){command=JSON.parse(String(options?.body));definitions=command.order.map((id:string,index:number)=>({...definitions.find(d=>d.id===id)!,displayOrder:index}));return new Response(JSON.stringify({workspace:{...workspace.workspace,categories:['الصحة والرياضة'],definitions},executions:tasks,personalDayId:'day',materializationRequired:false}),{status:200});}return new Response('{}',{status:500});}});
 try{await act(async()=>root.render(createElement(NoorPersonalApplicationView,{initialResult:{...today,today:{...today.today,tasks}},initialWorkspace:{...workspace,workspace:{...workspace.workspace,definitions}}})));await act(async()=>t.container.querySelector<HTMLButtonElement>('[aria-label="الضبط"]')!.click());await act(async()=>[...t.container.querySelectorAll<HTMLButtonElement>('.np-cc-nav-item')].find(b=>b.textContent==='تنظيم العرض')!.click());await act(async()=>[...t.container.querySelectorAll<HTMLButtonElement>('.np-order-tabs button')].find(b=>b.textContent==='المهام')!.click());await act(async()=>t.container.querySelector<HTMLButtonElement>('[aria-label="نقل مهمة أولى لأسفل"]')!.click());assert.equal(command.scope,'Task');assert.deepEqual(command.order,['tb','ta']);assert.deepEqual([...t.container.querySelectorAll('.np-order-list li>span')].map(e=>e.textContent),['مهمة ثانية','مهمة أولى']);await act(async()=>t.container.querySelector<HTMLButtonElement>('[data-testid="r324-nav-home"]')!.click());assert.deepEqual([...t.container.querySelectorAll('.np-today-task-button strong')].map(e=>e.textContent),['مهمة ثانية','مهمة أولى']);}finally{await act(async()=>root.unmount());t.restore();t.dom.window.close();}
});

test('r85 habit ordering groups by category and keeps moves inside their card, visible before fetch',async()=>{
 const t=installDom(),root=createRoot(t.container);const d=workspace.workspace.definitions[1]!;const definitions=[{...d,id:'a',title:'أولى صحة',category:'الصحة',displayOrder:0},{...d,id:'x',title:'عبادة',category:'العبادات',displayOrder:1},{...d,id:'b',title:'ثانية صحة',category:'الصحة',displayOrder:2}];const requests:{command:any;resolve:(r:Response)=>void}[]=[];
 const groupNames=()=>[...t.container.querySelectorAll('.np-order-group')].map(e=>e.querySelector('h3')!.firstChild!.textContent);
 const health=()=>t.container.querySelector('[aria-label="ترتيب عادات الصحة"]')!;
 Object.defineProperty(globalThis,'fetch',{configurable:true,writable:true,value:async(url:unknown,init?:RequestInit)=>{if(String(url).includes('/command')){assert.deepEqual([...health().querySelectorAll('li>span')].map(e=>e.textContent),['ثانية صحة','أولى صحة']);return new Promise<Response>(resolve=>requests.push({command:JSON.parse(String(init?.body)),resolve}));}return new Response('{}',{status:503});}});
 try{await act(async()=>root.render(createElement(NoorPersonalApplicationView,{initialResult:today,initialWorkspace:{...workspace,workspace:{...workspace.workspace,definitions,categories:['العبادات','الصحة']}}})));await act(async()=>t.container.querySelector<HTMLButtonElement>('[aria-label="الضبط"]')!.click());await act(async()=>[...t.container.querySelectorAll<HTMLButtonElement>('.np-cc-nav-item')].find(b=>b.textContent==='تنظيم العرض')!.click());await act(async()=>[...t.container.querySelectorAll<HTMLButtonElement>('.np-order-tabs button')].find(b=>b.textContent==='العادات')!.click());assert.deepEqual(groupNames(),['العبادات','الصحة']);assert.equal(t.container.querySelector<HTMLButtonElement>('[aria-label="نقل عبادة لأسفل"]')!.disabled,true);await act(async()=>health().querySelector<HTMLButtonElement>('[aria-label="نقل أولى صحة لأسفل"]')!.click());assert.deepEqual(requests[0]!.command.order,['b','x','a']);assert.equal(health().querySelector<HTMLButtonElement>('[aria-label="نقل أولى صحة لأعلى"]')!.disabled,false);assert.equal(t.container.querySelector('.np-order-saving'),null);await act(async()=>requests[0]!.resolve(new Response('{}',{status:503})));assert.deepEqual([...health().querySelectorAll('li>span')].map(e=>e.textContent),['أولى صحة','ثانية صحة']);assert.match(t.container.textContent??'',/آخر ترتيب مؤكد/);}finally{await act(async()=>root.unmount());t.restore();t.dom.window.close();}
});
test('r85 rapid ordering coalesces unsent moves and an older acknowledgement never replaces the latest order',async()=>{
 const t=installDom(),root=createRoot(t.container),requests:{command:any;resolve:(r:Response)=>void}[]=[];
 const categories=['أ','ب','ج'];const names=()=>[...t.container.querySelectorAll('.np-order-list li>span')].map(e=>e.textContent);
 Object.defineProperty(globalThis,'fetch',{configurable:true,writable:true,value:async(url:unknown,init?:RequestInit)=>String(url).includes('/command')?new Promise<Response>(resolve=>requests.push({command:JSON.parse(String(init?.body)),resolve})):new Response('{}',{status:503})});
 const reply=(categories:string[])=>new Response(JSON.stringify({workspace:{...workspace.workspace,categories},executions:[...today.today.tasks,...today.today.habits],personalDayId:'day',materializationRequired:false}),{status:200});
 try{await act(async()=>root.render(createElement(NoorPersonalApplicationView,{initialResult:today,initialWorkspace:{...workspace,workspace:{...workspace.workspace,categories}}})));await act(async()=>t.container.querySelector<HTMLButtonElement>('[aria-label="الضبط"]')!.click());await act(async()=>[...t.container.querySelectorAll<HTMLButtonElement>('.np-cc-nav-item')].find(b=>b.textContent==='تنظيم العرض')!.click());const click=async(label:string)=>act(async()=>t.container.querySelector<HTMLButtonElement>(`[aria-label="${label}"]`)!.click());await click('نقل أ لأسفل');assert.deepEqual(names(),['ب','أ','ج']);await click('نقل أ لأسفل');assert.deepEqual(names(),['ب','ج','أ']);await click('نقل ج لأعلى');assert.deepEqual(names(),['ج','ب','أ']);assert.equal(requests.length,1);await act(async()=>requests[0]!.resolve(reply(['ب','أ','ج'])));assert.deepEqual(names(),['ج','ب','أ']);assert.equal(requests.length,2);assert.deepEqual(requests[1]!.command.expected,['ب','أ','ج']);assert.deepEqual(requests[1]!.command.order,['ج','ب','أ']);await act(async()=>requests[1]!.resolve(reply(['ج','ب','أ'])));assert.deepEqual(names(),['ج','ب','أ']);assert.equal(t.container.querySelector('.np-order-saving'),null);}finally{await act(async()=>root.unmount());t.restore();t.dom.window.close();}
});
test('r85 failed ordering drops dependent same-scope writes and warns before leaving while pending',async()=>{
 const t=installDom(),root=createRoot(t.container),requests:{command:any;resolve:(r:Response)=>void}[]=[];Object.defineProperty(globalThis,'fetch',{configurable:true,writable:true,value:async(url:unknown,init?:RequestInit)=>String(url).includes('/command')?new Promise<Response>(resolve=>requests.push({command:JSON.parse(String(init?.body)),resolve})):new Response('{}',{status:503})});
 try{await act(async()=>root.render(createElement(NoorPersonalApplicationView,{initialResult:today,initialWorkspace:{...workspace,workspace:{...workspace.workspace,categories:['أ','ب','ج']}}})));await act(async()=>t.container.querySelector<HTMLButtonElement>('[aria-label="الضبط"]')!.click());await act(async()=>[...t.container.querySelectorAll<HTMLButtonElement>('.np-cc-nav-item')].find(b=>b.textContent==='تنظيم العرض')!.click());await act(async()=>t.container.querySelector<HTMLButtonElement>('[aria-label="نقل أ لأسفل"]')!.click());await act(async()=>t.container.querySelector<HTMLButtonElement>('[aria-label="نقل أ لأسفل"]')!.click());const event=new t.dom.window.Event('beforeunload',{cancelable:true});t.dom.window.dispatchEvent(event);assert.equal(event.defaultPrevented,true);await act(async()=>requests[0]!.resolve(new Response('{}',{status:409})));assert.equal(requests.length,1);assert.deepEqual([...t.container.querySelectorAll('.np-order-list li>span')].map(e=>e.textContent),['أ','ب','ج']);assert.equal(t.container.querySelector('.np-order-saving'),null);const after=new t.dom.window.Event('beforeunload',{cancelable:true});t.dom.window.dispatchEvent(after);assert.equal(after.defaultPrevented,false);}finally{await act(async()=>root.unmount());t.restore();t.dom.window.close();}
});

test('r87 failed quick note edit restores original and retains the changed text for retry',async()=>{
 const t=installDom(),root=createRoot(t.container);let command:any;const note={id:'n',executionId:'e1',localDate:'2026-10-24',at:'2026-10-24T10:00:00Z',note:'ملاحظة سابقة',amount:2,endReason:null};const definitions=workspace.workspace.definitions.map(d=>d.id==='d1'?{...d,measurement:{target:10,unit:'صفحات'},activityLog:[note]}:d);
 Object.defineProperty(globalThis,'fetch',{configurable:true,writable:true,value:async(url:unknown,init?:RequestInit)=>{if(String(url).includes('/command')){command=JSON.parse(String(init?.body));return new Response('{}',{status:409});}return new Response('{}',{status:503});}});
 try{await act(async()=>root.render(createElement(NoorPersonalApplicationView,{initialResult:today,initialWorkspace:{...workspace,workspace:{...workspace.workspace,definitions}}})));await act(async()=>t.container.querySelector<HTMLButtonElement>('.np-today-task-button')!.click());await act(async()=>t.dom.window.document.querySelector<HTMLButtonElement>('[aria-label="تسجيل ملاحظة أو تقدم: تمرين"]')!.click());const dialog=t.dom.window.document.querySelector('.np-activity-dialog')!;await act(async()=>[...dialog.querySelectorAll<HTMLButtonElement>('button')].find(b=>b.textContent==='تعديل الملاحظة')!.click());const textarea=dialog.querySelector<HTMLTextAreaElement>('[aria-label="تعديل نص الملاحظة"]')!;assert.equal(textarea.value,note.note);assert.equal(t.dom.window.document.activeElement?.getAttribute('aria-label'),'تعديل نص الملاحظة');await act(async()=>{textarea.value='نص مصحح';textarea.dispatchEvent(new t.dom.window.Event('input',{bubbles:true}));});await act(async()=>[...dialog.querySelectorAll<HTMLButtonElement>('button')].find(b=>b.textContent==='حفظ تعديل الملاحظة')!.click());assert.deepEqual(command,{type:'edit-activity-note',executionId:'e1',entryId:'n',expectedNote:note.note,note:'نص مصحح'});assert.equal(t.dom.window.document.querySelector('.np-activity-dialog'),null);assert.match(t.container.querySelector('.np-failed-save')?.textContent??'',/نص مصحح/);assert.match(t.dom.window.document.querySelector('.np-r339-task-sheet .np-activity-note')?.textContent??'',/ملاحظة سابقة/);}finally{await act(async()=>root.unmount());t.restore();t.dom.window.close();}
});
test('r86 habit note deletion requires confirmation, removes text and preserves checked completion',async()=>{
 const t=installDom(),root=createRoot(t.container);const commands:any[]=[];const note={id:'hn',executionId:'e2',localDate:'2026-10-24',at:'2026-10-24T10:00:00Z',note:'ملاحظة عادة',amount:0,endReason:null};const definitions=workspace.workspace.definitions.map(d=>d.id==='d2'?{...d,activityLog:[note]}:d);const executions=[...today.today.tasks,...today.today.habits.map(e=>({...e,status:'Completed'}))];
 Object.defineProperty(globalThis,'fetch',{configurable:true,writable:true,value:async(url:unknown,init?:RequestInit)=>{if(String(url).includes('/command')){commands.push(JSON.parse(String(init?.body)));return new Response(JSON.stringify({workspace:{...workspace.workspace,definitions:definitions.map(d=>d.id==='d2'?{...d,activityLog:[{...note,note:''}]}:d)},executions,personalDayId:'day',materializationRequired:false}),{status:200});}return new Response('{}',{status:503});}});
 try{await act(async()=>root.render(createElement(NoorPersonalApplicationView,{initialResult:{...today,today:{...today.today,habits:executions.filter(e=>e.kind==='Habit')}},initialWorkspace:{...workspace,workspace:{...workspace.workspace,definitions}}})));await act(async()=>t.container.querySelector<HTMLButtonElement>('[aria-label="تسجيل ملاحظة: المشي"]')!.click());const dialog=t.dom.window.document.querySelector('.np-activity-dialog')!;const click=async(text:string)=>act(async()=>[...dialog.querySelectorAll<HTMLButtonElement>('button')].find(b=>b.textContent===text)!.click());await click('حذف الملاحظة');assert.equal(commands.length,0);await click('إلغاء تعديل الملاحظة');assert.equal(commands.length,0);await click('حذف الملاحظة');await click('تأكيد حذف الملاحظة');assert.deepEqual(commands,[{type:'edit-activity-note',executionId:'e2',entryId:'hn',expectedNote:note.note,note:null}]);assert.equal(t.dom.window.document.querySelector('.np-activity-dialog'),null);assert.equal(t.container.querySelector('.np-habit-row .np-activity-note'),null);assert.equal(t.container.querySelector<HTMLInputElement>('.np-habit-check')!.checked,true);}finally{await act(async()=>root.unmount());t.restore();t.dom.window.close();}
});

test('r87 note deletion is visible before request resolves and failure restores text with retry outside page flow',async()=>{
 const t=installDom(),root=createRoot(t.container),requests:{command:any;resolve:(r:Response)=>void}[]=[];const note={id:'hn',executionId:'e2',localDate:'2026-10-24',at:'2026-10-24T10:00:00Z',note:'نص محفوظ',amount:0,endReason:null};const definitions=workspace.workspace.definitions.map(d=>d.id==='d2'?{...d,activityLog:[note]}:d);
 Object.defineProperty(globalThis,'fetch',{configurable:true,writable:true,value:async(url:unknown,init?:RequestInit)=>{if(String(url).includes('/command')){assert.equal(t.container.querySelector('.np-habit-row .np-activity-note'),null,'delete must render before fetch');return new Promise<Response>(resolve=>requests.push({command:JSON.parse(String(init?.body)),resolve}));}return new Response('{}',{status:503});}});
 try{await act(async()=>root.render(createElement(NoorPersonalApplicationView,{initialResult:today,initialWorkspace:{...workspace,workspace:{...workspace.workspace,definitions}}})));await act(async()=>t.container.querySelector<HTMLButtonElement>('[aria-label="تسجيل ملاحظة: المشي"]')!.click());const dialog=t.dom.window.document.querySelector('.np-activity-dialog')!;await act(async()=>[...dialog.querySelectorAll<HTMLButtonElement>('button')].find(b=>b.textContent==='حذف الملاحظة')!.click());await act(async()=>[...dialog.querySelectorAll<HTMLButtonElement>('button')].find(b=>b.textContent==='تأكيد حذف الملاحظة')!.click());assert.equal(t.dom.window.document.querySelector('.np-activity-dialog'),null);assert.equal(requests.length,1);assert.equal(t.container.querySelector('.np-save-notices .np-pending-save'),null);assert.equal(t.dom.window.getComputedStyle(t.container.querySelector('.np-save-notices')!).position,'fixed');await act(async()=>requests[0]!.resolve(new Response('{}',{status:503})));assert.equal(t.container.querySelector('.np-habit-row .np-activity-note')!.textContent,note.note);assert.ok(t.container.querySelector('.np-save-notices .np-failed-save'));await act(async()=>[...t.container.querySelectorAll<HTMLButtonElement>('.np-failed-save button')].find(b=>b.textContent==='إعادة المحاولة')!.click());assert.equal(requests.length,2);await act(async()=>requests[1]!.resolve(new Response(JSON.stringify({workspace:{...workspace.workspace,definitions:definitions.map(d=>d.id==='d2'?{...d,activityLog:[{...note,note:''}]}:d)},executions:[...today.today.tasks,...today.today.habits],personalDayId:'day',materializationRequired:false}),{status:200})));assert.equal(t.container.querySelector('.np-habit-row .np-activity-note'),null);assert.equal(t.container.querySelector('.np-failed-save'),null);}finally{await act(async()=>root.unmount());t.restore();t.dom.window.close();}
});
test('r87 historical task note edits apply instantly without changing progress or completion',async()=>{
 const t=installDom(),root=createRoot(t.container);let resolve!:(r:Response)=>void;const note={id:'old',executionId:'historical',localDate:'2026-10-20',at:'2026-10-20T10:00:00Z',note:'قديم',amount:2,endReason:null};const definitions=workspace.workspace.definitions.map(d=>d.id==='d1'?{...d,measurement:{target:10,unit:'صفحات'},activityLog:[note]}:d);let command:any;
 Object.defineProperty(globalThis,'fetch',{configurable:true,writable:true,value:async(url:unknown,init?:RequestInit)=>{if(String(url).includes('/command')){command=JSON.parse(String(init?.body));assert.equal(t.dom.window.document.querySelector('.np-r339-task-sheet .np-activity-note')!.textContent,'مصحح');return new Promise<Response>(r=>{resolve=r;});}return new Response('{}',{status:503});}});
 try{await act(async()=>root.render(createElement(NoorPersonalApplicationView,{initialResult:today,initialWorkspace:{...workspace,workspace:{...workspace.workspace,definitions}}})));await act(async()=>t.container.querySelector<HTMLButtonElement>('.np-today-task-button')!.click());await act(async()=>t.dom.window.document.querySelector<HTMLButtonElement>('[aria-label="تسجيل ملاحظة أو تقدم: تمرين"]')!.click());const dialog=t.dom.window.document.querySelector('.np-activity-dialog')!;await act(async()=>[...dialog.querySelectorAll<HTMLButtonElement>('button')].find(b=>b.textContent==='تعديل الملاحظة')!.click());const textarea=dialog.querySelector<HTMLTextAreaElement>('[aria-label="تعديل نص الملاحظة"]')!;await act(async()=>{textarea.value='مصحح';textarea.dispatchEvent(new t.dom.window.Event('input',{bubbles:true}));});await act(async()=>[...dialog.querySelectorAll<HTMLButtonElement>('button')].find(b=>b.textContent==='حفظ تعديل الملاحظة')!.click());assert.equal(command.executionId,'historical');assert.equal(t.dom.window.document.querySelector('.np-activity-dialog'),null);assert.equal(t.dom.window.document.querySelector('.np-r339-task-sheet .np-progress-copy progress')!.getAttribute('value'),'2');await act(async()=>resolve(new Response(JSON.stringify({workspace:{...workspace.workspace,definitions:definitions.map(d=>d.id==='d1'?{...d,activityLog:[{...note,note:'مصحح'}]}:d)},executions:[...today.today.tasks,...today.today.habits],personalDayId:'day',materializationRequired:false}),{status:200})));assert.equal(t.dom.window.document.querySelector('.np-r339-task-sheet .np-activity-note')!.textContent,'مصحح');}finally{await act(async()=>root.unmount());t.restore();t.dom.window.close();}
});

for(const deleting of [false,true])test(`r88 ${deleting?'deleting':'editing'} note keeps checkbox enabled, unchanged in opacity and responsive while save is pending`,async()=>{
 const t=installDom(),root=createRoot(t.container),requests:{command:any;resolve:(r:Response)=>void}[]=[];const note={id:'n88',executionId:'e2',localDate:'2026-10-24',at:'2026-10-24T10:00:00Z',note:'قبل التعديل',amount:0,endReason:null};const definitions=workspace.workspace.definitions.map(d=>d.id==='d2'?{...d,activityLog:[note]}:d);
 const checkbox=()=>t.container.querySelector<HTMLInputElement>('.np-habit-check')!;
 Object.defineProperty(globalThis,'fetch',{configurable:true,writable:true,value:async(url:unknown,init?:RequestInit)=>String(url).includes('/command')?new Promise<Response>(resolve=>requests.push({command:JSON.parse(String(init?.body)),resolve})):new Response('{}',{status:503})});
 const reply=(done:boolean)=>new Response(JSON.stringify({workspace:{...workspace.workspace,definitions:definitions.map(d=>d.id==='d2'?{...d,activityLog:[{...note,note:deleting?'':'بعد التعديل'}]}:d)},executions:[...today.today.tasks,...today.today.habits.map(e=>({...e,status:done?'Completed':'Pending'}))],personalDayId:'day',materializationRequired:false}),{status:200});
 try{await act(async()=>root.render(createElement(NoorPersonalApplicationView,{initialResult:today,initialWorkspace:{...workspace,workspace:{...workspace.workspace,definitions}}})));const opacity=t.dom.window.getComputedStyle(checkbox()).opacity;await act(async()=>t.container.querySelector<HTMLButtonElement>('[aria-label="تسجيل ملاحظة: المشي"]')!.click());const dialog=t.dom.window.document.querySelector('.np-activity-dialog')!;const click=async(text:string)=>act(async()=>[...dialog.querySelectorAll<HTMLButtonElement>('button')].find(b=>b.textContent===text)!.click());await click(deleting?'حذف الملاحظة':'تعديل الملاحظة');if(!deleting){const input=dialog.querySelector<HTMLTextAreaElement>('[aria-label="تعديل نص الملاحظة"]')!;await act(async()=>{input.value='بعد التعديل';input.dispatchEvent(new t.dom.window.Event('input',{bubbles:true}));});}await click(deleting?'تأكيد حذف الملاحظة':'حفظ تعديل الملاحظة');assert.equal(requests.length,1);assert.equal(checkbox().disabled,false);assert.equal(checkbox().checked,false);assert.equal(t.dom.window.getComputedStyle(checkbox()).opacity,opacity||'1');assert.equal(t.container.querySelector('.np-save-notices')!.textContent,'');assert.equal(t.container.querySelector('.np-pending-save,.np-sync-status,.np-order-saving'),null);await act(async()=>checkbox().click());assert.equal(checkbox().checked,true);assert.equal(checkbox().disabled,false);assert.equal(requests.length,1);await act(async()=>requests[0]!.resolve(reply(false)));assert.equal(checkbox().checked,true,'note acknowledgement must preserve queued completion');assert.equal(requests.length,2);assert.equal(requests[1]!.command.type,'set-execution-completed');await act(async()=>requests[1]!.resolve(reply(true)));assert.equal(checkbox().checked,true);assert.equal(checkbox().disabled,false);assert.equal(t.container.querySelector('.np-save-notices')!.textContent,'');}finally{await act(async()=>root.unmount());t.restore();t.dom.window.close();}
});

for(const action of ['checkbox','add','edit','delete'] as const)test(`r89 pencil stays visible and opens during pending ${action}, with no saving notification`,async()=>{
 const t=installDom(),root=createRoot(t.container),requests:{command:any;resolve:(r:Response)=>void}[]=[];const note={id:'n89',executionId:'e2',localDate:'2026-10-24',at:'2026-10-24T10:00:00Z',note:'ملاحظة محفوظة',amount:0,endReason:null};const definitions=workspace.workspace.definitions.map(d=>d.id==='d2'?{...d,activityLog:[note]}:d);const oldFormData=globalThis.FormData;Object.defineProperty(globalThis,'FormData',{configurable:true,writable:true,value:t.dom.window.FormData});
 const pencil=()=>t.container.querySelector<HTMLButtonElement>('[aria-label="تسجيل ملاحظة: المشي"]')!;const appearance=()=>{const s=t.dom.window.getComputedStyle(pencil());return [s.opacity||'1',s.color,s.backgroundColor];};
 Object.defineProperty(globalThis,'fetch',{configurable:true,writable:true,value:async(url:unknown,init?:RequestInit)=>String(url).includes('/command')?new Promise<Response>(resolve=>requests.push({command:JSON.parse(String(init?.body)),resolve})):new Response('{}',{status:503})});
 try{await act(async()=>root.render(createElement(NoorPersonalApplicationView,{initialResult:today,initialWorkspace:{...workspace,workspace:{...workspace.workspace,definitions}}})));const before=appearance();if(action==='checkbox')await act(async()=>t.container.querySelector<HTMLInputElement>('.np-habit-check')!.click());else{await act(async()=>pencil().click());const dialog=t.dom.window.document.querySelector('.np-activity-dialog')!;const click=async(text:string)=>act(async()=>[...dialog.querySelectorAll<HTMLButtonElement>('button')].find(b=>b.textContent===text)!.click());if(action==='add'){dialog.querySelector<HTMLTextAreaElement>('textarea[name="note"]')!.value='إضافة';await act(async()=>dialog.querySelector('form')!.dispatchEvent(new t.dom.window.Event('submit',{bubbles:true,cancelable:true})));}else{await click(action==='delete'?'حذف الملاحظة':'تعديل الملاحظة');if(action==='edit'){const input=dialog.querySelector<HTMLTextAreaElement>('[aria-label="تعديل نص الملاحظة"]')!;await act(async()=>{input.value='تعديل';input.dispatchEvent(new t.dom.window.Event('input',{bubbles:true}));});}await click(action==='delete'?'تأكيد حذف الملاحظة':'حفظ تعديل الملاحظة');}}
 assert.equal(requests.length,1);assert.equal(pencil().disabled,false);assert.deepEqual(appearance(),before);assert.equal(t.container.querySelector('.np-pending-save,.np-sync-status,.np-order-saving'),null);await act(async()=>pencil().click());assert.ok(t.dom.window.document.querySelector('.np-activity-dialog'));assert.deepEqual(appearance(),before);await act(async()=>requests[0]!.resolve(new Response('{}',{status:503})));}finally{await act(async()=>root.unmount());Object.defineProperty(globalThis,'FormData',{configurable:true,writable:true,value:oldFormData});t.restore();t.dom.window.close();}
});
for(const fail of [false,true])test(`r89 queued note and completion ${fail?'retain both failed changes':'persist without overwriting each other'}`,async()=>{
 const t=installDom(),root=createRoot(t.container),requests:{command:any;resolve:(r:Response)=>void}[]=[];const oldFormData=globalThis.FormData;Object.defineProperty(globalThis,'FormData',{configurable:true,writable:true,value:t.dom.window.FormData});Object.defineProperty(globalThis,'fetch',{configurable:true,writable:true,value:async(url:unknown,init?:RequestInit)=>String(url).includes('/command')?new Promise<Response>(resolve=>requests.push({command:JSON.parse(String(init?.body)),resolve})):new Response('{}',{status:503})});
 const reply=(definitions:any)=>new Response(JSON.stringify({workspace:{...workspace.workspace,definitions},executions:[...today.today.tasks,...today.today.habits.map(e=>({...e,status:'Completed'}))],personalDayId:'day',materializationRequired:false}),{status:200});
 try{await act(async()=>root.render(createElement(NoorPersonalApplicationView,{initialResult:today,initialWorkspace:workspace})));await act(async()=>t.container.querySelector<HTMLInputElement>('.np-habit-check')!.click());await act(async()=>t.container.querySelector<HTMLButtonElement>('[aria-label="تسجيل ملاحظة: المشي"]')!.click());const dialog=t.dom.window.document.querySelector('.np-activity-dialog')!;dialog.querySelector<HTMLTextAreaElement>('textarea[name="note"]')!.value='ملاحظة أثناء الحفظ';await act(async()=>dialog.querySelector('form')!.dispatchEvent(new t.dom.window.Event('submit',{bubbles:true,cancelable:true})));assert.equal(t.dom.window.document.querySelector('.np-activity-dialog'),null);assert.equal(t.container.querySelector('.np-habit-row .np-activity-note')!.textContent,'ملاحظة أثناء الحفظ');assert.equal(requests.length,1);await act(async()=>requests[0]!.resolve(fail?new Response('{}',{status:503}):reply(workspace.workspace.definitions)));assert.equal(requests.length,2);assert.equal(requests[1]!.command.type,'record-activity');if(fail){await act(async()=>requests[1]!.resolve(new Response('{}',{status:503})));assert.equal(t.container.querySelectorAll('.np-failed-save').length,2);assert.match(t.container.querySelector('.np-save-notices')!.textContent??'',/ملاحظة أثناء الحفظ/);return;}const c=requests[1]!.command;await act(async()=>requests[1]!.resolve(reply(workspace.workspace.definitions.map(d=>d.id==='d2'?{...d,activityLog:[{id:c.entryId,executionId:'e2',localDate:'2026-10-24',at:'2026-10-24T10:00:00Z',note:c.note,amount:0,endReason:null}]}:d))));assert.equal(t.container.querySelector<HTMLInputElement>('.np-habit-check')!.checked,true);assert.equal(t.container.querySelector('.np-failed-save'),null);}finally{await act(async()=>root.unmount());Object.defineProperty(globalThis,'FormData',{configurable:true,writable:true,value:oldFormData});t.restore();t.dom.window.close();}
});

test('r90 dashboard renders only today executions, hides empty categories and excludes suppressed or paused items in totals',async()=>{
 const t=installDom(),root=createRoot(t.container),h=workspace.workspace.definitions[1]!,task=workspace.workspace.definitions[0]!;
 const definitions=[h,task,{...h,id:'thu',title:'الخميس فقط',category:'الخميس',schedule:{kind:'Weekdays',weekdays:[4]}},{...h,id:'later',title:'عادة مستقبلية',category:'مستقبل',effectiveFromDate:'2099-01-01'},{...h,id:'paused',title:'عادة موقوفة',category:'موقوف',state:'Paused'},{...h,id:'suppressed',title:'مستبعدة',category:'مستبعد'},{...task,id:'notToday',title:'مهمة يوم آخر',category:'العمل'},{...task,id:'ts',title:'مهمة مستبعدة',category:'العمل'}];
 try{await act(async()=>root.render(createElement(NoorPersonalApplicationView,{initialResult:{...today,today:{...today.today,habits:[...today.today.habits,{id:'p',definitionId:'paused',kind:'Habit',title:'عادة موقوفة',status:'Pending'},{id:'s',definitionId:'suppressed',kind:'Habit',title:'مستبعدة',status:'Suppressed'}],tasks:[...today.today.tasks,{id:'ts-ex',definitionId:'ts',kind:'Task',title:'مهمة مستبعدة',status:'Suppressed'}]}},initialWorkspace:{...workspace,workspace:{...workspace.workspace,definitions}}})));assert.equal(t.container.querySelectorAll('[data-testid="habit-category-card"]').length,1);assert.equal(t.container.querySelectorAll('.np-habit-row').length,1);assert.equal(t.container.querySelectorAll('.np-today-task-button').length,1);assert.doesNotMatch(t.container.textContent??'',/الخميس فقط|عادة مستقبلية|عادة موقوفة|مهمة يوم آخر|مستبعدة/);assert.match(t.container.querySelector('.np-category-count')?.textContent??'',/1/);await act(async()=>t.container.querySelector<HTMLButtonElement>('[aria-label="فتح مركز التحكم"]')!.click());await act(async()=>[...t.container.querySelectorAll<HTMLButtonElement>('.np-cc-nav-item')].find(b=>b.textContent?.includes('العادات'))!.click());assert.ok(t.container.querySelector('[aria-controls="np-detail-thu"]'));assert.ok(t.container.querySelector('[aria-controls="np-detail-later"]'));}finally{await act(async()=>root.unmount());t.restore();t.dom.window.close();}
});
test('r90 no due habits produces the empty state without category placeholders',async()=>{
 const t=installDom(),root=createRoot(t.container);try{await act(async()=>root.render(createElement(NoorPersonalApplicationView,{initialResult:{...today,today:{...today.today,tasks:[],habits:[]}},initialWorkspace:workspace})));assert.equal(t.container.querySelectorAll('[data-testid="habit-category-card"]').length,0);assert.equal(t.container.querySelectorAll('.np-habit-row').length,0);assert.equal(t.container.querySelector('.np-tasks-card'),null);assert.ok(t.container.querySelector('.np-habits-empty'));}finally{await act(async()=>root.unmount());t.restore();t.dom.window.close();}
});

test('r91 today percentage is weighted and legacy period cards move into control center',async()=>{const t=installDom(),root=createRoot(t.container);try{await act(async()=>root.render(createElement(NoorPersonalApplicationView,{initialResult:{...today,today:{...today.today,tasks:today.today.tasks.map(e=>({...e,status:'Pending',eligibility:{weight:10}})),habits:today.today.habits.map(e=>({...e,status:'Completed',eligibility:{weight:1}}))}},initialWorkspace:workspace})));assert.equal(t.container.querySelector('[data-testid="today-completion-rate"]')!.textContent,'9%');assert.ok(t.container.querySelector('[data-weighted-progress="r91"]'));assert.equal(t.container.querySelector('.np-insights'),null);}finally{await act(async()=>root.unmount());t.restore();t.dom.window.close();}});
test('r91 statistics shows daily data first, unlocks completed periods and filters a single habit',async()=>{const t=installDom(),root=createRoot(t.container);const rows=[{id:'a',definitionId:'d2',title:'المشي',kind:'Habit',date:'2026-01-01',weight:10,status:'Completed',amount:0,unit:''},{id:'b',definitionId:'d1',title:'تمرين',kind:'Task',date:'2026-01-02',weight:1,status:'Missed',amount:2,unit:'صفحة'}];try{await act(async()=>root.render(createElement(NoorPersonalApplicationView,{initialResult:today,initialWorkspace:{...workspace,workspace:{...workspace.workspace,statistics:{currentDate:'2026-01-08',rows}}}})));await act(async()=>t.container.querySelector<HTMLButtonElement>('[aria-label="فتح مركز التحكم"]')!.click());await act(async()=>[...t.container.querySelectorAll<HTMLButtonElement>('.np-cc-nav-item')].find(b=>b.textContent==='الإحصائيات')!.click());assert.ok(t.container.querySelector('[data-period="week"]'));assert.equal(t.container.querySelector('[data-period="month"]'),null);assert.match(t.container.querySelector('.ns-hero')!.textContent??'',/91%/);const select=t.container.querySelector<HTMLSelectElement>('[aria-label="اختيار عادة أو مهمة للإحصائيات"]')!;await act(async()=>{select.value='d2';select.dispatchEvent(new t.dom.window.Event('change',{bubbles:true}));});assert.match(t.container.querySelector('.ns-hero')!.textContent??'',/100%/);assert.equal(t.container.querySelectorAll('.ns-chart-day').length,8);}finally{await act(async()=>root.unmount());t.restore();t.dom.window.close();}});
test('r91 weight field is available and prefilled in habit editing',async()=>{const t=installDom(),root=createRoot(t.container);try{await act(async()=>root.render(createElement(NoorPersonalApplicationView,{initialResult:today,initialWorkspace:{...workspace,workspace:{...workspace.workspace,definitions:workspace.workspace.definitions.map(d=>({...d,revisionId:'r',weight:10}))}}})));await act(async()=>t.container.querySelector<HTMLButtonElement>('[aria-label="فتح مركز التحكم"]')!.click());await act(async()=>[...t.container.querySelectorAll<HTMLButtonElement>('.np-cc-nav-item')].find(b=>b.textContent?.includes('العادات'))!.click());await act(async()=>t.container.querySelector<HTMLButtonElement>('[aria-controls="np-detail-d2"]')!.click());await act(async()=>[...t.container.querySelectorAll<HTMLButtonElement>('button')].find(b=>b.textContent==='تعديل البيانات والجدول')!.click());assert.equal(t.container.querySelector<HTMLInputElement>('[name="weight"]')!.value,'10');}finally{await act(async()=>root.unmount());t.restore();t.dom.window.close();}});

test('r92 chart and calendar drill into real weighted day details and mature period cards are selectable',async()=>{
 const t=installDom(),root=createRoot(t.container);const rows=[{id:'a',definitionId:'d2',title:'المشي',kind:'Habit',date:'2026-01-01',weight:10,status:'Completed',amount:0,unit:''},{id:'b',definitionId:'d1',title:'تمرين',kind:'Task',date:'2026-01-02',weight:1,status:'Missed',amount:2,unit:'صفحة'}];
 try{await act(async()=>root.render(createElement(NoorPersonalApplicationView,{initialResult:today,initialWorkspace:{...workspace,workspace:{...workspace.workspace,statistics:{currentDate:'2026-01-08',rows}}}})));await act(async()=>t.container.querySelector<HTMLButtonElement>('[aria-label="فتح مركز التحكم"]')!.click());await act(async()=>[...t.container.querySelectorAll<HTMLButtonElement>('.np-cc-nav-item')].find(b=>b.textContent==='الإحصائيات')!.click());assert.ok(t.container.querySelector('[data-statistics-design="tracker-r92"]'));assert.ok(t.container.querySelector('.ns-ring'));assert.equal(t.container.querySelector('.ns-method')!.hasAttribute('open'),false);await act(async()=>t.container.querySelector<HTMLButtonElement>('.ns-chart-day')!.click());assert.match(t.container.querySelector('.ns-day-details')!.textContent??'',/المشي/);assert.match(t.container.querySelector('.ns-day-details')!.textContent??'',/100%/);const calendar=[...t.container.querySelectorAll<HTMLButtonElement>('.ns-calendar-day')];assert.equal(calendar.find(b=>b.textContent==='9')!.disabled,true);await act(async()=>calendar.find(b=>b.textContent==='2')!.click());assert.match(t.container.querySelector('.ns-day-details')!.textContent??'',/تمرين/);assert.match(t.container.querySelector('.ns-day-details')!.textContent??'',/2 صفحة/);await act(async()=>t.container.querySelector<HTMLButtonElement>('[data-period="week"]')!.click());assert.equal(t.container.querySelector('[data-period="week"]')!.getAttribute('aria-pressed'),'true');assert.equal(t.container.querySelectorAll('.ns-chart-day').length,7);assert.equal(t.container.querySelector('[data-period="month"]'),null);}finally{await act(async()=>root.unmount());t.restore();t.dom.window.close();}
});
test('r92 statistics empty state has no fabricated charts, totals or incomplete reports',async()=>{const t=installDom(),root=createRoot(t.container);try{await act(async()=>root.render(createElement(NoorPersonalApplicationView,{initialResult:today,initialWorkspace:workspace})));await act(async()=>t.container.querySelector<HTMLButtonElement>('[aria-label="فتح مركز التحكم"]')!.click());await act(async()=>[...t.container.querySelectorAll<HTMLButtonElement>('.np-cc-nav-item')].find(b=>b.textContent==='الإحصائيات')!.click());assert.ok(t.container.querySelector('.ns-empty'));assert.equal(t.container.querySelector('.ns-hero'),null);assert.equal(t.container.querySelector('.ns-calendar'),null);assert.equal(t.container.querySelector('[data-period]'),null);}finally{await act(async()=>root.unmount());t.restore();t.dom.window.close();}});

test('r93 home has one full-day achievement card and no statistics sidebar',async()=>{const t=installDom(),root=createRoot(t.container);try{await act(async()=>root.render(createElement(NoorPersonalApplicationView,{initialResult:today,initialWorkspace:workspace})));assert.equal(t.container.querySelectorAll('[data-testid="today-summary"]').length,1);assert.ok(t.container.querySelector('[data-today-design="whole-day-r93"]'));assert.equal(t.container.querySelector('.np-side-stack'),null);assert.equal(t.container.querySelector('.np-metric-card'),null);assert.equal(t.container.querySelector('.np-insights'),null);assert.doesNotMatch(t.container.textContent??'',/السلسلة الحالية|الأفضل:/);assert.match(t.container.querySelector('[data-testid="today-summary"]')!.textContent??'',/عادات ومهام/);assert.ok(t.container.querySelector('.np-main-grid.np-daily-only'));await act(async()=>t.container.querySelector<HTMLButtonElement>('[aria-label="فتح مركز التحكم"]')!.click());await act(async()=>[...t.container.querySelectorAll<HTMLButtonElement>('.np-cc-nav-item')].find(b=>b.textContent==='الإحصائيات')!.click());assert.ok(t.container.querySelector('[data-statistics-design="tracker-r92"]'));}finally{await act(async()=>root.unmount());t.restore();t.dom.window.close();}});
test('r93 whole-day weighted achievement updates before acknowledgement and rolls back on failure',async()=>{const t=installDom(),root=createRoot(t.container);let resolve!:(r:Response)=>void;Object.defineProperty(globalThis,'fetch',{configurable:true,writable:true,value:async(url:unknown)=>String(url).includes('/command')?new Promise<Response>(r=>{resolve=r;}):new Response('{}',{status:503})});try{await act(async()=>root.render(createElement(NoorPersonalApplicationView,{initialResult:{...today,today:{...today.today,tasks:today.today.tasks.map(e=>({...e,eligibility:{weight:9}})),habits:today.today.habits.map(e=>({...e,eligibility:{weight:1}}))}},initialWorkspace:workspace})));await act(async()=>t.container.querySelector<HTMLInputElement>('.np-habit-check')!.click());assert.equal(t.container.querySelector('[data-testid="today-completion-rate"]')!.textContent,'10%');assert.equal(t.container.querySelector('.np-day-ring')!.getAttribute('aria-valuenow'),'10');assert.equal(t.container.querySelector('.np-day-remaining strong')!.textContent,'1');assert.equal(t.container.querySelector('.np-pending-save'),null);await act(async()=>resolve(new Response('{}',{status:503})));assert.equal(t.container.querySelector('[data-testid="today-completion-rate"]')!.textContent,'0%');assert.equal(t.container.querySelector('.np-day-remaining strong')!.textContent,'2');}finally{await act(async()=>root.unmount());t.restore();t.dom.window.close();}});

test('r94 home shows seven weekdays, yesterday missed details and no invented future percentages',async()=>{const t=installDom(),root=createRoot(t.container);const rows=[{id:'old1',definitionId:'d1',title:'مهمة أمس المكتملة',kind:'Task',date:'2026-11-02',weight:10,status:'Completed',amount:0,unit:''},{id:'old2',definitionId:'d2',title:'عادة أمس الفائتة',kind:'Habit',date:'2026-11-02',weight:1,status:'Missed',amount:0,unit:''},{id:'cancel',definitionId:'x',title:'عنصر ملغى',kind:'Habit',date:'2026-11-02',weight:100,status:'Cancelled',amount:0,unit:''}];try{await act(async()=>root.render(createElement(NoorPersonalApplicationView,{initialResult:{...today,today:{...today.today,personalDay:{...today.today.personalDay,boundary:{...today.today.personalDay.boundary,localDate:'2026-11-03'}}}},initialWorkspace:{...workspace,workspace:{...workspace.workspace,statistics:{currentDate:'2026-11-04',rows}}}})));const cells=t.container.querySelectorAll('[data-week-date]');assert.equal(cells.length,7);assert.equal(cells[0]!.getAttribute('data-week-date'),'2026-10-31');assert.equal(t.container.querySelector('[data-week-state="today"]')!.getAttribute('data-week-date'),'2026-11-03');assert.equal(t.container.querySelectorAll('[data-week-state="future"]').length,3);for(const future of t.container.querySelectorAll('[data-week-state="future"]')){assert.equal(future.querySelector('strong')!.textContent,'');assert.equal(future.getAttribute('data-week-rate'),null);}const previous=t.container.querySelector('[data-testid="yesterday-achievement"]')!;assert.equal(previous.querySelector('.np-yesterday-score strong')!.textContent,'1');assert.match(previous.textContent??'',/91%/);assert.match(previous.textContent??'',/عادة أمس الفائتة/);assert.doesNotMatch(previous.textContent??'',/مهمة أمس المكتملة|عنصر ملغى/);const trigger=t.container.querySelector<HTMLButtonElement>('.np-yesterday-trigger')!;assert.equal(trigger.getAttribute('aria-expanded'),'false');await act(async()=>trigger.click());assert.equal(trigger.getAttribute('aria-expanded'),'true');assert.equal(previous.closest('[hidden]'),null);}finally{await act(async()=>root.unmount());t.restore();t.dom.window.close();}});
test('r94 today week cell follows immediate weighted completion while yesterday stays unchanged',async()=>{const t=installDom(),root=createRoot(t.container);let resolve!:(r:Response)=>void;Object.defineProperty(globalThis,'fetch',{configurable:true,writable:true,value:async(url:unknown)=>String(url).includes('/command')?new Promise<Response>(r=>{resolve=r;}):new Response('{}',{status:503})});try{await act(async()=>root.render(createElement(NoorPersonalApplicationView,{initialResult:{...today,today:{...today.today,tasks:today.today.tasks.map(e=>({...e,eligibility:{weight:9}})),habits:today.today.habits.map(e=>({...e,eligibility:{weight:1}}))}},initialWorkspace:workspace})));assert.match(t.container.querySelector('[data-testid="yesterday-achievement"]')!.textContent??'',/لا توجد استحقاقات مسجلة/);await act(async()=>t.container.querySelector<HTMLInputElement>('.np-habit-check')!.click());assert.equal(t.container.querySelector('[data-week-state="today"]')!.getAttribute('data-week-rate'),'10');assert.equal(t.container.querySelector('[data-testid="today-completion-rate"]')!.textContent,'10%');assert.equal(t.container.querySelector('.np-pending-save'),null);await act(async()=>resolve(new Response('{}',{status:503})));assert.equal(t.container.querySelector('[data-week-state="today"]')!.getAttribute('data-week-rate'),'0');assert.equal(t.container.querySelector('.np-yesterday-score strong')!.textContent,'0');}finally{await act(async()=>root.unmount());t.restore();t.dom.window.close();}});

test("R259: returning to Personal refreshes cross-device workspace only after idle cooldown and without a page reload",async()=>{
 const t=installDom(),root=createRoot(t.container);
 const originalDateNow=Date.now;let clock=originalDateNow(),visible=true,workspaceReads=0,todayReads=0;
 Date.now=()=>clock;
 Object.defineProperty(t.dom.window.document,"visibilityState",{configurable:true,get:()=>visible?"visible":"hidden"});
 const remoteWorkspace={...workspace.workspace,definitions:workspace.workspace.definitions.map(d=>
   d.id==="d1"?{...d,title:"عنوان المهمة من الآيفون"}:d)};
 const json=(value:unknown)=>new Response(JSON.stringify(value),{status:200,headers:{"content-type":"application/json; charset=utf-8"}});
 Object.defineProperty(globalThis,"fetch",{configurable:true,writable:true,value:async(url:unknown)=>{
   const key=String(url);
   if(key==="/api/noor/personal/today"){todayReads++;return json(today.today);}
   if(key==="/api/noor/personal/workspace"){workspaceReads++;return json(remoteWorkspace);}
   return json({current:{temperature_2m:29}});
 }});
 try{
   await act(async()=>root.render(createElement(NoorPersonalApplicationView,{initialResult:today,initialWorkspace:workspace})));
   await act(async()=>t.container.querySelector<HTMLButtonElement>('button[aria-label="فتح مركز التحكم"]')!.click());
   // Control Center defaults to Habits: select the Tasks section to see its title.
   await act(async()=>[...t.container.querySelectorAll<HTMLButtonElement>('.np-cc-nav-item')].find(b=>b.textContent?.includes("المهام"))!.click());
   assert.match(t.container.textContent??"",/تمرين/);
   assert.doesNotMatch(t.container.textContent??"",/عنوان المهمة من الآيفون/);
   await act(async()=>t.dom.window.dispatchEvent(new t.dom.window.Event("focus")));
   assert.equal(workspaceReads,0,"fresh initial workspace does not force a redundant immediate network request");
   clock+=15_010;
   visible=false;
   await act(async()=>t.dom.window.dispatchEvent(new t.dom.window.Event("focus")));
   assert.equal(workspaceReads,0,"a hidden tab must not fetch private task notes");
   visible=true;
   await act(async()=>{
     t.dom.window.document.dispatchEvent(new t.dom.window.Event("visibilitychange"));
     t.dom.window.dispatchEvent(new t.dom.window.Event("pageshow"));
   });
   assert.equal(todayReads,1);
   assert.equal(workspaceReads,1,"pageshow and visibilitychange must coalesce");
   assert.match(t.container.textContent??"",/عنوان المهمة من الآيفون/,"remote task name becomes visible without reload");
   await act(async()=>t.dom.window.dispatchEvent(new t.dom.window.Event("focus")));
   assert.equal(workspaceReads,1,"repeated focus within 15 seconds must not flood the API");
   clock+=15_010;
   await act(async()=>t.dom.window.dispatchEvent(new t.dom.window.Event("pageshow")));
   assert.equal(workspaceReads,2,"a later genuine resume must refresh again");
 }finally{
   await act(async()=>root.unmount());
   Date.now=originalDateNow;
   t.restore();t.dom.window.close();
 }
});
test('r95 classic achievement removes repeated decoration and keeps future days blank',async()=>{const t=installDom(),root=createRoot(t.container);try{await act(async()=>root.render(createElement(NoorPersonalApplicationView,{initialResult:today,initialWorkspace:workspace})));const card=t.container.querySelector('[data-achievement-style="classic-r95"]')!;assert.ok(card);assert.equal(card.querySelectorAll('.np-day-ring svg').length,1);assert.equal(card.querySelectorAll('.np-week-ring').length,0);assert.equal(t.container.querySelectorAll('[data-testid=r332-weekly-card] .np-week-value').length,7);assert.equal(card.querySelectorAll('.np-day-track').length,0);assert.doesNotMatch(card.textContent??'',/خطوة بخطوة، يكتمل يومك/);for(const future of t.container.querySelectorAll('[data-testid=r332-weekly-card] [data-week-state="future"]'))assert.equal(future.querySelector('strong')!.textContent,'');const style=t.dom.window.getComputedStyle(card);assert.equal(style.backgroundImage,'none');assert.equal(style.boxShadow,'none');assert.equal(style.borderRadius,'14px');}finally{await act(async()=>root.unmount());t.restore();t.dom.window.close();}});

test("R331 remaining sheet invokes real habit and daily task completion, updates count in place, and does not finish the recurring task",async()=>{
 const t=installDom(),root=createRoot(t.container);
 const requests:{command:any;resolve:(r:Response)=>void}[]=[];
 Object.defineProperty(globalThis,"fetch",{configurable:true,writable:true,value:async(url:unknown,init?:RequestInit)=>String(url).includes("/command")?new Promise<Response>(resolve=>requests.push({command:JSON.parse(String(init?.body)),resolve})):new Response("{}",{status:503})});
 const reply=(habit:boolean,task:boolean)=>new Response(JSON.stringify({workspace:workspace.workspace,executions:[...today.today.tasks.map(e=>({...e,status:task?"Completed":"Planned"})),...today.today.habits.map(e=>({...e,status:habit?"Completed":"Pending"}))],personalDayId:"day",materializationRequired:false}),{status:200});
 try{
  await act(async()=>root.render(createElement(NoorPersonalApplicationView,{initialResult:today,initialWorkspace:workspace})));
  await act(async()=>(t.container.querySelector('[data-testid="r286-remaining-trigger"]') as HTMLButtonElement).click());
  const sheet=()=>t.dom.window.document.querySelector(".np-r286-remaining-dialog")!;
  assert.equal(sheet().querySelectorAll("[data-testid^=remaining-activity-]").length,2);
  await act(async()=>(sheet().querySelector('input[aria-label="إتمام عادة المشي اليوم"]') as HTMLInputElement).click());
  assert.equal(requests[0]?.command.type,"set-execution-completed");assert.equal(requests[0]?.command.executionId,"e2");assert.equal(requests[0]?.command.completed,true);
  assert.equal(sheet().querySelectorAll("[data-testid^=remaining-activity-]").length,1);
  await act(async()=>requests[0]!.resolve(reply(true,false)));
  await act(async()=>(sheet().querySelector(".np-r331-task-done") as HTMLButtonElement).click());
  assert.equal(requests[1]?.command.type,"set-execution-completed");assert.equal(requests[1]?.command.executionId,"e1");assert.equal(requests[1]?.command.completed,true);
  await act(async()=>requests[1]!.resolve(reply(true,true)));
  assert.match(sheet().textContent??"",/اكتملت جميع المهام والعادات/);
  assert.equal(t.container.querySelector('[data-testid="r286-remaining-trigger"] strong')?.textContent,"0");
 }finally{await act(async()=>root.unmount());t.restore();t.dom.window.close();}
});

test("R332 approved weekly card presents weighted ring, actual category counts, and seven navigable circles",async()=>{const t=installDom(),root=createRoot(t.container);try{await act(async()=>root.render(createElement(NoorPersonalApplicationView,{initialResult:today,initialWorkspace:workspace})));const card=t.container.querySelector('[data-testid="r332-weekly-card"]')!;assert.ok(card);assert.equal(card.querySelector('[data-testid="r332-week-weighted-ring"] strong')?.textContent,"0%");assert.equal(card.querySelector('[data-testid="r332-week-tasks"] strong')?.textContent,"0 / 1");assert.equal(card.querySelector('[data-testid="r332-week-habits"] strong')?.textContent,"0 / 1");assert.equal(card.querySelectorAll('[data-week-date]').length,7);assert.ok(card.querySelector('[data-testid="r332-week-prayers"]'));assert.ok(card.querySelector('.np-r332-ring-fill'));assert.equal(card.querySelectorAll('.np-week-day-circle').length,7);assert.equal(card.closest('.np-day-context'),null);}finally{await act(async()=>root.unmount());t.restore();t.dom.window.close();}});

test("habit creation keeps prayer weights separate from the habit draft",async()=>{
  const t=installDom(),root=createRoot(t.container);
  const formData=globalThis.FormData;
  Object.defineProperty(globalThis,"FormData",{configurable:true,writable:true,value:t.dom.window.FormData});
  const requests:{body:{requestId:string};resolve:(response:Response)=>void}[]=[];
  const fetcher=globalThis.fetch;
  globalThis.fetch=async(url,options)=>String(url).includes("/command")
    ?new Promise<Response>(resolve=>requests.push({body:JSON.parse(String(options?.body)),resolve}))
    :fetcher(url,options);
  try{
    await act(async()=>root.render(createElement(NoorPersonalApplicationView,{initialResult:today,initialWorkspace:workspace})));
    await act(async()=>t.container.querySelector<HTMLButtonElement>('button[aria-label="فتح مركز التحكم"]')!.click());await act(async()=>[...t.container.querySelectorAll<HTMLButtonElement>('.np-cc-nav-item')].find(b=>b.textContent?.includes('العادات'))!.click());
    const add=[...t.container.querySelectorAll("button")].find(button=>button.textContent?.includes("إضافة عادة"))!;
    await act(async()=>add.click());
    const panel=document.querySelector(".np-cc-modal")!;
    const habitForm=panel.querySelector("#np-definition-edit-form")!;
    const prayerSettings=panel.querySelector("[data-testid=r334-prayer-policy-editor]")!;
    assert.ok(habitForm.querySelector('[name="weight"]'));
    assert.equal(prayerSettings.closest("form"),null);
    const weight=prayerSettings.querySelector<HTMLInputElement>("[data-testid=r334-prayer-base-weight]")!;
    assert.equal(weight.value,"");
    const savePrayer=prayerSettings.querySelector<HTMLButtonElement>("[data-testid=r334-policy-save]")!;
    assert.ok(savePrayer.disabled);
    habitForm.querySelector<HTMLInputElement>("#definition-title")!.value="عادة حفظ فوري";
    await act(async()=>habitForm.dispatchEvent(new t.dom.window.Event("submit",{bubbles:true,cancelable:true})));
    assert.ok(!document.querySelector(".np-cc-modal-backdrop:not([hidden])"),"The creation form should close before the server replies.");
    assert.ok(requests[0]?.body.requestId);
    assert.match(t.container.textContent??"",/عادة حفظ فوري/);
    await act(async()=>requests[0]!.resolve(new Response(null,{status:503})));
    assert.doesNotMatch(t.container.querySelector(".np-control")!.textContent??"",/عادة حفظ فوري/);
    const retry=t.container.querySelector<HTMLButtonElement>(".np-failed-save button")!;
    await act(async()=>retry.click());
    assert.equal(requests[1]?.body.requestId,requests[0]!.body.requestId);
    await act(async()=>requests[1]!.resolve(new Response(null,{status:503})));
  }finally{
    await act(async()=>root.unmount());
    Object.defineProperty(globalThis,"FormData",{configurable:true,writable:true,value:formData});
    t.restore();
    t.dom.window.close();
  }
});

test("weekly prayer shortcut shares today's recording and tools open their existing sections",async()=>{
  const t=installDom(),root=createRoot(t.container);
  const click=async(selector:string)=>{
    const button=document.querySelector<HTMLButtonElement>(selector);
    assert.ok(button,selector);
    await act(async()=>button.click());
  };
  try{
    await act(async()=>root.render(createElement(NoorPersonalApplicationView,{initialResult:today,initialWorkspace:workspace})));
    const prayerSheet='[role="dialog"][aria-label="مواقيت الصلوات"]';
    await click('.np-r331-board-grid button:first-child');
    const sharedSheet=document.querySelector(prayerSheet);
    assert.equal(sharedSheet?.getAttribute("aria-modal"),"true");
    const prayerChecks=[...sharedSheet!.querySelectorAll<HTMLButtonElement>(".np-r331-prayer-record")];
    assert.ok(prayerChecks.every(button=>button.getAttribute("role")==="checkbox"&&button.getAttribute("aria-checked")==="false"));
    const prayerToRecord=prayerChecks.find(button=>!button.disabled);
    if(prayerToRecord){
      await act(async()=>prayerToRecord.click());
      assert.ok(document.querySelector(".np-prayer-record-dialog"));
      assert.equal(prayerToRecord.getAttribute("aria-checked"),"false");
      await click('[aria-label="إغلاق تسجيل الصلاة"]');
    }
    await click('[aria-label="إغلاق مواقيت الصلوات"]');
    await click('[aria-label="فتح مواقيت الصلوات وتسجيل اليوم"]');
    assert.equal(document.querySelector(prayerSheet),sharedSheet);
    assert.equal(sharedSheet?.getAttribute("aria-modal"),"true");
    await click('[aria-label="إغلاق مواقيت الصلوات"]');
    await click('[data-testid="r324-nav-grid"]');
    const tools=document.querySelector('[aria-label="أدوات نور"]');
    assert.deepEqual([...tools!.querySelectorAll(".np-r356-overview-card strong")].map(node=>node.textContent),["العادات","المهام","التذكيرات","الإحصائيات","التصنيفات","الأحداث التاريخية","المالية"]);
    await click('[data-testid="r324-nav-home"]');
    await click('[aria-label="الضبط"]');
    const settings=document.querySelector('[aria-label="إعدادات نور"]')!;
    const weights=[...settings.querySelectorAll<HTMLButtonElement>(".np-r356-overview-card")].find(button=>button.textContent?.includes("الإنجاز والأوزان"))!;
    await act(async()=>weights.click());
    assert.ok(document.querySelector('[data-testid="r334-prayer-policy-editor"]'));
  }finally{
    await act(async()=>root.unmount());
    t.restore();
    t.dom.window.close();
  }
});

test("settings opens a compact Noor identity overview before individual settings",async()=>{
  const t=installDom(),root=createRoot(t.container);
  try{
    await act(async()=>root.render(createElement(NoorPersonalApplicationView,{initialResult:today,initialWorkspace:workspace})));
    await act(async()=>t.container.querySelector<HTMLButtonElement>('button[aria-label="الضبط"]')!.click());
    const panel=t.container.querySelector('.np-r356-overview[aria-label="إعدادات نور"]')!;
    assert.ok(panel);
    assert.deepEqual([...panel.querySelectorAll(".np-r356-overview-card strong")].map(node=>node.textContent),["المظهر","التوقيت والموقع","تنظيم العرض","الإنجاز والأوزان"]);
    await act(async()=>panel.querySelector<HTMLButtonElement>(".np-r356-overview-card")!.click());
    assert.equal(t.container.querySelectorAll(".np-cc-theme").length,6);
    assert.equal(t.container.querySelector('.np-control-title')?.textContent,"المظهر");
  }finally{
    await act(async()=>root.unmount());
    t.restore();
    t.dom.window.close();
  }
});

for(const first of [true,false])test(`beverage ${first?"first cup":"existing cup"} appears before the response and retries the same entry`,async()=>{
  const t=installDom(),root=createRoot(t.container);
  const requests:{body:{type:string;requestId?:string;executionId?:string;entryId?:string;beverageTime?:string};resolve:(response:Response)=>void}[]=[];
  const day=today.today.personalDay.boundary.localDate;
  let savedWorkspace=workspace.workspace;
  const persistedExecution={id:"tea-execution",definitionId:"tea-definition",title:"شاي",kind:"Habit" as const,status:"Pending"};
  const tea={...workspace.workspace.definitions[1]!,id:persistedExecution.definitionId,revisionId:"tea-revision",title:"شاي",
    effectiveFromDate:day,schedule:{kind:"Daily"},beveragePlan:{targetServings:2,kind:"tea",sleepTime:"00:00"},activityLog:[]};
  const json=(value:unknown)=>Response.json(value);
  const fetcher=globalThis.fetch;
  const todayWithTea=()=>({...today.today,habits:[...today.today.habits,{...persistedExecution,definitionId:savedWorkspace.definitions.at(-1)!.id}]});
  globalThis.fetch=async(url,options)=>{
    if(String(url).includes("/command"))return new Promise(resolve=>requests.push({body:JSON.parse(String(options?.body)),resolve}));
    if(String(url).includes("/api/noor/personal/today"))return json({...todayWithTea(),workspace:savedWorkspace});
    return fetcher(url,options);
  };
  if(!first)savedWorkspace={...savedWorkspace,definitions:[...savedWorkspace.definitions,tea]};
  const click=async(text:string)=>act(async()=>{
    const button=[...t.container.querySelectorAll<HTMLButtonElement>("button")].find(b=>b.textContent?.trim()===text);
    assert.ok(button,text);
    assert.equal(button.disabled,false,text);
    button.click();
  });
  const total=()=>t.container.querySelector(".np-caffeine-tally-r295>div:nth-child(2) strong")?.textContent;
  try{
    await act(async()=>root.render(createElement(NoorPersonalApplicationView,{initialResult:first?today:{...today,today:todayWithTea()},initialWorkspace:{...workspace,workspace:savedWorkspace}})));
    const achievement=t.container.querySelector('[data-testid="today-completion-rate"]')?.textContent;
    await click("+ شاي");
    await click("ضحى · 09:00");
    await click("تأكيد تسجيل الكوب");
    assert.equal(total(),"1");
    assert.equal(t.container.querySelector('[data-testid="r295-time-picker"]'),null);
    assert.equal(t.container.querySelector('[data-testid="today-completion-rate"]')?.textContent,achievement);
    assert.equal(requests.length,1);
    if(first){
      const creation=requests[0]!;
      assert.equal(creation.body.type,"create-definition");
      savedWorkspace={...savedWorkspace,definitions:[...savedWorkspace.definitions,{...tea,id:`definition-request:user:${creation.body.requestId}`}]};
      await act(async()=>creation.resolve(json({workspace:savedWorkspace,executions:[...today.today.tasks,...today.today.habits],personalDayId:"day",materializationRequired:true})));
      assert.equal(total(),"1","materializing the first counter must preserve the pending cup");
    }
    const cup=requests.at(-1)!;
    assert.equal(cup.body.type,"adjust-beverage-serving");
    assert.equal(cup.body.executionId,persistedExecution.id);
    assert.equal(cup.body.beverageTime,"09:00");
    await act(async()=>cup.resolve(new Response(null,{status:503})));
    assert.equal(total(),"0");
    await click("إعادة المحاولة");
    const retry=requests.at(-1)!;
    assert.deepEqual(retry.body,cup.body);
    assert.equal(total(),"1");
    const log=[{id:retry.body.entryId!,executionId:persistedExecution.id,at:`${day}T06:00:00Z`,localDate:day,amount:1,note:"",endReason:null,beverageTime:"09:00"}];
    savedWorkspace={...savedWorkspace,definitions:savedWorkspace.definitions.map(d=>d.id===savedWorkspace.definitions.at(-1)?.id?{...d,activityLog:log}:d)};
    await act(async()=>retry.resolve(json({workspace:savedWorkspace,executions:[...today.today.tasks,...todayWithTea().habits],personalDayId:"day",materializationRequired:false})));
    assert.equal(total(),"1","server acknowledgement must not count the same entry twice");
    assert.equal(t.container.querySelector(".np-save-notices")?.textContent,"");
  }finally{
    await act(async()=>root.unmount());t.restore();t.dom.window.close();
  }
});
