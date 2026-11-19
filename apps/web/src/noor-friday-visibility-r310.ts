import {r232LocalWeekday,r283FridayHoursAtDhuhr} from "./noor-islamic-daylight-r232.js";
import type {UpcomingFridaySchedule} from "./noor-friday-story-r370.js";

/** R310: Thursday's reminder is activated by the authenticated, current-day
 * Asr time. Friday timers are computed separately using Friday prayer data.
 * Do not infer tomorrow's prayer times from Thursday's schedule.
 */
export type NoorFridayPresentationR310="hidden"|"thursday-reminder"|"friday";
type Prayer=Readonly<{key:string;at:string}>;
const civilDate=(ms:number,timeZone:string):string=>new Intl.DateTimeFormat("en-CA",{
 year:"numeric",month:"2-digit",day:"2-digit",timeZone,
}).format(new Date(ms));
export function noorFridayPresentationR310(nowMs:number,timeZone:string,prayers:readonly Prayer[]):NoorFridayPresentationR310{
 if(!Number.isFinite(nowMs))return "hidden";
 const weekday=r232LocalWeekday(nowMs,timeZone);
 if(weekday===5)return "friday";
 if(weekday!==4)return "hidden";
 const asrAt=prayers.find(p=>p.key==="asr")?.at;
 if(!asrAt)return "hidden";
 const asrMs=Date.parse(asrAt);
 if(!Number.isFinite(asrMs)||asrMs>nowMs||r232LocalWeekday(asrMs,timeZone)!==4)return "hidden";
 // A previous Thursday's cached prayer time must never unlock this week.
 return civilDate(nowMs,timeZone)===civilDate(asrMs,timeZone)?"thursday-reminder":"hidden";
}

export function noorFridayDisplay(input:Readonly<{
 nowMs:number;timeZone:string;prayers:readonly Prayer[];
 sunriseOffsetMinutes:number;upcomingFriday?:UpcomingFridaySchedule|null|undefined;
}>){
 const {nowMs,timeZone,prayers,upcomingFriday}=input;
 const mode=noorFridayPresentationR310(nowMs,timeZone,prayers);
 const currentHours=mode==="friday"?r283FridayHoursAtDhuhr(input):null;
 if(mode==="hidden"||currentHours||!upcomingFriday)return {mode,hours:currentHours,city:undefined};

 const formatter=new Intl.DateTimeFormat("en-CA-u-ca-gregory-nu-latn",{
   timeZone,year:"numeric",month:"2-digit",day:"2-digit",
 });
 const dateKey=(at:number,offset=0)=>{
   const parts=formatter.formatToParts(at);
   const part=(type:"year"|"month"|"day")=>Number(parts.find(p=>p.type===type)?.value);
   return new Date(Date.UTC(part("year"),part("month")-1,part("day")+offset)).toISOString().slice(0,10);
 };
 const sunrise=Date.parse(upcomingFriday.sunrise);
 const fridayDate=dateKey(nowMs,mode==="thursday-reminder"?1:0);
 if(upcomingFriday.localDate!==fridayDate||!Number.isFinite(sunrise)||dateKey(sunrise)!==fridayDate){
   return {mode,hours:null,city:undefined};
 }
 // The prefetched Friday schedule bridges civil midnight while Today refreshes.
 return {mode,city:upcomingFriday.city,hours:r283FridayHoursAtDhuhr({
   nowMs:sunrise,
   timeZone,
   prayers:[{key:"sunrise",at:upcomingFriday.sunrise},{key:"dhuhr",at:upcomingFriday.dhuhr}],
   sunriseOffsetMinutes:input.sunriseOffsetMinutes,
 })};
}
