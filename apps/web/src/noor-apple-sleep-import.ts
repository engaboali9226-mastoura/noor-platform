const asleepStages = new Set(["Asleep","AsleepUnspecified","AsleepCore","AsleepDeep","AsleepREM","1","3","4","5"]);
const categoryPrefix = "HKCategoryValueSleepAnalysis";
const minute = 60_000;

function appleInstant(value:string|null):number {
  if(!value||!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2} [+-]\d{4}$/.test(value))return NaN;
  return Date.parse(value.replace(" ","T").replace(/ ([+-]\d{2})(\d{2})$/,"$1:$2"));
}

/** Count elapsed sleep, merging overlapping samples from multiple devices. */
export function appleSleepMinutes(xml:Document,date:string,timeZone:string):number|null {
  if(xml.documentElement?.localName!=="HealthData"||xml.getElementsByTagName("parsererror").length)throw Error("INVALID_HEALTH_EXPORT");
  const intervals:{start:number;end:number}[]=[];
  for(const record of xml.documentElement.children){
    if(record.localName!=="Record"||record.getAttribute("type")!=="HKCategoryTypeIdentifierSleepAnalysis")continue;
    const value=(record.getAttribute("value")??"").replace(categoryPrefix,"");
    if(!asleepStages.has(value))continue;
    const start=appleInstant(record.getAttribute("startDate")),end=appleInstant(record.getAttribute("endDate"));
    if(Number.isFinite(start)&&Number.isFinite(end)&&end>start&&end-start<=24*60*minute)intervals.push({start,end});
  }
  const formatter=new Intl.DateTimeFormat("en-CA",{timeZone,year:"numeric",month:"2-digit",day:"2-digit"});
  const wakeDate=(end:number)=>{
    const parts=formatter.formatToParts(end);
    const part=(type:string)=>parts.find(value=>value.type===type)?.value;
    return `${part("year")}-${part("month")}-${part("day")}`;
  };
  let end=0,sessionMs=0,total=0;
  for(const interval of intervals.sort((a,b)=>a.start-b.start||a.end-b.end)){
    // Nearby stages share one wake date, but awake gaps contribute zero.
    if(end&&interval.start-end>90*minute){
      if(wakeDate(end)===date)total+=sessionMs;
      end=0;sessionMs=0;
    }
    sessionMs+=Math.max(0,interval.end-Math.max(interval.start,end));
    end=Math.max(end,interval.end);
  }
  if(end&&wakeDate(end)===date)total+=sessionMs;
  if(!total)return null;
  const minutes=Math.round(total/minute);
  if(minutes>1440)throw Error("AMBIGUOUS_SLEEP_DURATION");
  return minutes;
}
