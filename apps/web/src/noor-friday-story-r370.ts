import type { R232FridayHour } from "./noor-islamic-daylight-r232.js";

export type UpcomingFridaySchedule = Readonly<{
  localDate: string;
  sunrise: string;
  dhuhr: string;
  city: string;
}>;

export async function renderFridayStory(hours: readonly R232FridayHour[], city: string, timeZone: string): Promise<Blob> {
  const { fridayStoryArtwork } = await import("./noor-friday-story-art-r370.js");
  if (hours.length !== 5) throw Error("Five Friday periods are required");
  const artwork = new Image();
  artwork.src = fridayStoryArtwork;
  await artwork.decode();
  const canvas = document.createElement("canvas");
  canvas.width = 1080;
  canvas.height = 1920;
  const context = canvas.getContext("2d");
  if (!context) throw Error("Canvas unavailable");
  context.scale(1.5, 1.5);
  context.drawImage(artwork, 0, 0, 720, 1280);

  const date = new Intl.DateTimeFormat("ar-SA-u-ca-gregory-nu-latn", {
    timeZone, weekday:"long", day:"numeric", month:"long", year:"numeric",
  });
  const time = new Intl.DateTimeFormat("en-GB", {timeZone, hour:"2-digit", minute:"2-digit", hourCycle:"h23"});
  context.fillStyle = "#173955";
  context.textAlign = "right";
  context.textBaseline = "middle";
  context.direction = "rtl";
  context.font = "bold 27px system-ui";
  context.fillText(date.format(hours[0]!.startMs), 675, 118, 525);
  context.font = "22px system-ui";
  context.fillStyle = "#486379";
  context.fillText(city, 675, 157, 525);

  context.textAlign = "center";
  context.direction = "ltr";
  context.font = "bold 23px system-ui";
  context.fillStyle = "#26669e";
  const drawTimes = (start: number, end: number, y: number) => {
    context.fillText(time.format(start), 251, y);
    context.fillText(time.format(end), 112, y);
  };
  drawTimes(hours[0]!.startMs, hours[4]!.endMs, 252);
  hours.forEach((hour,index)=>drawTimes(hour.startMs,hour.endMs,354+index*112));
  return new Promise((resolve,reject)=>canvas.toBlob(blob=>{
    if(blob)resolve(blob);else reject(Error("PNG unavailable"));
  },"image/png"));
}
