import {useState,type ReactElement} from "react";
import {R331_PRAYERS,parsePrayerScoreApprovalR334,type PrayerScoreSnapshotR334,type PrayerModeR331,type PrayerTimingR331,type PrayerKeyR331} from "../../noor-personal/src/domain/completion-r331.js";
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
const PRAYER_NAMES_R334:Record<PrayerKeyR331,string>={fajr:"الفجر",dhuhr:"الظهر",asr:"العصر",maghrib:"المغرب",isha:"العشاء"};
const MODES_R334=[["group","في جماعة"],["excused","منفردًا بعذر"],["unexcused","منفردًا دون عذر"]] as const;
const TIMINGS_R334=[["ontime","في وقتها"],["late","بعد خروج الوقت"]] as const;
type ShareFieldsR334=Record<PrayerModeR331,Record<PrayerTimingR331,string>>;
export function NoorPrayerScoreApprovalR334({definitions,policy,busy,onCommand}:{
 definitions:readonly HabitWeightDefinition[];policy:PrayerScoreSnapshotR334|null;busy:boolean;
 onCommand:(command:NoorPersonalCommandInput)=>Promise<boolean>;
}):ReactElement{
 const [weight,setWeight]=useState(policy?String(policy.weights.fajr):"");
 const [shares,setShares]=useState<ShareFieldsR334>(()=>({
  group:{ontime:"100",late:policy?String(Math.round(policy.shares.group.late*10000)/100):""},
  excused:{ontime:policy?String(Math.round(policy.shares.excused.ontime*10000)/100):"",late:policy?String(Math.round(policy.shares.excused.late*10000)/100):""},
  unexcused:{ontime:policy?String(Math.round(policy.shares.unexcused.ontime*10000)/100):"",late:policy?String(Math.round(policy.shares.unexcused.late*10000)/100):""}
 }));
 const [choices,setChoices]=useState<Record<string,string>>(()=>({...policy?.legacyHabitKeys}));
 const [confirmed,setConfirmed]=useState(false),[saving,setSaving]=useState(false),[feedback,setFeedback]=useState("");
 const active=definitions.filter(d=>["Active","Paused"].includes(d.state));
 const habits=active.filter(d=>d.kind==="Habit");
 const mappings=habits.flatMap(d=>R331_PRAYERS.includes(choices[d.id] as PrayerKeyR331)?[{definitionId:d.id,key:choices[d.id] as PrayerKeyR331}]:[]);
 const maximum=active.filter(d=>!mappings.some(m=>m.definitionId===d.id)).reduce((n,d)=>Math.max(n,d.weight),0);
 const reviewed=habits.filter(d=>prayerHabitCandidateR334(d.title)).every(d=>choices[d.id]!==undefined&&choices[d.id]!=="");
 const validInput=weight.trim()!==""&&MODES_R334.every(([m])=>TIMINGS_R334.every(([t])=>shares[m][t].trim()!==""));
 const command=validInput?parsePrayerScoreApprovalR334({type:"configure-prayer-score-r334",expectedPolicyId:policy?.policyId??null,baseWeight:Number(weight),shares:{
  group:{ontime:Number(shares.group.ontime)/100,late:Number(shares.group.late)/100},
  excused:{ontime:Number(shares.excused.ontime)/100,late:Number(shares.excused.late)/100},
  unexcused:{ontime:Number(shares.unexcused.ontime)/100,late:Number(shares.unexcused.late)/100}
 },mappings,confirm:true}):null;
 const ready=!!command&&command.baseWeight>maximum&&reviewed&&confirmed;
 const save=async()=>{if(!ready||!command||busy||saving)return;setSaving(true);setFeedback("");try{
  const ok=await onCommand(command);
  setFeedback(ok?"تم اعتماد السياسة لليوم المدني التالي. لا تغيير للأيام السابقة.":"تعذر الاعتماد. حدّث بيانات الحساب وراجع الوزن والربط.");
  if(ok)setConfirmed(false);
 }catch{setFeedback("تعذر الاعتماد. لم تُؤكد الاستجابة.");}finally{setSaving(false);}};
 return <details data-testid="r334-prayer-policy-editor" style={{border:"1px solid var(--border)",borderRadius:12,padding:10}}>
 <summary>اعتماد سياسة إنجاز الصلوات</summary>
 <p className="np-cc-help">{policy?"السياسة المعتمدة، بدءًا من "+policy.effectiveFromDate:"لم تُعتمد سياسة للصلاة في هذا الحساب حتى الآن."} لا تتغير النتائج التاريخية. الدرجات مؤشر تنظيمي وليست حكمًا شرعيًا على الصلاة.</p>
 <div style={{display:"grid",gap:9}}>
 <label className="np-cc-help">وزن كل صلاة (أعلى من {maximum}) <input data-testid="r334-prayer-base-weight" className="np-input" type="number" min={maximum+1} max={1000} step={1} placeholder="حدد الوزن" value={weight} disabled={busy||saving} onChange={e=>{setWeight(e.currentTarget.value);setConfirmed(false);}}/></label>
 <div style={{display:"grid",gridTemplateColumns:"minmax(0,1.1fr) repeat(2,minmax(0,1fr))",gap:6,alignItems:"center"}}><small>طريقة الأداء</small><small>في وقتها %</small><small>بعد الوقت %</small>
 {MODES_R334.flatMap(([mode,label])=>[<span key={mode}>{label}</span>,...TIMINGS_R334.map(([timing,description])=><input key={mode+timing} data-testid={"r334-share-"+mode+"-"+timing} aria-label={label+" "+description+" %"} className="np-input" style={{minWidth:0,width:"100%"}} type="number" min={0} max={100} step={0.01} placeholder="—" value={shares[mode][timing]} readOnly={mode==="group"&&timing==="ontime"} disabled={busy||saving} onChange={e=>{const value=e.currentTarget.value;setShares(old=>({...old,[mode]:{...old[mode],[timing]:value}}));setConfirmed(false);}}/>)])}
 </div>
 <p className="np-cc-help">100% هي الدرجة المرجعية للأداء في جماعة وفي الوقت. أدخل بقية المعاملات بنفسك؛ لا تزيد درجة التأخير عن الأداء في الوقت، ولا تزيد درجة الانفراد دون عذر عن الانفراد بعذر.</p>
 <strong>ربط العادات القديمة</strong><p className="np-cc-help">حدّد العادات التي تمثل الصلاة نفسها فقط. تبقى سجلاتها القديمة محفوظة، ويُستبعد وزنها من الإنجاز الموحد بعد بدء السياسة. المطابقات بالاسم تتطلب اختيارًا صريحًا.</p>
 {habits.map(d=><label key={d.id} style={{display:"grid",gridTemplateColumns:"minmax(0,1fr) minmax(0,1fr)",gap:8,alignItems:"center"}}><span>{d.title} <small>({d.weight})</small>{prayerHabitCandidateR334(d.title)?<small style={{display:"block"}}>مطابقة محتملة — راجعها</small>:null}</span><select data-testid={"r334-prayer-mapping-"+d.id} aria-label={"ربط "+d.title} className="np-select" value={choices[d.id]??""} disabled={busy||saving} onChange={e=>{const value=e.currentTarget.value;setChoices(old=>({...old,[d.id]:value}));setConfirmed(false);}}><option value="">{prayerHabitCandidateR334(d.title)?"اختر صراحة":"غير محدد"}</option><option value="none">ليست الصلاة نفسها</option>{R331_PRAYERS.map(p=><option key={p} value={p}>{PRAYER_NAMES_R334[p]}</option>)}</select></label>)}
 <label style={{display:"flex",gap:8,alignItems:"flex-start"}}><input data-testid="r334-policy-confirm" type="checkbox" checked={confirmed} disabled={busy||saving} onChange={e=>setConfirmed(e.currentTarget.checked)}/><span>راجعت الأوزان والمعاملات والربط، وأوافق على تطبيقها من اليوم التالي فقط.</span></label>
 <button data-testid="r334-policy-save" type="button" className="np-cc-button primary" disabled={!ready||busy||saving} onClick={()=>{void save();}}>{saving?"جارٍ الاعتماد…":"اعتماد سياسة الصلوات"}</button>
 {feedback?<p role="status">{feedback}</p>:null}
 </div></details>;
}
const percent=(a:number,b:number)=>b?Math.round(a/b*100):0;
export function NoorHabitWeightManagerR251({definitions,executions,busy,onCommand,prayerPolicy=null}:{
 prayerPolicy?:PrayerScoreSnapshotR334|null;
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
  <NoorPrayerScoreApprovalR334 key={prayerPolicy?.policyId??"unapproved"} definitions={definitions} policy={prayerPolicy} busy={busy} onCommand={onCommand}/>
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
