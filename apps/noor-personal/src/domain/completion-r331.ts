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
