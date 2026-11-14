import {useState,type ReactElement} from "react";
import type {NoorPersonalCommandInput} from "./noor-personal-today-client.js";

export type HabitWeightDefinition=Readonly<{id:string;revisionId:string;kind:"Habit"|"Task";title:string;category:string;importance:string;weight:number;state:string}>;
type HabitExecution=Readonly<{definitionId:string;kind:"Habit"|"Task";weight:number;status:string}>;
export type PrayerWeightKeyR334="fajr"|"dhuhr"|"asr"|"maghrib"|"isha";
export function prayerHabitCandidateR334(raw:string):PrayerWeightKeyR334|null{
 const title=raw.normalize("NFKC").toLocaleLowerCase("ar").replace(/[\u064b-\u065f\u0670\u0640]/g,"").replace(/[أإآٱ]/g,"ا").replace(/ى/g,"ي").replace(/ة/g,"ه").replace(/^\s*[0-9٠-٩۰-۹]+\s*[-–—.]\s*/u,"").trim();
 const match=title.match(/^(?:(?:صلاه|فرض)\s+)?(?:ال)?(فجر|ظهر|عصر|مغرب|عشاء)$/u);
 if(match)return ({"فجر":"fajr","ظهر":"dhuhr","عصر":"asr","مغرب":"maghrib","عشاء":"isha"} as const)[match[1] as "فجر"|"ظهر"|"عصر"|"مغرب"|"عشاء"];
 const english=title.match(/^(fajr|dhuhr|zuhr|asr|maghrib|isha)(?: prayer)?$/iu)?.[1];
 return english?(english==="zuhr"?"dhuhr":english as PrayerWeightKeyR334):null;
}
// Read-only hints from account-owned definitions. Title matches never authorize exclusion.
export function auditPrayerWeightsR334(definitions:readonly HabitWeightDefinition[]){
 const active=definitions.filter(d=>["Active","Paused"].includes(d.state));
 const candidates=active.flatMap(d=>{const key=d.kind==="Habit"?prayerHabitCandidateR334(d.title):null;return key?[{id:d.id,title:d.title,key,weight:d.weight}]:[];});
 const others=active.filter(d=>!candidates.some(c=>c.id===d.id));
 const maximum=(rows:readonly HabitWeightDefinition[])=>rows.reduce((n,d)=>Number.isFinite(d.weight)?Math.max(n,d.weight):n,0);
 return {candidates,highestOtherWeight:maximum(others),highestConfiguredWeight:maximum(active)};
}
export function proposedHabitWeight(h:Pick<HabitWeightDefinition,"title"|"importance"|"category">):number{
 const title=h.title.normalize("NFKC").toLocaleLowerCase("ar").replace(/[\u064b-\u065f\u0670\u0640]/g,"").replace(/[أإآٱ]/g,"ا").replace(/ى/g,"ي").replace(/ة/g,"ه").replace(/^\s*[0-9٠-٩۰-۹]+\s*[-–—.]\s*/u,"").trim();
 if(prayerHabitCandidateR334(h.title))return 25;
 if(/قران|قرءان|qur.?an|quran|تلاوه|حفظ\s+سوره/iu.test(title))return 12;
 if(/اذكار|ذكر|استغفار|dhikr/iu.test(title))return 10;
 if(/دواء|ادويه|علاج|medication|medicine/iu.test(title))return 14;
 if(/نوم|sleep/iu.test(title))return 9;
 if(/عمل|وظيفه|work|career/iu.test(title))return 8;
 if(/جيم|تمرين|رياضه|gym|workout|exercise/iu.test(title))return 6;
 if(/مشي|مرونه|حركه|mobility|walk|stretch/iu.test(title))return 5;
 if(/انجليزي|عربي|لغه|english|arabic|language/iu.test(title))return 4;
 return ({Essential:14,Important:8,Supporting:4,Optional:1} as Record<string,number>)[h.importance]??4;
}
const percent=(a:number,b:number)=>b?Math.round(a/b*100):0;
export function NoorHabitWeightManagerR251({definitions,executions,busy,onCommand}:{
 definitions:readonly HabitWeightDefinition[];executions:readonly HabitExecution[];busy:boolean;
 onCommand:(command:NoorPersonalCommandInput)=>Promise<boolean>;
}):ReactElement{
 const [custom,setCustom]=useState<Record<string,number>>({});
 const [confirm,setConfirm]=useState(false);
 const [saving,setSaving]=useState(false);
 const [feedback,setFeedback]=useState("");
 const prayerAudit=auditPrayerWeightsR334(definitions);
 const habits=definitions.filter(d=>d.kind==="Habit"&&["Active","Paused"].includes(d.state));
 const rows=habits.map(d=>({...d,recommended:custom[d.id]??proposedHabitWeight(d)}));
 const changes=rows.filter(d=>d.weight!==d.recommended).map(d=>({definitionId:d.id,expectedRevisionId:d.revisionId,weight:d.recommended}));
 const due=executions.filter(e=>e.kind==="Habit"&&!["Cancelled","Suppressed"].includes(e.status));
 const next=new Map(rows.map(d=>[d.id,d.recommended] as const));
 const currentTotal=due.reduce((sum,d)=>sum+d.weight,0);
 const currentDone=due.filter(d=>d.status==="Completed").reduce((sum,d)=>sum+d.weight,0);
 const proposedTotal=due.reduce((sum,d)=>sum+(next.get(d.definitionId)??d.weight),0);
 const proposedDone=due.filter(d=>d.status==="Completed").reduce((sum,d)=>sum+(next.get(d.definitionId)??d.weight),0);
 const apply=async()=>{
  if(!confirm||saving||busy||!changes.length)return;
  setConfirm(false);setSaving(true);setFeedback("");
  let ok=false;try{ok=await onCommand({type:"rebalance-habit-weights",changes});}catch{ok=false;}finally{setSaving(false);}
  if(ok){setCustom({});setFeedback("تم حفظ الأوزان في الحساب، دون تعديل تاريخ الإنجازات.");}
  else setFeedback("تعذر تأكيد الحفظ. حدّث الصفحة وراجع الأوزان قبل إعادة المحاولة.");
 };
 return <section data-testid="noor-habit-weight-manager-r251" style={{display:"grid",gap:12}}>
  <div className="np-cc-title"><div><h2>أوزان العادات</h2><p>الإنجاز الحقيقي حسب الأهمية، وليس عدد علامات الصح.</p></div></div>
  <details data-testid="r334-prayer-weight-audit" style={{border:"1px solid var(--border)",borderRadius:12,padding:10}}>
   <summary>مراجعة أوزان الصلوات قبل الربط</summary>
   <p className="np-cc-help">معاينة من أوزان حسابك الحالية فقط. لا تحفظ أي تغيير ولا تُفعّل احتساب الصلاة.</p>
   <p>أعلى وزن محفوظ للعادات والمهام النشطة أو الموقوفة مؤقتًا: <strong>{prayerAudit.highestConfiguredWeight}</strong></p>
   <p>أعلى وزن خارج عادات الصلاة المحتملة: <strong>{prayerAudit.highestOtherWeight}</strong></p>
   <p className="np-cc-help">هذه المطابقات بالاسم للمراجعة فقط، ولا تُستبعد من الحساب تلقائيًا.</p>
   {prayerAudit.candidates.length?<div style={{display:"grid",gap:4}}>{prayerAudit.candidates.map(d=><div key={d.id} style={{display:"flex",justifyContent:"space-between",gap:8}}><span>{d.title}</span><strong>{d.weight}</strong></div>)}</div>:<p>لم تُكتشف مطابقة صريحة بأسماء الصلوات؛ يلزم مراجعة العادات الأخرى عند اعتماد الربط.</p>}
  </details>
  <p className="np-cc-help">الاقتراح: الصلوات الخمس 25 لكل صلاة، القرآن 12، الأذكار 10، ثم الأساسيات والصحة والتعلم. راجع كل وزن ويمكنك تعديله قبل الحفظ.</p>
  <div style={{display:"flex",flexWrap:"wrap",gap:12,padding:12,borderRadius:12,background:"var(--panel-soft)",border:"1px solid var(--border)"}}>
   <strong>إنجاز العادات الحالي: {percent(currentDone,currentTotal)}٪</strong><strong>بعد التطبيق: {percent(proposedDone,proposedTotal)}٪</strong>
   <small style={{flexBasis:"100%",color:"var(--muted)"}}>تخص المعاينة العادات المستحقة اليوم؛ نسبة اليوم الكاملة تضم المهام أيضًا.</small>
  </div>
  <div style={{display:"grid",gap:7}}>{rows.map(d=><label key={d.id} style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:12,padding:10,border:"1px solid var(--border)",borderRadius:12}}>
   <span style={{minWidth:0}}><strong>{d.title}</strong><small style={{display:"block",color:"var(--muted)"}}>{d.category} · الوزن الحالي: {d.weight}</small></span>
   <input className="np-input" aria-label={`وزن ${d.title}`} style={{width:78,flexShrink:0,textAlign:"center"}} type="number" min="1" max="100" step="1" value={d.recommended} disabled={busy||saving} onChange={e=>{const n=Number(e.currentTarget.value);if(!Number.isInteger(n))return;setCustom(old=>({...old,[d.id]:Math.min(100,Math.max(1,n))}));setConfirm(false);setFeedback("");}}/>
  </label>)}</div>
  {!habits.length?<p className="np-empty">لا توجد عادات نشطة أو متوقفة مؤقتًا لتوزيع أوزانها.</p>:null}
  <p className="np-cc-help">سيُعدّل وزن {changes.length} عادة. التعديل يخص اليوم والأيام المقبلة فقط، ولا يغيّر أي يوم سابق.</p>
  {feedback?<p role="status">{feedback}</p>:null}
  {!confirm?<button className="np-cc-button primary" type="button" disabled={busy||saving||!changes.length} onClick={()=>setConfirm(true)}>مراجعة واعتماد الأوزان</button>
  :<div className="np-cc-confirm"><p>تأكيد تحديث أوزان {changes.length} عادة دفعة واحدة؟</p><button className="np-cc-button primary" type="button" disabled={busy||saving} onClick={()=>{void apply();}}>تأكيد حفظ الأوزان</button><button className="np-cc-button" type="button" onClick={()=>setConfirm(false)}>إلغاء</button></div>}
 </section>;
}
