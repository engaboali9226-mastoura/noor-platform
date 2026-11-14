import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NoorR232TimeWindows } from "../src/noor-time-windows-r232.js";
import { NOOR_R232_DEFAULT } from "../src/noor-time-display-preferences-r232.js";

const prayers=[
 {key:"fajr",at:"2026-11-06T02:00:00Z"},
 {key:"sunrise",at:"2026-11-06T03:15:00Z"},
 {key:"dhuhr",at:"2026-11-06T09:00:00Z"},
 {key:"asr",at:"2026-11-06T12:00:00Z"},
 {key:"maghrib",at:"2026-11-06T14:15:00Z"},
 {key:"isha",at:"2026-11-06T15:45:00Z"},
];
function markup(now:string,nextFajrAt?:string){
 return renderToStaticMarkup(createElement(NoorR232TimeWindows,{
  prayers,nowMs:Date.parse(now),timeZone:"Asia/Riyadh",
  preferences:NOOR_R232_DEFAULT,nextFajrAt,
 }));
}
test("R328 active day shows total Fajr-to-Maghrib duration independently of remaining countdown",()=>{
 const html=markup("2026-11-06T10:00:00Z","2026-11-07T02:01:00Z");
 assert.match(html,/data-testid="r328-day-total-duration"><span>إجمالي ساعات النهار<\/span><strong>12 س 15 د<\/strong>/u);
 assert.match(html,/role="timer">04:15:00<\/strong>/u);
});
test("R328 active night shows total Maghrib-to-confirmed-Fajr duration",()=>{
 const html=markup("2026-11-06T20:00:00Z","2026-11-07T02:01:00Z");
 assert.match(html,/data-testid="r328-night-total-duration"><span>إجمالي ساعات الليل<\/span><strong>11 س 46 د<\/strong>/u);
 assert.match(html,/role="timer">06:01:00<\/strong>/u);
});
test("R328 does not fabricate a complete night duration without next Fajr",()=>{
 const html=markup("2026-11-06T20:00:00Z");
 assert.doesNotMatch(html,/data-testid="r328-night-total-duration"/u);
});
