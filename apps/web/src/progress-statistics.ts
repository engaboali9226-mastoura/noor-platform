import {R331_PRAYERS,type PrayerKeyR331,type PrayerDayScoreR334} from "../../noor-personal/src/domain/completion-r331.js";
export type StatisticRow=Readonly<{id:string;definitionId:string;title:string;kind:'Habit'|'Task';date:string;weight:number;status:string;amount:number;unit:string;credit?:number;nonAchievement?:boolean;recoveryBonus?:boolean;completionDate?:string;recoveredWeight?:number;sessionWeight?:number}>;
export type WeightedStatisticRow=StatisticRow|Readonly<Omit<StatisticRow,'kind'>&{kind:'Prayer';prayerKey:PrayerKeyR331}>;
export type PrayerStatisticDayR334=Readonly<{date:string;score:PrayerDayScoreR334}>;
export function validStatisticDate(value:unknown):value is string{return typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(value+'T00:00:00Z'))&&new Date(value+'T00:00:00Z').toISOString().slice(0,10)===value;}
export function parseStatisticRows(value:unknown):StatisticRow[]{if(!Array.isArray(value))return [];return value.flatMap(r=>{if(!r||typeof r!=='object'||typeof r.id!=='string'||typeof r.definitionId!=='string'||typeof r.title!=='string'||!['Habit','Task'].includes(r.kind)||!validStatisticDate(r.date)||typeof r.weight!=='number'||!Number.isFinite(r.weight)||r.weight<=0||typeof r.status!=='string'||typeof r.amount!=='number'||!Number.isFinite(r.amount)||r.amount<0||typeof r.unit!=='string'||('credit' in r&&(!Number.isFinite(r.credit)||r.credit<0||r.credit>1))||('nonAchievement' in r&&typeof r.nonAchievement!=='boolean')||('recoveryBonus' in r&&typeof r.recoveryBonus!=='boolean')||('completionDate' in r&&!validStatisticDate(r.completionDate))||('sessionWeight' in r&&(!Number.isFinite(r.sessionWeight)||r.sessionWeight<=0||r.sessionWeight>r.weight))||('recoveredWeight' in r&&(!Number.isFinite(r.recoveredWeight)||r.recoveredWeight<0||r.recoveredWeight>r.weight)))return [];return [r as StatisticRow];});}
export const statisticEligible=(r:WeightedStatisticRow)=>!r.nonAchievement&&r.status!=='Suppressed'&&r.status!=='Cancelled';
/** Explicit credit is the fraction earned from the row’s scheduled weight.
 * Legacy rows lacking a credit field retain historical all-or-nothing behavior.
 * R380 projects dated recovery credit on the original scheduled day.
 * Legacy recoveryBonus rows remain readable during version transitions. */
export function statisticEarnedShareR285(r:WeightedStatisticRow):number{
 return r.credit===undefined?(r.status==='Completed'?1:0):r.credit;
}
export function summarizeProgress(rows:readonly WeightedStatisticRow[]){
 const due=rows.filter(statisticEligible),scheduled=due.filter(row=>!row.recoveryBonus);
 const scheduledDates=new Set(scheduled.map(row=>row.date));
 const weight=due.reduce((n,row)=>n+(!row.recoveryBonus||!scheduledDates.has(row.date)?row.weight:0),0);
 const completedWeight=due.reduce((n,row)=>n+row.weight*statisticEarnedShareR285(row),0);
 return {scheduled:scheduled.length,completed:scheduled.filter(row=>row.status==="Completed").length,weight,completedWeight,
  rate:weight?Math.min(100,Math.round(completedWeight/weight*100)):null};
}
export function shiftStatisticDate(date:string,days:number){return new Date(Date.parse(date+'T00:00:00Z')+days*86400000).toISOString().slice(0,10);}
export function shiftStatisticMonth(date:string,months:number){const d=new Date(date+'T00:00:00Z'),day=d.getUTCDate();d.setUTCDate(1);d.setUTCMonth(d.getUTCMonth()+months);const end=new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth()+1,0)).getUTCDate();d.setUTCDate(Math.min(day,end));return d.toISOString().slice(0,10);}
export function statisticPeriods(rows:readonly WeightedStatisticRow[],currentDate:string|null){if(!validStatisticDate(currentDate))return [];const first=rows.filter(r=>statisticEligible(r)&&r.date<=currentDate).map(r=>r.date).sort()[0];if(!first)return [];return ([['week','الأسبوع',0],['month','الشهر',1],['quarter','ربع السنة',3],['half','نصف السنة',6]] as const).map(([key,label,months])=>{const unlockDate=months?shiftStatisticMonth(first,months):shiftStatisticDate(first,7),start=months?shiftStatisticMonth(currentDate,-months):shiftStatisticDate(currentDate,-7),end=shiftStatisticDate(currentDate,-1),periodRows=rows.filter(r=>r.date>=start&&r.date<=end);return {key,label,start,end,unlockDate,ready:currentDate>=unlockDate,rows:periodRows,...summarizeProgress(periodRows)};});}
export function statisticDays(rows:readonly WeightedStatisticRow[],currentDate:string|null,limit=14,startDate?:string){if(!validStatisticDate(currentDate))return [];const eligible=rows.filter(r=>statisticEligible(r)&&r.date<=currentDate),first=validStatisticDate(startDate)?startDate:eligible.map(r=>r.date).sort()[0];if(!first)return [];const start=[first,shiftStatisticDate(currentDate,-Math.max(0,limit-1))].sort().at(-1)!;const result=[];for(let date=start;date<=currentDate;date=shiftStatisticDate(date,1)){const items=eligible.filter(r=>r.date===date);result.push({date,...summarizeProgress(items),amount:items.reduce((n,r)=>n+r.amount,0)});}return result;}

export function statisticInsights(rows:readonly WeightedStatisticRow[],currentDate:string|null){
 if(!validStatisticDate(currentDate))return {current:0,best:0,perfect:0,change:null as number|null};
 const grouped=new Map<string,WeightedStatisticRow[]>();for(const r of rows)if(statisticEligible(r)&&!r.recoveryBonus&&r.date<=currentDate)grouped.set(r.date,[...(grouped.get(r.date)??[]),r]);
 let current=0,best=0,perfect=0;for(const [date,items]of [...grouped].sort(([a],[b])=>a.localeCompare(b))){if(items.every(r=>r.status==='Completed')){current++;perfect++;best=Math.max(best,current);}else if(date!==currentDate)current=0;}
 const first=[...grouped.keys()].sort()[0],end=shiftStatisticDate(currentDate,-1),start=shiftStatisticDate(currentDate,-7),previous=shiftStatisticDate(currentDate,-14);
 const recent=summarizeProgress(rows.filter(r=>r.date>=start&&r.date<=end)),prior=summarizeProgress(rows.filter(r=>r.date>=previous&&r.date<start));
 return {current,best,perfect,change:first&&first<=previous&&recent.rate!==null&&prior.rate!==null?recent.rate-prior.rate:null};
}
export function statisticCalendar(rows:readonly WeightedStatisticRow[],month:string,currentDate:string|null){
 if(!/^\d{4}-\d{2}$/.test(month)||!validStatisticDate(month+'-01')||!validStatisticDate(currentDate))return {offset:0,days:[] as {date:string;rate:number|null;scheduled:number;future:boolean}[]};
 const first=new Date(month+'-01T00:00:00Z'),offset=(first.getUTCDay()+1)%7,count=new Date(Date.UTC(first.getUTCFullYear(),first.getUTCMonth()+1,0)).getUTCDate();
 return {offset,days:Array.from({length:count},(_,i)=>{const date=month+'-'+String(i+1).padStart(2,'0'),summary=summarizeProgress(rows.filter(r=>r.date===date));return {date,rate:summary.rate,scheduled:summary.scheduled,future:date>currentDate};})};
}

export function wholeWeekAchievement(rows:readonly WeightedStatisticRow[],currentDate:string|null,liveToday?:readonly WeightedStatisticRow[]){
 if(!validStatisticDate(currentDate))return [];
 const offset=(new Date(currentDate+'T00:00:00Z').getUTCDay()+1)%7,start=shiftStatisticDate(currentDate,-offset);
 return Array.from({length:7},(_,index)=>{const date=shiftStatisticDate(start,index),future=date>currentDate,current=date===currentDate,items=future?[]:current&&liveToday!==undefined?liveToday:rows.filter(r=>r.date===date);return {date,future,current,...summarizeProgress(items)};});
}
export function yesterdayAchievement(rows:readonly WeightedStatisticRow[],currentDate:string|null){
 if(!validStatisticDate(currentDate))return null;
 const date=shiftStatisticDate(currentDate,-1),items=rows.filter(r=>r.date===date&&statisticEligible(r)),missed=items.filter(r=>r.status!=='Completed');
 return {date,missed,missedWeight:missed.reduce((n,r)=>n+r.weight,0),...summarizeProgress(items)};
}

/** R332: use only the displayed civil week. Prayer recording is not a score or a
 * claim of actual attendance; keep it separate from weighted task/habit credit. */
export function weeklyCardSummaryR332(rows:readonly WeightedStatisticRow[],days:readonly {date:string;future:boolean}[],history:readonly {date:string;records:readonly {key:string}[]}[],prayerDays:readonly PrayerStatisticDayR334[]=[],completedPrayerHabits:readonly {date:string;key:PrayerKeyR331}[]=[],todayDue?:Readonly<{date:string;keys:readonly PrayerKeyR331[]}>){
 const elapsed=days.filter(d=>!d.future),dates=new Set(elapsed.map(d=>d.date)),keys=new Set(["fajr","dhuhr","asr","maghrib","isha"]);
 const weekRows=rows.filter(r=>dates.has(r.date));
 const recordedByDate=new Map<string,Set<string>>();
 const dueToday=new Set<string>(todayDue?.keys.filter(key=>keys.has(key))??[]);
 const record=(date:string,key:string)=>{
  if(!dates.has(date)||!keys.has(key)||(date===todayDue?.date&&!dueToday.has(key)))return;
  const recorded=recordedByDate.get(date)??new Set<string>();
  recorded.add(key);
  recordedByDate.set(date,recorded);
 };
 for(const day of history)for(const prayer of day.records)record(day.date,prayer.key);
 for(const prayer of completedPrayerHabits)record(prayer.date,prayer.key);
 for(const day of prayerDays)for(const prayer of day.score.rows)if(prayer.recorded)record(day.date,prayer.key);
 // The target counts five prayers per calendar day through today. The
 // verified times above only determine which current-day records count.
 const due=dates.size*keys.size;
 const recorded=[...recordedByDate.values()].reduce((sum,prayers)=>sum+prayers.size,0);
 const first=days[0]?.date;
 // Keep the existing Saturday–Friday date boundaries. Week label uses the ISO
 // week number of the start date rather than shifting the stored week.
 let weekNumber:number|null=null;
 if(validStatisticDate(first)){const d=new Date(first+"T00:00:00Z");d.setUTCDate(d.getUTCDate()+4-(d.getUTCDay()||7));const jan=new Date(Date.UTC(d.getUTCFullYear(),0,1));weekNumber=Math.ceil(((d.getTime()-jan.getTime())/86400000+1)/7);}
 return {weekNumber,tasks:summarizeProgress(weekRows.filter(r=>r.kind==="Task")),habits:summarizeProgress(weekRows.filter(r=>r.kind==="Habit")),prayers:{recorded,due}};
}

// The server sends a separate, already authorized projection; never read prayer
// entries as mutable execution IDs or infer legacy mappings from display names.
export function parsePrayerStatisticDaysR334(value:unknown):PrayerStatisticDayR334[]{
 if(!Array.isArray(value))return [];
 const result:PrayerStatisticDayR334[]=[];
 const dates=new Set<string>();
 for(const item of value){
  if(!item||typeof item!=="object"||!validStatisticDate(item.date)||dates.has(item.date)||!item.score||typeof item.score!=="object")return [];
  const s=item.score;
  if(!Array.isArray(s.rows)||!Array.isArray(s.excludedHabitDefinitionIds)||s.excludedHabitDefinitionIds.some((id:unknown)=>typeof id!=="string"||!id.trim())||new Set(s.excludedHabitDefinitionIds).size!==s.excludedHabitDefinitionIds.length)return [];
  const keys=new Set<string>();
  for(const r of s.rows){
   if(!r||!R331_PRAYERS.includes(r.key)||keys.has(r.key)||!Number.isSafeInteger(r.weight)||r.weight<=0||typeof r.credit!=="number"||!Number.isFinite(r.credit)||r.credit<0||r.credit>1||typeof r.recorded!=="boolean"||(!r.recorded&&r.credit!==0))return [];
   keys.add(r.key);
  }
  const weight=s.rows.reduce((n:number,r:{weight:number})=>n+r.weight,0),earnedWeight=s.rows.reduce((n:number,r:{weight:number;credit:number})=>n+r.weight*r.credit,0);
  if(!Number.isFinite(weight)||!Number.isFinite(earnedWeight)||s.weight!==weight||Math.abs(s.earnedWeight-earnedWeight)>1e-8||typeof s.earnedWeight!=="number"||!Number.isFinite(s.earnedWeight))return [];
  dates.add(item.date);
  result.push({date:item.date,score:{rows:s.rows,excludedHabitDefinitionIds:s.excludedHabitDefinitionIds,weight,earnedWeight}});
 }
 return result;
}
const PRAYER_LABELS_R334:Record<PrayerKeyR331,string>={fajr:"الفجر",dhuhr:"الظهر",asr:"العصر",maghrib:"المغرب",isha:"العشاء"};
export function weightedStatisticRowsR334(rows:readonly StatisticRow[],prayers:readonly PrayerStatisticDayR334[],currentDate:string|null):WeightedStatisticRow[]{
 if(!validStatisticDate(currentDate))return [...rows];
 const byDate=new Map(prayers.filter(p=>p.date<=currentDate).map(p=>[p.date,p.score]));
 const ordinary=rows.filter(r=>r.kind!=="Habit"||!byDate.get(r.date)?.excludedHabitDefinitionIds.includes(r.definitionId));
 const prayerRows:WeightedStatisticRow[]=[];
 for(const [date,score] of byDate)for(const p of score.rows)prayerRows.push({id:"r334:prayer:"+date+":"+p.key,definitionId:"r334:prayer:"+p.key,title:"صلاة "+PRAYER_LABELS_R334[p.key],kind:"Prayer",prayerKey:p.key,date,weight:p.weight,status:p.recorded?"Completed":date===currentDate?"Pending":"Missed",amount:0,unit:"",credit:p.credit});
 return [...ordinary,...prayerRows];
}
