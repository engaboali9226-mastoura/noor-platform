// Local browser-only timing; no identifiers, persistence, network or telemetry.
const start="noor:personal:entry-click", measure="noor:personal:click-to-ready";
let pending=false;
export function cancelPersonalEntry():void {
 pending=false;
 try{globalThis.performance?.clearMarks(start);}catch{}
}
export function startPersonalEntry():void {
 cancelPersonalEntry();
 try{globalThis.performance?.clearMeasures(measure);globalThis.performance.mark(start);pending=true;}catch{}
}
export function finishPersonalEntry():void {
 if(!pending)return;
 try{globalThis.performance.measure(measure,start);}catch{}
 finally{cancelPersonalEntry();}
}
