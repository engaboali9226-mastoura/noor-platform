import {useEffect,useState} from "react";
export type PublicHistoryEvent=Readonly<{id:string;scope:"islamic"|"world";calendar:"gregorian"|"hijri";year:number;month:number;day:number;title:string;details:string;category:string;rank:number;source:string;sourceUrl:string;articleUrl:string|null;wikidataUrl?:string;license:string;image?:Readonly<{url:string;artist:string;license:string;sourceUrl:string}>}>;
export const HISTORY_HIJRI_MONTHS=["محرم","صفر","ربيع الأول","ربيع الآخر","جمادى الأولى","جمادى الآخرة","رجب","شعبان","رمضان","شوال","ذو القعدة","ذو الحجة"] as const;
const GREGORIAN_MONTHS=["يناير","فبراير","مارس","أبريل","مايو","يونيو","يوليو","أغسطس","سبتمبر","أكتوبر","نوفمبر","ديسمبر"] as const;
type Calendar=PublicHistoryEvent["calendar"];
type DayResult={status:"ok"|"stale"|"unavailable";events:PublicHistoryEvent[]};
type Match={event:PublicHistoryEvent;date:string;offset:number};
const allowed=(value:unknown,host:string):value is string=>{try{return typeof value==="string"&&new URL(value).origin==="https://"+host&&!new URL(value).username&&!new URL(value).password;}catch{return false;}};
const islamicAuthorities:Readonly<Record<string,string>>={"dorar.net":"الدرر السنية","binbaz.org.sa":"ابن باز","binothaimeen.net":"ابن عثيمين","shamela.ws":"المكتبة الشاملة"};
const approvedIslamicSource=(value:unknown,source?:string)=>Object.entries(islamicAuthorities).some(([host,name])=>allowed(value,host)&&(source===undefined||source===name)&&new URL(value as string).pathname!=="/");
export function historyDateLabel(event:PublicHistoryEvent){
 const months=event.calendar==="hijri"?HISTORY_HIJRI_MONTHS:GREGORIAN_MONTHS;
 return event.day+" "+months[event.month-1]+" "+Math.abs(event.year)+" "+(event.calendar==="hijri"?event.year<0?"ق.هـ":"هـ":event.year<0?"ق.م":"م");
}
export function parsePublicHistory(value:unknown,calendar:Calendar,month:number,day:number):DayResult{
 if(!value||typeof value!=="object")return {status:"unavailable",events:[]};
 const v=value as {status?:unknown;events?:unknown};
 if(!["ok","stale","unavailable"].includes(String(v.status))||!Array.isArray(v.events))return {status:"unavailable",events:[]};
 const events=v.events.filter((e):e is PublicHistoryEvent=>!!e&&typeof e==="object"&&typeof e.id==="string"&&e.calendar===calendar&&e.month===month&&e.day===day&&Number.isInteger(e.year)&&e.year!==0&&typeof e.rank==="number"&&["title","details","category","source","license"].every(k=>typeof e[k]==="string")&&((e.scope==="islamic"&&approvedIslamicSource(e.sourceUrl,e.source)&&(e.articleUrl===null||approvedIslamicSource(e.articleUrl))&&e.wikidataUrl===undefined&&e.image===undefined)||(e.scope==="world"&&calendar==="gregorian"&&e.source==="ويكيبيديا العربية"&&allowed(e.sourceUrl,"ar.wikipedia.org")&&(e.articleUrl===null||allowed(e.articleUrl,"ar.wikipedia.org"))&&(e.wikidataUrl===undefined||allowed(e.wikidataUrl,"www.wikidata.org"))&&(e.image===undefined||!!e.image&&allowed(e.image.url,"upload.wikimedia.org")&&allowed(e.image.sourceUrl,"commons.wikimedia.org")&&typeof e.image.artist==="string"&&typeof e.image.license==="string")))).slice(0,12);
 return {status:v.status as DayResult["status"],events};
}
const cache=new Map<string,{at:number;result:DayResult}>();
const shift=(date:string,offset:number)=>new Date(Date.parse(date+"T12:00:00Z")+offset*86400000).toISOString().slice(0,10);
function parts(date:string,calendar:Calendar){
 const p=new Intl.DateTimeFormat("en-GB-u-nu-latn",{calendar:calendar==="hijri"?"islamic-umalqura":"gregory",timeZone:"UTC",month:"numeric",day:"numeric"}).formatToParts(new Date(date+"T12:00:00Z"));
 return {month:Number(p.find(x=>x.type==="month")?.value),day:Number(p.find(x=>x.type==="day")?.value)};
}
export function usePublicHistory(date:string,week:boolean){
 const [state,setState]=useState<{date:string;matches:Match[];loading:boolean;unavailable:boolean}>({date:"",matches:[],loading:true,unavailable:false});
 useEffect(()=>{
  const controller=new AbortController();
  const read=async(calendar:Calendar,month:number,day:number):Promise<DayResult>=>{
   const key=[calendar,month,day].join(":"),old=cache.get(key);
   if(old&&Date.now()-old.at<(old.result.status==="ok"?3600000:300000))return old.result;
   try{
    const params=new URLSearchParams({calendar,month:String(month),day:String(day)});
    const response=await fetch("/api/noor/public-history/day?"+params,{credentials:"omit",signal:controller.signal,cache:"no-store"});
    if(!response.ok)throw Error("history unavailable");
    const result=parsePublicHistory(await response.json(),calendar,month,day);
    if(!controller.signal.aborted)cache.set(key,{at:Date.now(),result});
    return result;
   }catch{return old&&old.result.status!=="unavailable"?{...old.result,status:"stale"}:{status:"unavailable",events:[]};}
  };
  async function load(){
   const matches:Match[]=[];let unavailable=false;
   setState(old=>({date,matches:old.date===date?old.matches:[],loading:true,unavailable:false}));
   for(let offset=0;offset<(week?7:1);offset++){
    if(controller.signal.aborted)return;
    const civil=shift(date,offset);
    const results=await Promise.all((["gregorian","hijri"] as const).map(calendar=>{const {month,day}=parts(civil,calendar);return read(calendar,month,day);}));
    if(controller.signal.aborted)return;
    for(const result of results){unavailable||=result.status!=="ok";matches.push(...result.events.map(event=>({event,date:civil,offset})));}
    matches.sort((a,b)=>a.offset-b.offset||b.event.rank-a.event.rank||a.event.year-b.event.year);
    setState({date,matches:[...matches],loading:offset+1<(week?7:1),unavailable});
   }
  }
  void load();
  return ()=>controller.abort();
 },[date,week]);
 return state.date===date?state:{date,matches:[],loading:true,unavailable:false};
}
