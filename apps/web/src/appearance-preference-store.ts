export const NOOR_APPEARANCES = [
 ["blue","أزرق زجاجي","أزرق ضبابي ولمسات ذهبية"],
 ["beige","بيج زجاجي","عاجي دافئ وذهبي رملي"],
 ["sage","أخضر هادئ","درجات المريمية الطبيعية"],
 ["lavender","بنفسجي ضبابي","لافندر ورمادي ناعم"],
 ["light","فاتح","أبيض ورمادي"],
 ["dark","داكن","أزرق ليلي وفحمي"]
] as const;
export type NoorAppearance = typeof NOOR_APPEARANCES[number][0];
const APPEARANCE_KEY = "noor:appearance:v1";
export function normalizeAppearance(value: unknown): NoorAppearance {
 return NOOR_APPEARANCES.some(([id])=>id===value) ? value as NoorAppearance : "blue";
}
export function readAppearance(): NoorAppearance {
 try {return normalizeAppearance(typeof window!=="undefined"?window.localStorage.getItem(APPEARANCE_KEY):null);}
 catch {return "blue";}
}
export function applyAppearance(value: NoorAppearance): void {
 if(typeof document!=="undefined") document.documentElement.dataset.noorAppearance=normalizeAppearance(value);
}
export function saveAppearance(value: NoorAppearance): void {
 if(!NOOR_APPEARANCES.some(([id])=>id===value))return;
 applyAppearance(value);
 try{window.localStorage.setItem(APPEARANCE_KEY, value);}catch{/* Local preference remains usable in memory. */}
}
