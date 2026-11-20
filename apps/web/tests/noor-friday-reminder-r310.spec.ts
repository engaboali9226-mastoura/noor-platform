import assert from "node:assert/strict";
import test from "node:test";
import {createElement} from "react";
import {renderToStaticMarkup} from "react-dom/server";
import {JSDOM} from "jsdom";
import {noorFridayPresentationR310} from "../src/noor-friday-visibility-r310.js";
import {NoorR232TimeWindows} from "../src/noor-time-windows-r232.js";
import {NOOR_R232_DEFAULT} from "../src/noor-time-display-preferences-r232.js";
import {NOOR_FRIDAY_VIRTUES_R284} from "../src/noor-friday-virtues-r284.js";

const zone="Asia/Riyadh";
const thursdayPrayers=[
 {key:"fajr",at:"2026-11-05T02:45:00Z"},
 {key:"sunrise",at:"2026-11-05T03:01:00Z"},
 {key:"dhuhr",at:"2026-11-05T08:40:00Z"},
 {key:"asr",at:"2026-11-05T12:15:00Z"},
 {key:"maghrib",at:"2026-11-05T14:02:00Z"},
];
const fridayPrayers=thursdayPrayers.map(p=>({...p,at:p.at.replace("2026-11-05","2026-11-06")}));
const at=(utc:string)=>Date.parse(utc);
const render=(ms:number,prayers=thursdayPrayers)=>new JSDOM(renderToStaticMarkup(
 createElement(NoorR232TimeWindows,{nowMs:ms,timeZone:zone,prayers,preferences:NOOR_R232_DEFAULT})
)).window.document;

test("R310: the Friday-specific card is hidden before Thursday Asr, then visible starting exactly at authoritative Asr",()=>{
 const before=at("2026-11-05T12:14:59Z");
 const atAsr=at("2026-11-05T12:15:00Z");
 const nearMidnight=at("2026-11-05T20:59:59Z");
 assert.equal(noorFridayPresentationR310(before,zone,thursdayPrayers),"hidden");
 assert.equal(noorFridayPresentationR310(atAsr,zone,thursdayPrayers),"thursday-reminder");
 assert.equal(noorFridayPresentationR310(nearMidnight,zone,thursdayPrayers),"thursday-reminder");
 assert.equal(render(before).querySelectorAll('[data-testid="friday-five-hours-r232"]').length,0);
 const dom=render(atAsr);
 const friday=dom.querySelector('[data-testid="friday-five-hours-r232"]');
 assert.ok(friday);
 assert.equal(friday.getAttribute("data-friday-mode"),"thursday-reminder");
 assert.match(friday.textContent??"",/غدًا الجمعة/u);
 const cards=[...friday.querySelectorAll(".np-r237-friday-hours > .np-r232-window")];
 assert.equal(cards.length,5);
 assert.deepEqual(cards.map(x=>x.querySelector(".np-r284-friday-virtue span:first-child")?.textContent),
  NOOR_FRIDAY_VIRTUES_R284.map(x=>x.icon));
 assert.ok(cards.every(c=>c.querySelector('[role="status"]')?.textContent==="غدًا"));
 assert.equal(friday.querySelectorAll('[role="timer"]').length,0,"Do not invent timers for tomorrow");
 assert.equal(friday.querySelectorAll('[data-testid="r308-friday-details"] li').length,5);
});

test("R310: bad or missing current-day Asr cannot prematurely reveal the reminder",()=>{
 const during=at("2026-11-05T13:00:00Z");
 assert.equal(noorFridayPresentationR310(during,zone,thursdayPrayers.filter(x=>x.key!=="asr")),"hidden");
 assert.equal(noorFridayPresentationR310(during,zone,thursdayPrayers.map(x=>x.key==="asr"?{...x,at:"untrusted"}:x)),"hidden");
 assert.equal(noorFridayPresentationR310(during,zone,thursdayPrayers.map(x=>x.key==="asr"?{...x,at:"2026-10-29T12:15:00Z"}:x)),"hidden","Stale last-week Asr invalid");
 assert.equal(noorFridayPresentationR310(during,zone,thursdayPrayers.map(x=>x.key==="asr"?{...x,at:"2026-11-05T14:00:00Z"}:x)),"hidden","Not yet after Asr");
 assert.equal(noorFridayPresentationR310(NaN,zone,thursdayPrayers),"hidden");
 assert.equal(render(during,thursdayPrayers.filter(x=>x.key!=="asr")).querySelector('[data-testid="friday-five-hours-r232"]'),null);
});

test("R310: use local account timezone; show actual Friday timers on Friday and hide on Saturday through Thursday morning",()=>{
 const lateThu=at("2026-11-05T20:59:59Z");
 const localFriStart=at("2026-11-05T21:00:00Z");
 const friAtNoon=at("2026-11-06T08:00:00Z");
 const saturday=at("2026-11-06T21:00:00Z");
 assert.equal(noorFridayPresentationR310(lateThu,zone,thursdayPrayers),"thursday-reminder");
 assert.equal(noorFridayPresentationR310(localFriStart,zone,fridayPrayers),"friday");
 assert.equal(noorFridayPresentationR310(friAtNoon,zone,fridayPrayers),"friday");
 assert.equal(noorFridayPresentationR310(saturday,zone,fridayPrayers),"hidden");
 assert.equal(noorFridayPresentationR310(at("2026-11-03T12:30:00Z"),zone,thursdayPrayers),"hidden");
 const dom=render(friAtNoon,fridayPrayers);
 const section=dom.querySelector('[data-testid="friday-five-hours-r232"]');
 assert.equal(section?.getAttribute("data-friday-mode"),"friday");
 assert.equal(section?.querySelectorAll(".np-r237-friday-hours > .np-r232-window").length,5);
 assert.equal(section?.querySelectorAll(".np-r237-friday-hours [role=timer]").length,1);
 assert.equal(section?.querySelector(".np-r310-friday-caption"),null);
 assert.equal(render(saturday,fridayPrayers).querySelectorAll('[data-testid="friday-five-hours-r232"]').length,0);
});

test("R310: daily Duha, day and night panels stay visible throughout the week",()=>{
 for(const ms of [at("2026-11-03T12:30:00Z"),at("2026-11-05T12:14:59Z"),at("2026-11-05T12:15:00Z"),at("2026-11-06T08:00:00Z")]){
  const today=ms===at("2026-11-06T08:00:00Z")?fridayPrayers:thursdayPrayers;
  const dom=render(ms,today);
  assert.equal(dom.querySelectorAll(".np-r248-reference-strip > .tone-duha").length,1);
  assert.equal(dom.querySelectorAll(".np-r248-reference-strip > .np-r232-fasting-wrapper").length,1);
  assert.equal(dom.querySelectorAll(".np-r248-reference-strip > .tone-night").length,1);
 }
});

test("Friday image uses verified Friday hours and unlocks at the exact Thursday Asr",()=>{
 const upcomingFriday={localDate:"2026-11-06",sunrise:"2026-11-06T03:30:00Z",dhuhr:"2026-11-06T08:40:00Z",city:"الرياض"};
 const story=(when:string,schedule=upcomingFriday)=>renderToStaticMarkup(createElement(NoorR232TimeWindows,{
  nowMs:at(when),timeZone:zone,prayers:thursdayPrayers,preferences:NOOR_R232_DEFAULT,upcomingFriday:schedule,
 }));
 assert.doesNotMatch(story("2026-11-05T12:14:59Z"),/نسخ الصورة/);
 assert.match(story("2026-11-05T12:15:00Z"),/نسخ الصورة/);
 assert.match(story("2026-11-05T12:15:00Z"),/حفظ الصورة/);
 const document=new JSDOM(story("2026-11-05T12:15:00Z")).window.document;
 const ranges=[...document.querySelectorAll(".np-r237-friday-hours .np-r234-times")];
 const format=(iso:string)=>new Intl.DateTimeFormat("ar-SA-u-nu-latn",{
   timeZone:zone,hour:"numeric",minute:"2-digit",hour12:true,
 }).format(at(iso));
 assert.equal(ranges.length,5);
 const midnight=new JSDOM(story("2026-11-05T21:00:00Z")).window.document;
 assert.equal(midnight.querySelector('[data-testid="friday-five-hours-r232"]')?.getAttribute("data-friday-mode"),"friday");
 assert.equal(midnight.querySelectorAll(".np-r237-friday-hours .np-r234-times").length,5);
 assert.equal(ranges[0]?.querySelector("strong")?.textContent,format("2026-11-06T03:50:00Z"));
 assert.equal(ranges[4]?.querySelector("span:last-child strong")?.textContent,format(upcomingFriday.dhuhr));
 for(const range of ranges)assert.deepEqual([...range.querySelectorAll("small")].map(e=>e.textContent),["من","إلى"]);
 assert.doesNotMatch(story("2026-11-05T12:15:00Z",{...upcomingFriday,localDate:"2026-10-30"}),/نسخ الصورة/);
 assert.doesNotMatch(story("2026-11-05T12:15:00Z",{...upcomingFriday,sunrise:"2026-11-05T03:30:00Z"}),/نسخ الصورة/);
 assert.doesNotMatch(story("2026-11-05T12:15:00Z",{
   ...upcomingFriday,sunrise:"2026-10-30T03:30:00Z",dhuhr:"2026-10-30T08:40:00Z",
 }),/نسخ الصورة/);
});

test("R385 rhythm tile shows only the active Friday hour and returns to ordinary rhythm at Dhuhr",()=>{
 const start=at("2026-11-06T03:21:00Z"),end=at("2026-11-06T08:40:00Z");
 const names=["الأولى","الثانية","الثالثة","الرابعة","الخامسة"];
 const tile=(ms:number,prayers=fridayPrayers)=>render(ms,prayers).querySelector('[data-testid="r322-premium-timer-hub"]')!;
 assert.equal(tile(start-1000).getAttribute("data-friday-hour"),null);
 for(let i=0;i<5;i++){
  const a=Math.round(start+(end-start)*i/5), b=Math.round(start+(end-start)*(i+1)/5);
  for(const ms of [a,b-1000]){
   const t=tile(ms);
   assert.equal(t.getAttribute("data-friday-hour"),String(i+1));
   assert.equal(t.querySelector("h2")?.textContent,"الساعة "+names[i]);
   assert.equal(t.querySelector('[data-testid="r385-friday-hour-duration"] span')?.textContent,"المدة");
   assert.equal(t.querySelectorAll('[role="timer"]').length,1);
   assert.equal(t.querySelector('[role="timer"]')?.textContent,[Math.floor(Math.ceil((b-ms)/1000)/3600),Math.floor(Math.ceil((b-ms)/1000)%3600/60),Math.ceil((b-ms)/1000)%60].map(n=>String(n).padStart(2,"0")).join(":"));
  }
 }
 assert.equal(tile(end).querySelector("h2")?.textContent,"النهار");
 assert.equal(tile(end).getAttribute("data-friday-hour"),null);
 assert.equal(tile(at("2026-11-05T08:00:00Z"),thursdayPrayers).querySelector("h2")?.textContent,"الضحى");
 assert.equal(tile(at("2026-11-05T12:15:00Z"),thursdayPrayers).getAttribute("data-friday-hour"),null);
 const saturday=fridayPrayers.map(p=>({...p,at:p.at.replace("2026-11-06","2026-11-07")}));
 assert.equal(tile(at("2026-11-07T08:00:00Z"),saturday).querySelector("h2")?.textContent,"الضحى");
 assert.equal(tile(at("2026-11-06T08:00:00Z"),thursdayPrayers).getAttribute("data-friday-hour"),null,"never reuse Thursday schedule");
});
