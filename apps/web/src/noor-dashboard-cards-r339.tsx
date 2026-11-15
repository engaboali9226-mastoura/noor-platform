import React, {type ReactElement} from "react";
import {NoorR323Icon} from "./noor-r323-icons.js";
import {NoorR232TimeWindows} from "./noor-time-windows-r232.js";
import type {NoorR232Preferences} from "./noor-time-display-preferences-r232.js";
import type {R232FridayHour,R232Window,R283PrecedingNight} from "./noor-islamic-daylight-r232.js";
import {r232Countdown,r232DailyWindows,r283CarriedNightWindow} from "./noor-islamic-daylight-r232.js";
import {fridayVirtueR284} from "./noor-friday-virtues-r284.js";
import {UpcomingCountdownR301,type UpcomingDefinitionR301} from "./noor-upcoming-countdown-r301.js";
import type {ReligiousEventR324} from "./noor-upcoming-events-r324.js";

export type DashboardPrayerR339=Readonly<{key:string;label:string;at:string}>;
export type DashboardNextPrayerR339=Readonly<{key:string;label:string;at:string}>;
export type DashboardHistoricalEventR339=Readonly<{id:string;title:string;dateLabel:string;detail?:string}>;

type CardProps=Readonly<{
 prayers:readonly DashboardPrayerR339[];
 nextPrayer:DashboardNextPrayerR339|null;
 countdownSeconds:number;
 nowMs:number;
 timeZone:string;
 nextFajrAt?:string|null;
 precedingNight?:R283PrecedingNight|null|undefined;
 preferences:NoorR232Preferences;
 onPreferencesChange:(value:NoorR232Preferences)=>void;
 selectedFridayHour?:1|2|3|4|5|null;
 onSelectFridayHour?:(hour:1|2|3|4|5)=>void;
 fridaySelectionBusy?:boolean;
 fridayHours:readonly R232FridayHour[]|null;
 appointmentDefinitions:readonly UpcomingDefinitionR301[];
 religiousEvents?:readonly ReligiousEventR324[];
 onAddAppointment:()=>void;
 boardDate?:string;
 historicalEvents?:readonly DashboardHistoricalEventR339[];
}>;

const PRAYER_KEYS=new Set(["fajr","dhuhr","asr","maghrib","isha"]);
const number=(value:number)=>new Intl.NumberFormat("ar-SA-u-nu-latn").format(value);
const clock=(atMs:number,timeZone:string)=>new Intl.DateTimeFormat("ar-SA-u-nu-latn",{timeZone,hour:"numeric",minute:"2-digit",hour12:true}).format(new Date(atMs));
const formatAt=(at:string,timeZone:string)=>clock(Date.parse(at),timeZone);
const countdown=(seconds:number)=>{
 const safe=Math.max(0,Math.ceil(seconds));
 return [Math.floor(safe/3600),Math.floor(safe%3600/60),safe%60].map(v=>String(v).padStart(2,"0")).join(":");
};
const remaining=(atMs:number,nowMs:number)=>countdown((atMs-nowMs)/1000);
const windowLabel=(interval:R232Window|null,nowMs:number,timeZone:string)=>{
 if(!interval)return null;
 const state=r232Countdown(interval,nowMs);
 if(state.phase==="active")return `جارٍ · ${remaining(interval.endMs,nowMs)}`;
 if(state.phase==="upcoming")return `يبدأ ${clock(interval.startMs,timeZone)}`;
 return "انتهت";
};

function CardHeader({icon,title,detail}:{icon:ReactElement;title:string;detail?:string}):ReactElement{
 return <header className="np-r339-card-head"><span className="np-r339-card-icon" aria-hidden="true">{icon}</span><div><h3>{title}</h3>{detail?<small>{detail}</small>:null}</div></header>;
}

function PrayerCard({prayers,nextPrayer,countdownSeconds,timeZone}:{prayers:readonly DashboardPrayerR339[];nextPrayer:DashboardNextPrayerR339|null;countdownSeconds:number;timeZone:string}):ReactElement{
 const visible=prayers.filter(prayer=>PRAYER_KEYS.has(prayer.key));
 return <section className="np-r339-card np-r339-prayer-card" data-testid="r339-prayer-card" aria-label="مواقيت الصلوات">
  <CardHeader icon={<NoorR323Icon name="mosque"/>} title="الصلوات" detail="المواقيت ومؤقت الصلاة التالية"/>
  {nextPrayer?<div className="np-r339-next-prayer"><strong>{nextPrayer.label}</strong><b dir="ltr" role="timer">{countdown(countdownSeconds)}</b></div>:<p className="np-r339-card-status">لا توجد صلاة تالية مؤكدة الآن.</p>}
  <div className="np-r339-prayer-list" role="list">
   {visible.map(prayer=><a key={prayer.key} href="#noor-r331-prayers" className={prayer.key===nextPrayer?.key?"is-next":""} role="listitem"><span>{prayer.label}</span><time dateTime={prayer.at}>{formatAt(prayer.at,timeZone)}</time></a>)}
  </div>
  <a className="np-r339-card-link" href="#noor-r331-prayers">فتح تسجيل الصلوات ←</a>
 </section>;
}

function DevotionalWindowsCard({prayers,nowMs,timeZone,nextFajrAt,precedingNight,preferences}:{prayers:readonly DashboardPrayerR339[];nowMs:number;timeZone:string;nextFajrAt?:string|null;precedingNight?:R283PrecedingNight|null;preferences:NoorR232Preferences}):ReactElement|null{
 const windows=r232DailyWindows(prayers,nextFajrAt??undefined,preferences.afterSunrise,preferences.beforeDhuhr);
 const carried=r283CarriedNightWindow(nowMs,precedingNight);
 const night=carried??windows.islamicNight;
 const nightEndMs=night?.endMs??NaN;
 const milestones=night?[
  {key:"midnight",label:"منتصف الليل",atMs:night.startMs+night.durationMs/2},
  {key:"last-third",label:"بداية الثلث الأخير",atMs:night.startMs+night.durationMs*2/3},
 ]:[];
 if(!windows.duha&&!night)return null;
 return <section className="np-r339-card np-r339-devotional-card" data-testid="r339-devotional-card" aria-label="النوافذ التعبدية">
  <CardHeader icon={<NoorR323Icon name="layers"/>} title="النوافذ التعبدية" detail="الضحى والليل ومواقيتهما"/>
  <div className="np-r339-window-list">
   {windows.duha?<div className="np-r339-window-row"><span>الضحى</span><strong>{clock(windows.duha.startMs,timeZone)} – {clock(windows.duha.endMs,timeZone)}</strong><small>{windowLabel(windows.duha,nowMs,timeZone)}</small></div>:null}
   {milestones.map(item=><div className="np-r339-window-row" key={item.key}><span>{item.label}</span><strong>{clock(item.atMs,timeZone)}</strong><small>{item.atMs>nowMs?`متبقٍ ${remaining(item.atMs,nowMs)}`:item.key==="last-third"&&nightEndMs>nowMs?`جارٍ حتى ${clock(nightEndMs,timeZone)}`:"بدأ"}</small></div>)}
  </div>
  <small className="np-r339-card-note">تُحسب من المواقيت الموثقة وموقع الحساب.</small>
 </section>;
}

function FridayCard({fridayHours,nowMs,timeZone,selectedFridayHour,selectionBusy,onSelectFridayHour}:{fridayHours:readonly R232FridayHour[]|null;nowMs:number;timeZone:string;selectedFridayHour?:1|2|3|4|5|null;selectionBusy?:boolean;onSelectFridayHour?:(hour:1|2|3|4|5)=>void}):ReactElement{
 return <section className="np-r339-card np-r339-friday-card" data-testid="r339-friday-card" aria-label="التبكير للجمعة">
  <CardHeader icon={<NoorR323Icon name="mosque"/>} title="التبكير للجمعة" detail="الفترات الخمس بالتتابع"/>
  {fridayHours?.length?<div className="np-r339-friday-list" role="list">{fridayHours.map(hour=>{
    const virtue=fridayVirtueR284(hour.number),active=nowMs>=hour.startMs&&nowMs<hour.endMs;
    return <button type="button" key={hour.number} className={`np-r339-friday-row${active?" is-active":""}${selectedFridayHour===hour.number?" is-selected":""}`} role="listitem" disabled={selectionBusy} onClick={()=>onSelectFridayHour?.(hour.number)} aria-pressed={selectedFridayHour===hour.number}>
      <span>{["الأولى","الثانية","الثالثة","الرابعة","الخامسة"][hour.number-1]}</span><small>{virtue.icon} {virtue.description}</small><strong>{active?`متبقٍ ${remaining(hour.endMs,nowMs)}`:`${clock(hour.startMs,timeZone)} – ${clock(hour.endMs,timeZone)}`}</strong>
    </button>;
  })}</div>:<p className="np-r339-card-status">تظهر الفترات الخمس عند توفر مواقيت الجمعة المعتمدة.</p>}
  <small className="np-r339-card-note">الفضائل مرتبة كما وردت، والحساب الزمني من مواقيت نور.</small>
 </section>;
}

export function NoorDashboardCardsR339({prayers,nextPrayer,countdownSeconds,nowMs,timeZone,nextFajrAt,precedingNight,preferences,onPreferencesChange,selectedFridayHour,onSelectFridayHour,fridaySelectionBusy,fridayHours,appointmentDefinitions,religiousEvents,onAddAppointment,boardDate,historicalEvents}:CardProps):ReactElement{
 return <section className="np-r331-board np-r339-board np-card" data-testid="r331-announcement-board" data-board-date={boardDate} aria-label="مجموعة نور اليومية">
  <header className="np-r339-board-head"><div><h2>مجموعة نور اليومية</h2><small>المعلومات التي تحتاجها الآن</small></div><span>حتى ستة كروت</span></header>
  <div className="np-r331-board-grid np-r339-card-grid">
   <div className="np-r331-tile np-r339-card np-r339-rhythm-card" data-testid="r339-rhythm-card"><NoorR232TimeWindows prayers={prayers} nowMs={nowMs} timeZone={timeZone} preferences={preferences} onPreferencesChange={onPreferencesChange} {...(nextFajrAt==null?{}:{nextFajrAt})} precedingNight={precedingNight??null} selectedFridayHour={selectedFridayHour??null} fridaySelectionBusy={Boolean(fridaySelectionBusy)} {...(onSelectFridayHour?{onSelectFridayHour}: {})}/></div>
   <div className="np-r331-tile np-r339-card-slot"><PrayerCard prayers={prayers} nextPrayer={nextPrayer} countdownSeconds={countdownSeconds} timeZone={timeZone}/></div>
   <div className="np-r331-tile np-r339-card-slot"><DevotionalWindowsCard prayers={prayers} nowMs={nowMs} timeZone={timeZone} nextFajrAt={nextFajrAt??null} precedingNight={precedingNight??null} preferences={preferences}/></div>
   <div className="np-r331-tile np-r339-card-slot"><FridayCard fridayHours={fridayHours} nowMs={nowMs} timeZone={timeZone} selectedFridayHour={selectedFridayHour??null} selectionBusy={Boolean(fridaySelectionBusy)} {...(onSelectFridayHour?{onSelectFridayHour}: {})}/></div>
   <div className="np-r331-tile np-r339-card-slot np-r339-appointment-slot" data-testid="r339-appointment-card"><UpcomingCountdownR301 definitions={appointmentDefinitions} nowMs={nowMs} timeZone={timeZone} onAdd={onAddAppointment} {...(religiousEvents?{religiousEvents}: {})}/></div>
   {historicalEvents?.slice(0,1).map(event=><div className="np-r331-tile np-r339-card-slot" key={event.id}><section className="np-r339-card np-r339-history-card" data-testid="r339-history-card"><CardHeader icon={<NoorR323Icon name="bars"/>} title="حدث تاريخي" detail={event.dateLabel}/><strong>{event.title}</strong>{event.detail?<p>{event.detail}</p>:null}</section></div>)}
  </div>
 </section>;
}
