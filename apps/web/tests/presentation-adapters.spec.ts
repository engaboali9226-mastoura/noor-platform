import assert from "node:assert/strict";
import test from "node:test";
import {readAppearance,saveAppearance} from "../src/appearance-preference-store.js";
import {loadCurrentTemperature,loadCurrentWeather} from "../src/public-weather-client.js";
test("appearance storage accepts only the fixed preference key and six themes",()=>{
 const old=Object.getOwnPropertyDescriptor(globalThis,"window");const calls:unknown[]=[];let saved="dark";
 try {
  Object.defineProperty(globalThis,"window",{configurable:true,value:{localStorage:{getItem(key:string){calls.push(["read",key]);return saved;},setItem(key:string,value:string){calls.push(["write",key,value]);saved=value;}}}});
  assert.equal(readAppearance(),"dark");saveAppearance("light");assert.equal(readAppearance(),"light");
  const before=calls.length;saveAppearance("session-token" as never);assert.equal(calls.length,before);
  assert.deepEqual(calls,[["read","noor:appearance:v1"],["write","noor:appearance:v1","light"],["read","noor:appearance:v1"]]);
  for(const palette of ["blue","beige","sage","lavender"] as const){saveAppearance(palette);assert.equal(readAppearance(),palette);}
  saved="noor";assert.equal(readAppearance(),"blue");
  saved="unknown";assert.equal(readAppearance(),"blue");
  Object.defineProperty(globalThis,"window",{configurable:true,get(){throw Error("storage unavailable");}});
  assert.equal(readAppearance(),"blue");assert.doesNotThrow(()=>saveAppearance("dark"));
 } finally {if(old)Object.defineProperty(globalThis,"window",old);else delete (globalThis as any).window;}
});
test("weather adapter uses the public provider without credentials and validates its response",async()=>{
 const old=globalThis.fetch;const calls:unknown[]=[];
 try {
  globalThis.fetch=(async(url:unknown,init:RequestInit)=>{calls.push([String(url),init]);return {ok:true,json:async()=>({current:{temperature_2m:28.5,uv_index:4.2,wind_speed_10m:18.6,wind_direction_10m:70,precipitation:0.2,rain:0.2}})};}) as typeof fetch;
  assert.equal(await loadCurrentTemperature({latitude:24.7,longitude:46.7}),28.5);
  const [url,init]=(calls[0] as [string,RequestInit]);assert.equal(new URL(url).origin,"https://api.open-meteo.com");assert.equal(init.credentials,"omit");assert.equal(init.cache,"no-store");assert.equal(init.headers,undefined);
  const parsed=new URL(url);assert.match(parsed.searchParams.get("current")??"",/uv_index/);assert.match(parsed.searchParams.get("current")??"",/wind_speed_10m/);assert.equal(parsed.searchParams.get("wind_speed_unit"),"kmh");
  assert.deepEqual(await loadCurrentWeather({latitude:24.7,longitude:46.7}),{temperatureC:28.5,uvIndex:4.2,windSpeedKmh:18.6,windDirectionDeg:70,precipitationMm:0.2,rainMm:0.2});
  globalThis.fetch=(async()=>({ok:true,json:async()=>({current:{temperature_2m:"invalid"}})})) as typeof fetch;
  assert.equal(await loadCurrentTemperature({latitude:24.7,longitude:46.7}),null);
 } finally {globalThis.fetch=old;}
});
