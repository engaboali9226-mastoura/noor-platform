import assert from "node:assert/strict";
import test from "node:test";
import {JSDOM} from "jsdom";
import React,{act,createElement} from "react";
import {createRoot} from "react-dom/client";
import {NoorNotificationCenterR338} from "../src/noor-notification-center-r338.js";

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
 try{
  await act(async()=>root.render(createElement(NoorNotificationCenterR338,{
   alerts:[{definitionId:"reading",title:"قراءة يومية",time:"19:00",kind:"due",streak:3}],
   appointments:[{id:"doctor",title:"موعد الطبيب",when:"الأحد، ١٦ نوفمبر ١٠:٠٠ ص",remaining:"14:00:00"}],
   onOpenReminder:id=>opened.push("reminder:"+id),onOpenAppointment:()=>opened.push("appointments"),onOpenSettings:()=>opened.push("settings"),
  })));
  const doc=dom.window.document;
  assert.match(doc.querySelector(".np-r338-bell")?.getAttribute("aria-label")??"",/2 تنبيه/);
  await act(async()=>doc.querySelector<HTMLButtonElement>(".np-r338-bell")!.click());
  assert.ok(doc.querySelector('[role="dialog"][aria-label="مركز التنبيهات"]'));
  assert.match(doc.body.textContent??"",/قراءة يومية/);
  assert.match(doc.body.textContent??"",/موعد الطبيب/);
  const reminder=[...doc.querySelectorAll<HTMLButtonElement>(".np-r338-alert-row")].find(button=>button.textContent?.includes("قراءة يومية"));
  assert.ok(reminder);
  await act(async()=>{reminder!.click();await new Promise(resolve=>setTimeout(resolve,5));});
  assert.deepEqual(opened,["reminder:reading"]);
  assert.equal(doc.querySelector('[aria-label="مركز التنبيهات"]'),null);
 }finally{
  await act(async()=>root.unmount());
  for(const [key,descriptor] of originals){if(descriptor)Object.defineProperty(globalThis,key,descriptor);else Reflect.deleteProperty(globalThis,key);}
  dom.window.close();
 }
});
