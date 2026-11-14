// R331: deterministic civil-date credit; no browser clock or adjustable weights.
export function recoveryCreditR331(due:string,performed:string):number {
 const valid=(s:string)=>/^\d{4}-\d{2}-\d{2}$/.test(s)&&Number.isFinite(Date.parse(s+"T00:00:00Z"))&&new Date(s+"T00:00:00Z").toISOString().slice(0,10)===s;
 if(!valid(due)||!valid(performed))return 0;
 const days=(Date.parse(performed+"T00:00:00Z")-Date.parse(due+"T00:00:00Z"))/86400000;
 return days<0?0:2**(-days);
}
export const R331_PRAYERS=["fajr","dhuhr","asr","maghrib","isha"] as const;
export type PrayerKeyR331=typeof R331_PRAYERS[number];
export type PrayerModeR331="group"|"excused"|"unexcused";
export type PrayerTimingR331="ontime"|"late";
export type PrayerRecordR331=Readonly<{key:PrayerKeyR331;mode:PrayerModeR331;timing:PrayerTimingR331;recordedAt:string}>;
export function validPrayerRecordR331(value:unknown):value is PrayerRecordR331{
 if(!value||typeof value!=="object")return false;
 const r=value as Record<string,unknown>;
 return R331_PRAYERS.includes(r.key as PrayerKeyR331)&&["group","excused","unexcused"].includes(String(r.mode))&&["ontime","late"].includes(String(r.timing))&&typeof r.recordedAt==="string"&&Number.isFinite(Date.parse(r.recordedAt));
}
export function completedShareR331(e:{status:string;scheduleOccurrenceKey:string;recoveredOnR331?:string}):number{
 if(e.status!=="Completed")return 0;
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
 if(!snapshot||!snapshot.policyId.trim()||!validCivilR334(date)||!validCivilR334(currentDate)||!validCivilR334(snapshot.effectiveFromDate)||date<snapshot.effectiveFromDate||date>currentDate||dueKeys===null)return null;
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
