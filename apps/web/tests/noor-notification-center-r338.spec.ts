import assert from "node:assert/strict";
import test from "node:test";
import {JSDOM} from "jsdom";
import React,{act,createElement} from "react";
import {createRoot} from "react-dom/client";
import {NoorNotificationCenterR338,recoveryReminder,recoveryReminderSchedule} from "../src/noor-notification-center-r338.js";

test("R338 alert center opens, lists due reminders and appointments, and follows the selected reminder",async()=>{
 const dom=new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>',{url:"https://noor.test/personal"});
 const originals=new Map<string,PropertyDescriptor|undefined>();
 const globals:Record<string,unknown>={window:dom.window,document:dom.window.document,navigator:dom.window.navigator,
  Node:dom.window.Node,Element:dom.window.Element,HTMLElement:dom.window.HTMLElement,React,
  IS_REACT_ACT_ENVIRONMENT:true};
 for(const [key,value] of Object.entries(globals)){
  originals.set(key,Object.getOwnPropertyDescriptor(globalThis,key));
  Object.defineProperty(globalThis,key,{configurable:true,writable:true,value});
 }
 const root=createRoot(dom.window.document.getElementById("root")!);
 const opened:string[]=[];
 const marked:string[]=[];
 let saveRead:(saved:boolean)=>void=()=>{};
 const savedLater=new Promise<boolean>(resolve=>{saveRead=resolve;});
 const todayDate="2026-11-16";
 const nowMs=Date.parse(todayDate+"T15:00:00Z");
 const scheduledFor=new Date(nowMs).toISOString();
 const known={kind:"reminder" as const,targetId:"previous",scheduledFor,occurredAt:scheduledFor};
 try{
  await act(async()=>root.render(createElement(NoorNotificationCenterR338,{
   alerts:[{definitionId:"reading",title:"قراءة يومية",time:"19:00",kind:"due",streak:3}],
   appointments:[{id:"doctor",title:"موعد الطبيب",when:"الأحد، ١٦ نوفمبر ١٠:٠٠ ص",remaining:"14:00:00"}],
   todayDate,nowMs,
   history:[
    {...known,id:"prior-read",title:"إشعار مقروء سابقًا",readAt:scheduledFor},
    {...known,id:"prior-unread",title:"إشعار سابق غير مقروء",readAt:null},
    {...known,id:"reminder:reading:2026-11-16",targetId:"reading",title:"قراءة يومية",readAt:null},
   ],
   onObserve:async()=>true,
   onMarkRead:async id=>{marked.push(id);return id.startsWith("reminder:reading")?savedLater:true;},
   onOpenReminder:id=>opened.push("reminder:"+id),onOpenAppointment:()=>opened.push("appointments"),onOpenSettings:()=>opened.push("settings"),
  })));
  const doc=dom.window.document;
  assert.match(doc.querySelector(".np-r338-bell")?.getAttribute("aria-label")??"",/3 تنبيه/);
  await act(async()=>doc.querySelector<HTMLButtonElement>(".np-r338-bell")!.click());
  assert.ok(doc.querySelector('[role="dialog"][aria-label="مركز التنبيهات"]'));
  assert.match(doc.body.textContent??"",/قراءة يومية/);
  assert.match(doc.body.textContent??"",/موعد الطبيب/);
  assert.doesNotMatch(doc.body.textContent??"",/إشعار مقروء سابقًا/);
  assert.equal(doc.querySelectorAll(".np-r338-alert-row").length,3);
  await act(async()=>doc.querySelector<HTMLButtonElement>(".np-r338-alert-read")!.click());
  assert.doesNotMatch(doc.body.textContent??"",/إشعار سابق غير مقروء/);
  const reminder=[...doc.querySelectorAll<HTMLButtonElement>(".np-r338-alert-row")].find(button=>button.textContent?.includes("قراءة يومية"));
  assert.ok(reminder);
  await act(async()=>{reminder!.click();await new Promise(resolve=>setTimeout(resolve,5));});
  assert.deepEqual(opened,["reminder:reading"]);
  assert.equal(doc.querySelector('[aria-label="مركز التنبيهات"]'),null);
  assert.deepEqual(marked,["prior-unread","reminder:reading:2026-11-16"]);
  assert.match(doc.querySelector(".np-r338-bell")?.getAttribute("aria-label")??"",/1 تنبيه/,
   "the count drops while the read write is still unresolved");
  await act(async()=>saveRead(true));
  await act(async()=>doc.querySelector<HTMLButtonElement>(".np-r338-bell")!.click());
  assert.doesNotMatch(doc.body.textContent??"",/قراءة يومية/);
  assert.match(doc.querySelector(".np-r338-bell")?.getAttribute("aria-label")??"",/1 تنبيه/);
  const oldRecoveryId="achievement-yesterday:2026-11-15:1";
  const newRecoveryId="achievement-yesterday:2026-11-15:2";
  const notice={id:newRecoveryId,targetId:"2026-11-15",title:"فائت أمس",detail:"ابدأ بالأعلى وزنًا",scheduledFor,open:()=>opened.push("recovery")};
  const observed:string[]=[];
  const recoveryProps={
   alerts:[],appointments:[],achievementNotices:[notice],todayDate,nowMs,
   history:[{...known,id:oldRecoveryId,title:"فائت أمس",readAt:null}],
   onObserve:async({id}:{id:string})=>{observed.push(id);return true;},
   onMarkRead:async(id:string)=>{marked.push(id);return true;},
   onOpenReminder:()=>{},onOpenAppointment:()=>{},onOpenSettings:()=>{},
  };
  await act(async()=>root.render(createElement(NoorNotificationCenterR338,recoveryProps)));
  assert.equal(doc.querySelector(".np-r338-badge")?.textContent,"1","expired windows do not accumulate");
  await act(async()=>doc.querySelector<HTMLButtonElement>(".np-r338-alert-row")!.click());
  assert.equal(doc.querySelector(".np-r338-badge"),null);
  assert.deepEqual(observed,[newRecoveryId]);
  assert.equal(marked.at(-1),newRecoveryId);
  await act(async()=>root.render(createElement(NoorNotificationCenterR338,{
   ...recoveryProps,key:"remount",history:[...recoveryProps.history,{...known,id:newRecoveryId,title:notice.title,readAt:scheduledFor}],
  })));
  assert.equal(doc.querySelector(".np-r338-badge"),null,"a saved read survives remounting");
 }finally{
  await act(async()=>root.unmount());
  for(const [key,descriptor] of originals){if(descriptor)Object.defineProperty(globalThis,key,descriptor);else Reflect.deleteProperty(globalThis,key);}
  dom.window.close();
 }
});

test("recovery reminders use four civil windows, prioritize remaining weight and stop when resolved",()=>{
 const date="2026-11-19",zone="Asia/Riyadh";
 const schedule=recoveryReminderSchedule(date,zone);
 const items=[{title:"مشي",weight:1},{title:"قراءة",weight:4}];
 const alert=(at:string,pending:typeof items=items)=>recoveryReminder(date,Date.parse(`${date}T${at}:00+03:00`),schedule,pending,()=>{});
 assert.equal(alert("07:59"),null);
 assert.deepEqual(["08:00","12:00","16:00","20:00"].map(hour=>alert(hour)?.id),
  [1,2,3,4].map(n=>`achievement-yesterday:2026-11-18:${n}`));
 assert.match(alert("12:00")!.detail,/قراءة/);
 assert.doesNotMatch(alert("12:00",[items[0]!])!.detail,/قراءة/);
 assert.equal(alert("20:00",[]),null);
 assert.equal(alert("23:59")?.id,alert("20:00")?.id);
 const tomorrow="2026-11-20";
 assert.equal(recoveryReminder(tomorrow,Date.parse(tomorrow+"T00:00:00+03:00"),recoveryReminderSchedule(tomorrow,zone),items,()=>{}),null);
});
