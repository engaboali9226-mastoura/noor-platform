import React,{useEffect,useRef,useState,type ReactElement, type KeyboardEvent} from "react";
import {createPortal} from "react-dom";
import type {NoorReminderAlertR314} from "./noor-reminders-r314.js";
import {NoorR323Icon} from "./noor-r323-icons.js";

export type NoorNotificationAppointmentR338=Readonly<{
 id:string;title:string;when:string;remaining:string;scheduledFor?:string;
}>;
export type NoorNotificationHistoryR338=Readonly<{
 id:string;kind:"reminder"|"appointment";title:string;targetId:string;scheduledFor:string;occurredAt:string;readAt:string|null;
}>;
type Props=Readonly<{
 alerts:readonly NoorReminderAlertR314[];
 appointments:readonly NoorNotificationAppointmentR338[];
 onOpenReminder:(definitionId:string)=>void;
 onOpenAppointment:()=>void;
 onOpenSettings:()=>void;
 history?:readonly NoorNotificationHistoryR338[];
 todayDate?:string|null;
 nowMs?:number;
 onObserve?:(command:{type:"observe-notification";id:string;kind:"reminder"|"appointment";title:string;targetId:string;scheduledFor:string})=>void;
 onMarkRead?:(notificationId:string,expectedReadAt:string|null)=>void;
}>;
const reminderKind=(kind:NoorReminderAlertR314["kind"])=>kind==="overdue"?"تجاوز الموعد":kind==="streak-risk"?"حافظ على سلسلة الإنجاز":"موعد النشاط";

/** In-app alert inbox. It reads the existing reminder and countdown sources;
 * it does not create a second reminder store or send device notifications. */
export function NoorNotificationCenterR338({alerts,appointments,onOpenReminder,onOpenAppointment,onOpenSettings,history=[],todayDate=null,nowMs=Date.now(),onObserve,onMarkRead}:Props):ReactElement{
 const [open,setOpen]=useState(false);
 const closeButton=useRef<HTMLButtonElement>(null);
 const observedNotificationIds=useRef<Set<string>>(new Set());
 const unreadHistory=history.filter(entry=>entry.readAt===null);
 const count=alerts.length+appointments.length+unreadHistory.length;
 useEffect(()=>{
  if(!open||!onObserve)return;
  const observedAt=new Date(nowMs).toISOString();
  for(const alert of alerts){const id=`reminder:${alert.definitionId}:${todayDate??"today"}`;if(observedNotificationIds.current.has(id))continue;observedNotificationIds.current.add(id);onObserve({type:"observe-notification",id,kind:"reminder",title:alert.title,targetId:alert.definitionId,scheduledFor:observedAt});}
  for(const appointment of appointments){const id=`appointment:${appointment.id}:${appointment.scheduledFor??observedAt}`;if(observedNotificationIds.current.has(id))continue;observedNotificationIds.current.add(id);onObserve({type:"observe-notification",id,kind:"appointment",title:appointment.title,targetId:appointment.id,scheduledFor:appointment.scheduledFor??observedAt});}
 },[open,alerts,appointments,onObserve,todayDate,nowMs]);
 useEffect(()=>{
  if(!open)return;
  const opener=document.activeElement as HTMLElement|null;
  const oldOverflow=document.body.style.overflow;
  document.body.style.overflow="hidden";
  closeButton.current?.focus();
  const escape=(event:KeyboardEvent)=>{if(event.key==="Escape"){event.preventDefault();setOpen(false);}};
  document.addEventListener("keydown",escape);
  return()=>{document.removeEventListener("keydown",escape);document.body.style.overflow=oldOverflow;if(opener?.isConnected)opener.focus();};
 },[open]);
 const closeThen=(action:()=>void)=>{setOpen(false);window.setTimeout(action,0);};
 const trap=(event:KeyboardEvent<HTMLElement>)=>{
  if(event.key!=="Tab")return;
  const controls=Array.from(event.currentTarget.querySelectorAll<HTMLElement>("button:not(:disabled)"));
  const first=controls[0],last=controls.at(-1);
  if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus();}
  else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}
 };
 const overlay=open?<div className="np-r338-alert-overlay" onMouseDown={event=>{if(event.target===event.currentTarget)setOpen(false);}}>
  <section className="np-r338-alert-sheet" role="dialog" aria-modal="true" aria-label="مركز التنبيهات" dir="rtl" onKeyDown={trap}>
   <header><div><h2>مركز التنبيهات</h2><p>التذكيرات والمواعيد المرتبطة بيومك</p></div><button type="button" ref={closeButton} aria-label="إغلاق مركز التنبيهات" onClick={()=>setOpen(false)}>×</button></header>
   {alerts.length?<section className="np-r338-alert-group" aria-label="التذكيرات المستحقة"><h3>تذكيرات مستحقة <span>{alerts.length}</span></h3>{alerts.map(alert=><button className="np-r338-alert-row" type="button" key={alert.definitionId} onClick={()=>closeThen(()=>onOpenReminder(alert.definitionId))}>
    <span className="np-r338-alert-mark" aria-hidden="true"><NoorR323Icon name="bell"/></span><span className="np-r338-alert-copy"><strong>{alert.title}</strong><small>{reminderKind(alert.kind)} · {alert.time}</small></span><span className="np-r338-alert-arrow" aria-hidden="true">‹</span>
   </button>)}</section>:null}
   {appointments.length?<section className="np-r338-alert-group" aria-label="المواعيد القادمة"><h3>المواعيد القادمة</h3>{appointments.map(item=><button className="np-r338-alert-row" type="button" key={item.id} onClick={()=>closeThen(onOpenAppointment)}>
    <span className="np-r338-alert-mark appointment" aria-hidden="true"><span>◷</span></span><span className="np-r338-alert-copy"><strong>{item.title}</strong><small>{item.when} · المتبقي {item.remaining}</small></span><span className="np-r338-alert-arrow" aria-hidden="true">‹</span>
   </button>)}</section>:null}
   {history.length?<section className="np-r338-alert-group" aria-label="السجل السابق"><h3>السجل السابق <span>{history.length}</span></h3>{history.slice(0,20).map(entry=><div className={`np-r338-alert-row${entry.readAt?" is-read":""}`} key={entry.id}>
    <span className="np-r338-alert-mark" aria-hidden="true"><NoorR323Icon name="bell"/></span><span className="np-r338-alert-copy"><strong>{entry.title}</strong><small>{entry.kind==="reminder"?"تذكير":"موعد"} · {new Date(entry.occurredAt).toLocaleString("ar-SA")}</small></span>{entry.readAt===null?<button type="button" className="np-r338-alert-read" onClick={()=>onMarkRead?.(entry.id,entry.readAt)}>تمت القراءة</button>:<small>مقروء</small>}
   </div>)}</section>:null}
   {!alerts.length&&!appointments.length&&!history.length?<p className="np-r338-alert-empty">لا توجد تذكيرات مستحقة أو مواعيد قادمة الآن.</p>:null}
   <footer><button type="button" onClick={()=>closeThen(onOpenSettings)}>إعدادات التنبيهات</button></footer>
  </section>
 </div>:null;
 return <>
  <button type="button" className="np-icon-btn np-r338-bell" aria-label={`فتح التنبيهات${count?` · ${count} تنبيه`:""}`} aria-haspopup="dialog" aria-expanded={open} onClick={()=>setOpen(true)}>
   <NoorR323Icon name="bell"/>{count?<span className="np-r338-badge" aria-label={`${count} تنبيه`}>{count>9?"9+":count}</span>:null}
  </button>
  {overlay?createPortal(overlay,document.body):null}
 </>;
}
