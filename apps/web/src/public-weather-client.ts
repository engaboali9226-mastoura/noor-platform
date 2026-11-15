function isRecord(value:unknown):value is Record<string,unknown>{return value!==null&&typeof value==="object"&&!Array.isArray(value);}
const finite=(value:unknown):number|null=>typeof value==="number"&&Number.isFinite(value)?value:null;

export type CurrentWeatherR338=Readonly<{
  temperatureC:number|null;
  uvIndex:number|null;
  windSpeedKmh:number|null;
  windDirectionDeg:number|null;
  precipitationMm:number|null;
  rainMm:number|null;
}>;

/** Current conditions are requested only for a valid, user-selected location.
 * Missing provider fields stay null so the UI can omit them instead of showing
 * stale or fabricated weather. */
export async function loadCurrentWeather(location:Readonly<{latitude:number;longitude:number}>):Promise<CurrentWeatherR338|null>{
  if(!Number.isFinite(location.latitude)||Math.abs(location.latitude)>90
      ||!Number.isFinite(location.longitude)||Math.abs(location.longitude)>180)return null;
  try{
    const url=new URL("https://api.open-meteo.com/v1/forecast");
    url.searchParams.set("latitude",String(location.latitude));
    url.searchParams.set("longitude",String(location.longitude));
    url.searchParams.set("current","temperature_2m,uv_index,wind_speed_10m,wind_direction_10m,precipitation,rain");
    url.searchParams.set("temperature_unit","celsius");
    url.searchParams.set("wind_speed_unit","kmh");
    const response=await fetch(url.toString(),{cache:"no-store",credentials:"omit"});
    if(!response.ok)return null;
    const payload:unknown=await response.json();
    if(!isRecord(payload)||!isRecord(payload.current))return null;
    const current=payload.current;
    return {
      temperatureC:finite(current.temperature_2m),
      uvIndex:finite(current.uv_index),
      windSpeedKmh:finite(current.wind_speed_10m),
      windDirectionDeg:finite(current.wind_direction_10m),
      precipitationMm:finite(current.precipitation),
      rainMm:finite(current.rain),
    };
  }catch{return null;}
}

/** Backwards-compatible temperature adapter for existing callers/tests. */
export async function loadCurrentTemperature(location:Readonly<{latitude:number;longitude:number}>):Promise<number|null>{
  return (await loadCurrentWeather(location))?.temperatureC??null;
}
