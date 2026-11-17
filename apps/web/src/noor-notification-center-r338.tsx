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
type ObserveNotification={type:"observe-notification";id:string;kind:"reminder"|"appointment";title:string;targetId:string;scheduledFor:string};
type AchievementNotice = Readonly<{id:string;title:string;detail:string;open:()=>void}>;
type Props=Readonly<{
 achievementNotices?:readonly AchievementNotice[];
 alerts:readonly NoorReminderAlertR314[];
 appointments:readonly NoorNotificationAppointmentR338[];
 onOpenReminder:(definitionId:string)=>void;
 onOpenAppointment:()=>void;
 onOpenSettings:()=>void;
 history?:readonly NoorNotificationHistoryR338[];
 todayDate?:string|null;
 nowMs?:number;
 onObserve?:(command:ObserveNotification)=>Promise<boolean>;
 onMarkRead?:(notificationId:string,expectedReadAt:string|null)=>Promise<boolean>;
}>;
const reminderKind=(kind:NoorReminderAlertR314["kind"])=>kind==="overdue"?"تجاوز الموعد":kind==="streak-risk"?"حافظ على سلسلة الإنجاز":"موعد النشاط";

/** In-app alert inbox. It reads the existing reminder and countdown sources;
 * it does not create a second reminder store or send device notifications. */
export function NoorNotificationCenterR338({alerts,appointments,achievementNotices=[],onOpenReminder,onOpenAppointment,onOpenSettings,history=[],todayDate=null,nowMs=Date.now(),onObserve,onMarkRead}:Props):ReactElement{
 const [open,setOpen]=useState(false);
 const closeButton=useRef<HTMLButtonElement>(null);
 const queue=useRef(Promise.resolve());
 const observedIds=useRef(new Set<string>());
 const [readIds,setReadIds]=useState<ReadonlySet<string>>(()=>new Set());
 const storedIds=new Set(history.map(entry=>entry.id));
 const read=(id:string)=>readIds.has(id)||history.some(entry=>entry.id===id&&entry.readAt!==null);
 const reminderBaseId=(id:string)=>`reminder:${id}:${todayDate??"today"}`;
 const reminderId=(item:NoorReminderAlertR314)=>`${reminderBaseId(item.definitionId)}${item.repeat?`:repeat-${item.repeat}`:""}`;
 const appointmentId=(item:NoorNotificationAppointmentR338)=>`appointment:${item.id}:${item.scheduledFor??"upcoming"}`;
 const activeAlerts=alerts.filter(item=>!read(reminderId(item)));
 const activeAppointments=appointments.filter(item=>!read(appointmentId(item)));
 const activeIds=new Set([...activeAlerts.map(item=>reminderId(item)),...activeAppointments.map(appointmentId)]);
 const supersededReminderIds=new Set(alerts.flatMap(item=>{
  if(!item.repeat)return [];
  const first=reminderBaseId(item.definitionId);
  return item.repeat===2?[first,reminderId({...item,repeat:1})]:[first];
 }));
 const unreadHistory=history.filter(entry=>!read(entry.id)&&!activeIds.has(entry.id)&&!supersededReminderIds.has(entry.id));
 const visibleNotices=achievementNotices.filter(item=>!readIds.has(item.id));
 const count=activeIds.size+unreadHistory.length+visibleNotices.length;
 const enqueue=(action:()=>Promise<void>)=>{
  queue.current=queue.current.then(action).catch(()=>{});
 };
 const observe=async(command:ObserveNotification)=>{
  if(storedIds.has(command.id)||observedIds.current.has(command.id))return true;
  if(!onObserve||!await onObserve(command))return false;
  observedIds.current.add(command.id);
  return true;
 };
 const markRead=(id:string,command?:ObserveNotification)=>{
  if(!onMarkRead)return;
  enqueue(async()=>{
   if(command&&!await observe(command))return;
   if(await onMarkRead(id,null)){
    setReadIds(ids=>new Set([...ids,id]));
   }
  });
 };
 const reminderCommand=(item:NoorReminderAlertR314):ObserveNotification=>({
  type:"observe-notification",id:reminderId(item),kind:"reminder",title:item.title,
  targetId:item.definitionId,scheduledFor:new Date(nowMs).toISOString(),
 });
 const appointmentCommand=(item:NoorNotificationAppointmentR338):ObserveNotification=>({
  type:"observe-notification",id:appointmentId(item),kind:"appointment",title:item.title,
  targetId:item.id,scheduledFor:item.scheduledFor??new Date(nowMs).toISOString(),
 });
 const openInbox=()=>{
  setOpen(true);
  enqueue(async()=>{
   for(const item of activeAlerts)await observe(reminderCommand(item));
   for(const item of activeAppointments)await observe(appointmentCommand(item));
  });
 };
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
   {visibleNotices.length?<section className="np-r338-alert-group" aria-label="متابعة الإنجاز"><h3>متابعة الإنجاز</h3>{visibleNotices.map(item=><button className="np-r338-alert-row" type="button" key={item.id} onClick={()=>{setReadIds(ids=>new Set([...ids,item.id]));closeThen(item.open);}}>
    <span className="np-r338-alert-mark" aria-hidden="true"><NoorR323Icon name="bars"/></span><span className="np-r338-alert-copy"><strong>{item.title}</strong><small>{item.detail}</small></span><span className="np-r338-alert-arrow" aria-hidden="true">‹</span>
   </button>)}</section>:null}
   {activeAlerts.length?<section className="np-r338-alert-group" aria-label="التذكيرات المستحقة"><h3>تذكيرات مستحقة <span>{activeAlerts.length}</span></h3>{activeAlerts.map(alert=><button className="np-r338-alert-row" type="button" key={alert.definitionId} onClick={()=>{markRead(reminderId(alert),reminderCommand(alert));closeThen(()=>onOpenReminder(alert.definitionId));}}>
    <span className="np-r338-alert-mark" aria-hidden="true"><NoorR323Icon name="bell"/></span><span className="np-r338-alert-copy"><strong>{alert.title}</strong><small>{alert.repeat?"تذكير متكرر · ":""}{reminderKind(alert.kind)} · {alert.time}</small></span><span className="np-r338-alert-arrow" aria-hidden="true">‹</span>
   </button>)}</section>:null}
   {activeAppointments.length?<section className="np-r338-alert-group" aria-label="المواعيد القادمة"><h3>المواعيد القادمة</h3>{appointments.map(item=><button className="np-r338-alert-row" type="button" key={item.id} onClick={()=>{markRead(appointmentId(item),appointmentCommand(item));closeThen(onOpenAppointment);}}>
    <span className="np-r338-alert-mark appointment" aria-hidden="true"><span>◷</span></span><span className="np-r338-alert-copy"><strong>{item.title}</strong><small>{item.when} · المتبقي {item.remaining}</small></span><span className="np-r338-alert-arrow" aria-hidden="true">‹</span>
   </button>)}</section>:null}
   {unreadHistory.length?<section className="np-r338-alert-group" aria-label="السجل السابق"><h3>السجل السابق <span>{unreadHistory.length}</span></h3>{unreadHistory.slice(0,20).map(entry=><div className="np-r338-alert-row" key={entry.id}>
    <span className="np-r338-alert-mark" aria-hidden="true"><NoorR323Icon name="bell"/></span><span className="np-r338-alert-copy"><strong>{entry.title}</strong><small>{entry.kind==="reminder"?"تذكير":"موعد"} · {new Date(entry.occurredAt).toLocaleString("ar-SA")}</small></span><button type="button" className="np-r338-alert-read" onClick={()=>{closeButton.current?.focus();markRead(entry.id);}}>تمت القراءة</button>
   </div>)}</section>:null}
   {count===0?<p className="np-r338-alert-empty">لا توجد تذكيرات مستحقة أو مواعيد قادمة الآن.</p>:null}
   <footer><button type="button" onClick={()=>closeThen(onOpenSettings)}>إعدادات التنبيهات</button></footer>
  </section>
 </div>:null;
 return <>
  <button type="button" className="np-icon-btn np-r338-bell" aria-label={`فتح التنبيهات${count?` · ${count} تنبيه`:""}`} aria-haspopup="dialog" aria-expanded={open} onClick={openInbox}>
   <NoorR323Icon name="bell"/>{count?<span className="np-r338-badge" aria-label={`${count} تنبيه`}>{count>9?"9+":count}</span>:null}
  </button>
  {overlay?createPortal(overlay,document.body):null}
 </>;
}
