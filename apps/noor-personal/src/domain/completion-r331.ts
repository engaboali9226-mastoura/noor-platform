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
