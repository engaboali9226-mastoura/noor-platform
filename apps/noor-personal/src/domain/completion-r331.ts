// R331: deterministic civil-date credit; no browser clock or adjustable weights.
function recoveryDays(due:string,performed:string):number {
 const valid=(s:string)=>/^\d{4}-\d{2}-\d{2}$/.test(s)&&Number.isFinite(Date.parse(s+"T00:00:00Z"))&&new Date(s+"T00:00:00Z").toISOString().slice(0,10)===s;
 if(!valid(due)||!valid(performed))return -1;
 return (Date.parse(performed+"T00:00:00Z")-Date.parse(due+"T00:00:00Z"))/86400000;
}
export function recoveryCreditR331(due:string,performed:string):number {
 const days=recoveryDays(due,performed);
 return days<0?0:2**(-days);
}
/** Explicit completion-date records use the agreed linear deduction. */
export function recoveryCreditR367(due:string,performed:string):number {
 const days=recoveryDays(due,performed);
 return days<0?0:Math.max(30,100-30*days)/100;
}
export const R331_PRAYERS=["fajr","dhuhr","asr","maghrib","isha"] as const;
export type PrayerKeyR331=typeof R331_PRAYERS[number];
export function prayerHabitCandidateR334(raw:string):PrayerKeyR331|null{
 const title=raw.normalize("NFKC").toLocaleLowerCase("ar").replace(/[\u064b-\u065f\u0670\u0640]/g,"").replace(/[أإآٱ]/g,"ا").replace(/ى/g,"ي").replace(/ة/g,"ه").replace(/^\s*[0-9٠-٩۰-۹]+\s*[-–—.]\s*/u,"").trim();
 const match=title.match(/^(?:(?:صلاه|فرض)\s+)?(?:ال)?(فجر|ظهر|عصر|مغرب|عشاء)$/u);
 if(match)return ({"فجر":"fajr","ظهر":"dhuhr","عصر":"asr","مغرب":"maghrib","عشاء":"isha"} as const)[match[1] as "فجر"|"ظهر"|"عصر"|"مغرب"|"عشاء"];
 const english=title.match(/^(fajr|dhuhr|zuhr|asr|maghrib|isha)(?: prayer)?$/iu)?.[1];
 return english?(english==="zuhr"?"dhuhr":english as PrayerKeyR331):null;
}
export type PrayerModeR331="group"|"excused"|"unexcused";
export type PrayerTimingR331="ontime"|"late";
export type PrayerRecordR331=Readonly<{key:PrayerKeyR331;mode:PrayerModeR331;timing:PrayerTimingR331;recordedAt:string}>;
export function validPrayerRecordR331(value:unknown):value is PrayerRecordR331{
 if(!value||typeof value!=="object")return false;
 const r=value as Record<string,unknown>;
 return R331_PRAYERS.includes(r.key as PrayerKeyR331)&&["group","excused","unexcused"].includes(String(r.mode))&&["ontime","late"].includes(String(r.timing))&&typeof r.recordedAt==="string"&&Number.isFinite(Date.parse(r.recordedAt));
}
export function completedShareR331(e:{status:string;scheduleOccurrenceKey:string;recoveredOnR331?:string;completionDateR367?:string}):number{
 if(e.status!=="Completed")return 0;
 if(e.completionDateR367)return recoveryCreditR367(e.scheduleOccurrenceKey,e.completionDateR367);
 return e.recoveredOnR331===undefined?1:recoveryCreditR331(e.scheduleOccurrenceKey,e.recoveredOnR331);
}

// R334 preparation: pure scoring only. No default coefficients, activation date,
// storage mutation or runtime wiring until the policy and legacy mappings are approved.
export type PrayerScoreSnapshotR334=Readonly<{
 policyId:string;
 effectiveFromDate:string;
 weights:Readonly<Record<PrayerKeyR331,number>>;
 shares:Readonly<Record<PrayerModeR331,Readonly<Record<PrayerTimingR331,number>>>>;
 legacyHabitKeys:Readonly<Record<string,PrayerKeyR331>>;
}>;
export type PrayerDayScoreR334=Readonly<{
 rows:readonly Readonly<{key:PrayerKeyR331;weight:number;credit:number;recorded:boolean}>[];
 excludedHabitDefinitionIds:readonly string[];
 weight:number;
 earnedWeight:number;
}>;
const validCivilR334=(s:string)=>/^\d{4}-\d{2}-\d{2}$/.test(s)&&Number.isFinite(Date.parse(s+"T00:00:00Z"))&&new Date(s+"T00:00:00Z").toISOString().slice(0,10)===s;
export function prayerDayScoreR334(input:Readonly<{
 date:string;
 currentDate:string;
 /** Authoritative due keys for this date, as of the evaluation instant.
  * null means the day has no trusted prayer context; do not invent obligations. */
 dueKeys:readonly PrayerKeyR331[]|null;
 records:readonly PrayerRecordR331[];
 /** Explicit, immutable day snapshot. null means unapproved/unavailable. */
 snapshot:PrayerScoreSnapshotR334|null;
}>):PrayerDayScoreR334|null{
 const {date,currentDate,dueKeys,records,snapshot}=input;
 if(!validPrayerScoreSnapshotR334(snapshot)||!validCivilR334(date)||!validCivilR334(currentDate)||!validCivilR334(snapshot.effectiveFromDate)||date<snapshot.effectiveFromDate||date>currentDate||dueKeys===null)return null;
 if(!R331_PRAYERS.every(k=>Number.isFinite(snapshot.weights[k])&&snapshot.weights[k]>0))return null;
 for(const mode of ["group","excused","unexcused"] as const)for(const timing of ["ontime","late"] as const){
  const share=snapshot.shares[mode]?.[timing];
  if(!Number.isFinite(share)||share<0||share>1)return null;
 }
 const aliases=Object.entries(snapshot.legacyHabitKeys);
 if(aliases.some(([id,key])=>!id.trim()||!R331_PRAYERS.includes(key)))return null;
 if(dueKeys.some(k=>!R331_PRAYERS.includes(k)))return null;
 const due=new Set(dueKeys);
 const byKey=new Map<PrayerKeyR331,PrayerRecordR331>();
 for(const record of records){
  if(!validPrayerRecordR331(record)||byKey.has(record.key)||!due.has(record.key))return null;
  byKey.set(record.key,record);
 }
 const rows=R331_PRAYERS.filter(key=>due.has(key)).map(key=>{
  const record=byKey.get(key);
  return {key,weight:snapshot.weights[key],credit:record?snapshot.shares[record.mode][record.timing]:0,recorded:!!record};
 });
 const weight=rows.reduce((n,r)=>n+r.weight,0),earnedWeight=rows.reduce((n,r)=>n+r.weight*r.credit,0);
 if(!Number.isFinite(weight)||!Number.isFinite(earnedWeight))return null;
 return {rows,excludedHabitDefinitionIds:aliases.map(([id])=>id),weight,earnedWeight};
}

// Compose the prayer projection with existing *eligible*, already frozen rows.
// The caller owns eligibility and session credit; never recompute or mutate those.
export function combinePrayerAchievementR334(
 rows:readonly Readonly<{definitionId:string;kind:"Habit"|"Task";weight:number;credit:number}>[],
 prayer:PrayerDayScoreR334|null,
):Readonly<{weight:number;earnedWeight:number;rate:number|null}>|null{
 const excluded=new Set(prayer?.excludedHabitDefinitionIds??[]);
 const ordinary=rows.filter(r=>r.kind!=="Habit"||!excluded.has(r.definitionId));
 if(ordinary.some(r=>!Number.isFinite(r.weight)||r.weight<=0||!Number.isFinite(r.credit)||r.credit<0||r.credit>1))return null;
 const weight=ordinary.reduce((n,r)=>n+r.weight,prayer?.weight??0);
 const earnedWeight=ordinary.reduce((n,r)=>n+r.weight*r.credit,prayer?.earnedWeight??0);
 if(!Number.isFinite(weight)||!Number.isFinite(earnedWeight)||earnedWeight<0||earnedWeight>weight)return null;
 return {weight,earnedWeight,rate:weight?Math.round(earnedWeight/weight*100):null};
}

// Trusted server context, never a browser-supplied list of already-started prayers.
export function prayerDueKeysFromContextR334(input:Readonly<{
 day:Readonly<{id:string;boundary:Readonly<{localDate:string;startAt:string;endAt:string}>}>;
 context:Readonly<{personalDayId:string;prayerTimes:Readonly<Record<PrayerKeyR331,string>&{localDate:string}>}>|null;
 evaluatedAt:string;
}>):readonly PrayerKeyR331[]|null{
 const {day,context,evaluatedAt}=input;
 const start=Date.parse(day.boundary.startAt),end=Date.parse(day.boundary.endAt),now=Date.parse(evaluatedAt);
 if(!context||context.personalDayId!==day.id||context.prayerTimes.localDate!==day.boundary.localDate||!validCivilR334(day.boundary.localDate)||!Number.isFinite(start)||!Number.isFinite(end)||!Number.isFinite(now)||start>=end||now<start)return null;
 let previous=start-1;
 const due:PrayerKeyR331[]=[];
 for(const key of R331_PRAYERS){
  const at=Date.parse(context.prayerTimes[key]);
  if(!Number.isFinite(at)||at<=previous||at<start||at>=end)return null;
  previous=at;
  if(at<=now)due.push(key);
 }
 return due;
}
export function prayerScoreFromTrustedDayR334(input:Readonly<{
 userId:string;
 day:Readonly<{id:string;userId:string;boundary:Readonly<{localDate:string;startAt:string;endAt:string}>;prayerRecordsR331?:readonly PrayerRecordR331[]}>;
 context:Parameters<typeof prayerDueKeysFromContextR334>[0]["context"];
 currentDate:string;
 evaluatedAt:string;
 snapshot:PrayerScoreSnapshotR334|null;
}>):PrayerDayScoreR334|null{
 if(input.userId!==input.day.userId)return null;
 const records=input.day.prayerRecordsR331??[];
 if(records.some(record=>!validPrayerRecordR331(record)||Date.parse(record.recordedAt)>Date.parse(input.evaluatedAt)||!input.context||Date.parse(record.recordedAt)<Date.parse(input.context.prayerTimes[record.key])))return null;
 return prayerDayScoreR334({date:input.day.boundary.localDate,currentDate:input.currentDate,dueKeys:prayerDueKeysFromContextR334(input),records,snapshot:input.snapshot});
}

// Unified daily/range projection. Sum raw weighted totals, never rounded daily rates.
// Supplied ordinary rows have already passed the existing eligibility rules.
// A missing prayer projection preserves legacy achievement rather than fabricating
// past obligations or excluding existing habits.
export type PrayerAchievementPeriodDayR334=Readonly<{
 date:string;
 ordinary:Parameters<typeof combinePrayerAchievementR334>[0];
 prayer:PrayerDayScoreR334|null;
}>;
export function projectPrayerAchievementPeriodR334(input:Readonly<{
 startDate:string;
 endDate:string;
 currentDate:string;
 days:readonly PrayerAchievementPeriodDayR334[];
}>):Readonly<{
 days:readonly Readonly<{date:string;weight:number;earnedWeight:number;rate:number|null;prayerApplied:boolean}>[];
 weight:number;
 earnedWeight:number;
 rate:number|null;
}>|null{
 const {startDate,endDate,currentDate}=input;
 if(![startDate,endDate,currentDate].every(validCivilR334)||startDate>endDate)return null;
 const seen=new Set<string>();
 const days:{date:string;weight:number;earnedWeight:number;rate:number|null;prayerApplied:boolean}[]=[];
 for(const day of input.days){
  if(!validCivilR334(day.date)||seen.has(day.date))return null;
  seen.add(day.date);
  if(day.date<startDate||day.date>endDate||day.date>currentDate)continue;
  const totals=combinePrayerAchievementR334(day.ordinary,day.prayer);
  if(!totals)return null;
  days.push({date:day.date,...totals,prayerApplied:day.prayer!==null});
 }
 days.sort((a,b)=>a.date.localeCompare(b.date));
 const weight=days.reduce((n,d)=>n+d.weight,0),earnedWeight=days.reduce((n,d)=>n+d.earnedWeight,0);
 if(!Number.isFinite(weight)||!Number.isFinite(earnedWeight))return null;
 return {days,weight,earnedWeight,rate:weight?Math.round(earnedWeight/weight*100):null};
}

// Stored JSON must never implicitly authorize a new scoring policy.
export function validPrayerScoreSnapshotR334(value:unknown):value is PrayerScoreSnapshotR334{
 if(!value||typeof value!=="object"||Array.isArray(value))return false;
 const v=value as Partial<PrayerScoreSnapshotR334>;
 if(typeof v.policyId!=="string"||!v.policyId.trim()||typeof v.effectiveFromDate!=="string"||!validCivilR334(v.effectiveFromDate)||!v.weights||typeof v.weights!=="object"||!v.shares||typeof v.shares!=="object"||!v.legacyHabitKeys||typeof v.legacyHabitKeys!=="object"||Array.isArray(v.legacyHabitKeys))return false;
 if(!R331_PRAYERS.every(key=>Number.isSafeInteger(v.weights?.[key])&&v.weights![key]>0))return false;
 for(const mode of ["group","excused","unexcused"] as const)for(const timing of ["ontime","late"] as const){
  const share=v.shares[mode]?.[timing];
  if(typeof share!=="number"||!Number.isFinite(share)||share<0||share>1)return false;
 }
 return Object.entries(v.legacyHabitKeys).every(([id,key])=>!!id.trim()&&R331_PRAYERS.includes(key));
}

export type PrayerScoreApprovalR334=Readonly<{
 type:"configure-prayer-score-r334";
 expectedPolicyId:string|null;
 baseWeight:number;
 shares:PrayerScoreSnapshotR334["shares"];
 mappings:readonly Readonly<{definitionId:string;key:PrayerKeyR331}>[];
 confirm:true;
}>;
const plainR334=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==="object"&&!Array.isArray(v);
const exactR334=(v:Record<string,unknown>,keys:readonly string[])=>Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));
const idR334=(v:unknown):v is string=>typeof v==="string"&&v.length>0&&v.length<=200&&v.trim()===v&&!["__proto__","prototype","constructor"].includes(v);
export function parsePrayerScoreApprovalR334(value:unknown):PrayerScoreApprovalR334|null{
 if(!plainR334(value)||!exactR334(value,["type","expectedPolicyId","baseWeight","shares","mappings","confirm"])||value.type!=="configure-prayer-score-r334"||value.confirm!==true||!(value.expectedPolicyId===null||idR334(value.expectedPolicyId))||typeof value.baseWeight!=="number"||!Number.isSafeInteger(value.baseWeight)||value.baseWeight<1||value.baseWeight>1000||!plainR334(value.shares)||!exactR334(value.shares,["group","excused","unexcused"])||!Array.isArray(value.mappings)||value.mappings.length>500)return null;
 const shares=value.shares;
 for(const mode of ["group","excused","unexcused"] as const){
  const m=shares[mode];
  if(!plainR334(m)||!exactR334(m,["ontime","late"]))return null;
  for(const timing of ["ontime","late"] as const)if(typeof m[timing]!=="number"||!Number.isFinite(m[timing])||Number(m[timing])<0||Number(m[timing])>1)return null;
  if(Number(m.late)>Number(m.ontime))return null;
 }
 const approved=shares as PrayerScoreSnapshotR334["shares"];
 if(approved.group.ontime!==1||approved.group.ontime<approved.excused.ontime||approved.excused.ontime<approved.unexcused.ontime||approved.group.late<approved.excused.late||approved.excused.late<approved.unexcused.late)return null;
 const mappings:{definitionId:string;key:PrayerKeyR331}[]=[];
 for(const m of value.mappings){
  if(!plainR334(m)||!exactR334(m,["definitionId","key"])||!idR334(m.definitionId)||!R331_PRAYERS.includes(m.key as PrayerKeyR331)||mappings.some(x=>x.definitionId===m.definitionId))return null;
  mappings.push({definitionId:m.definitionId,key:m.key as PrayerKeyR331});
 }
 return {type:"configure-prayer-score-r334",expectedPolicyId:value.expectedPolicyId,baseWeight:value.baseWeight,shares:structuredClone(approved),mappings,confirm:true};
}
export function issuePrayerScoreSnapshotR334(input:Readonly<{policyId:string;effectiveFromDate:string;approval:PrayerScoreApprovalR334;definitions:readonly Readonly<{id:string;userId:string;kind:string;state:string;weight:number}>[];userId:string}>):PrayerScoreSnapshotR334|null{
 const {approval,definitions,userId}=input;
 if(!parsePrayerScoreApprovalR334(approval)||!validCivilR334(input.effectiveFromDate)||!idR334(input.policyId))return null;
 const owned=definitions.filter(d=>d.userId===userId);
 if(approval.mappings.some(m=>!owned.some(d=>d.id===m.definitionId&&d.kind==="Habit"&&["Active","Paused"].includes(d.state))))return null;
 const aliases=Object.fromEntries(approval.mappings.map(m=>[m.definitionId,m.key])) as Record<string,PrayerKeyR331>;
 if(owned.some(d=>["Active","Paused"].includes(d.state)&&!Object.hasOwn(aliases,d.id)&&(!Number.isFinite(d.weight)||d.weight>=approval.baseWeight)))return null;
 const weights=Object.fromEntries(R331_PRAYERS.map(key=>[key,approval.baseWeight])) as Record<PrayerKeyR331,number>;
 return {policyId:input.policyId,effectiveFromDate:input.effectiveFromDate,weights,shares:structuredClone(approval.shares),legacyHabitKeys:aliases};
}
export function ordinaryWeightPermittedR334(policy:PrayerScoreSnapshotR334|null|undefined,id:string,kind:string,weight:number):boolean{
 return !policy||(kind==="Habit"&&Object.hasOwn(policy.legacyHabitKeys,id))||weight<Math.min(...R331_PRAYERS.map(k=>policy.weights[k]));
}
