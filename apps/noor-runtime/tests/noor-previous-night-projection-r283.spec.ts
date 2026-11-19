import assert from "node:assert/strict";
import test from "node:test";
import { resolveNoorUpcomingFriday } from "../src/noor-upcoming-friday-r370.js";
import {IntlTimeZoneAdapter} from "@noor/personal";
import {resolveNoorPreviousNightR283} from "../src/noor-previous-night-projection-r283.js";

const maghrib="2026-11-06T14:12:00.000Z";
const isha="2026-11-06T15:35:00.000Z";
const fajr="2026-11-07T02:57:00.000Z";
const boundary="2026-11-06T21:00:00.000Z"; // midnight November 7 in Asia/Riyadh
function testFixture(now="2026-11-07T00:15:00.000Z"){
 const calls:{location:string[];policy:string[];calculated:string[]}={
  location:[],policy:[],calculated:[],
 };
 const location={userId:"user-1",id:"location-1",timeZone:"Asia/Riyadh"};
 const policy={id:"policy-1"};
 const input={
  userId:"user-1",now,
  today:{
   personalDay:{boundary:{startAt:boundary,localDate:"2026-11-07",timeZone:"Asia/Riyadh",
    locationRevisionId:"location-1",prayerPolicyRevisionId:"policy-1"}},
   islamicContext:{prayerTimes:{fajr}},
  } as never,
  locations:{async getEffective(_id:string,instant:string){
   calls.location.push(instant);return location as never;
  }},
  prayerPolicies:{async getEffective(_id:string,instant:string){
   calls.policy.push(instant);return policy as never;
  }},
  timeZone:new IntlTimeZoneAdapter(),
  prayerCalculator:{async calculate(_l:unknown,_p:unknown,date:string){
   calls.calculated.push(date);return {maghrib,isha} as never;
  }},
 };
 return {input,calls};
}
test("R283 uses previous real civil date and session-owned prayer authority after midnight",async()=>{
 const {input,calls}=testFixture();
 assert.deepEqual(await resolveNoorPreviousNightR283(input),{maghribAt:maghrib,ishaAt:isha,fajrAt:fajr});
 assert.deepEqual(calls.calculated,["2026-11-06"]);
 assert.equal(calls.location[0],"2026-11-06T20:59:59.999Z");
 assert.deepEqual(calls.policy,calls.location);
});
test("R283 at or after Fajr does not expose previous-night projection or query prior data",async()=>{
 const {input,calls}=testFixture(fajr);
 assert.equal(await resolveNoorPreviousNightR283(input),null);
 assert.deepEqual(calls.calculated,[]);
});
test("R283 fails closed when past location or policy revision differs",async()=>{
 const fixture=testFixture();
 assert.equal(await resolveNoorPreviousNightR283({...fixture.input,
  locations:{async getEffective(){return {...fixture.input, id:"other-location"} as never;}},
 }),null);
 assert.equal(await resolveNoorPreviousNightR283({...fixture.input,
  prayerPolicies:{async getEffective(){return {id:"other-policy"} as never;}},
 }),null);
});
test("R283 rejects contradictory previous Isha and no guessed 24-hour Maghrib",async()=>{
 const fixture=testFixture();
 assert.equal(await resolveNoorPreviousNightR283({...fixture.input,
  prayerCalculator:{async calculate(){return {maghrib,isha:"2026-11-07T03:01:00Z"} as never;}},
 }),null);
 assert.equal(await resolveNoorPreviousNightR283({...fixture.input,
  prayerCalculator:{async calculate(){throw Error("unavailable");}},
 }),null);
});

test("Thursday prefetches Friday from the account's effective prayer calculator without guessing on failure",async()=>{
 const calculations:string[]=[];
 const sunrise="2026-11-06T03:30:00Z",dhuhr="2026-11-06T08:40:00Z";
 const input={
  userId:"user-1",now:"2026-11-05T08:00:00Z",
  today:{personalDay:{boundary:{localDate:"2026-11-05",timeZone:"Asia/Riyadh"}},
    islamicContext:{prayerTimes:{nextFajr:"2026-11-06T02:51:00Z"}}} as never,
  timeZone:new IntlTimeZoneAdapter(),
  locations:{async getEffective(){return {userId:"user-1",timeZone:"Asia/Riyadh",name:"الرياض"} as never;}},
  prayerPolicies:{async getEffective(){return {userId:"user-1"} as never;}},
  calculator:{async calculate(_l:unknown,_p:unknown,localDate:string){
    calculations.push(localDate);return {localDate,sunrise,dhuhr} as never;
  }},
 };
 assert.deepEqual(await resolveNoorUpcomingFriday(input),{localDate:"2026-11-06",sunrise,dhuhr,city:"الرياض"});
 assert.deepEqual(calculations,["2026-11-06"]);
 assert.equal(await resolveNoorUpcomingFriday({...input,now:"2026-11-05T21:00:00Z"}),null);
 assert.equal(await resolveNoorUpcomingFriday({...input,calculator:{async calculate(){throw Error("fixture");}}}),null);
});
