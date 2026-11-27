/** Foreground resume transport. One read, no retry, storage, writes or session renewal.
 * The mounted caller must recheck its own epoch before accepting the result. */
export type ResumeRead<T> = {kind:'ready';snapshot:T}|{kind:'setup-required'|'session-required'|'forbidden'|'retryable'|'terminal'|'cancelled'|'owner-mismatch'};
export async function readNoorResumeToday<T>(options:{
  fetcher:typeof fetch; signal:AbortSignal; timeoutMs:number; expectedOwner:string;
  endpoint?:"/api/noor/personal/today"|"/api/noor/personal/workspace";
  validate:(body:unknown)=>T|null; ownerOf:(snapshot:T)=>string|null;
  observeResponse?:(response:Response)=>void;
}):Promise<ResumeRead<T>>{
  const {fetcher,signal,timeoutMs,expectedOwner,validate,ownerOf,observeResponse}=options;
  if(signal.aborted)return {kind:'cancelled'};
  if(!expectedOwner||!Number.isFinite(timeoutMs)||timeoutMs<=0)return {kind:'terminal'};
  const controller=new AbortController();
  let timer:ReturnType<typeof setTimeout>|undefined;
  let cancel!:()=>void;
  const deadline=new Promise<ResumeRead<T>>(resolve=>{
    cancel=()=>{controller.abort();resolve({kind:'cancelled'});};
    signal.addEventListener('abort',cancel,{once:true});
    timer=setTimeout(()=>{controller.abort();resolve({kind:'retryable'});},timeoutMs);
  });
  const request=async():Promise<ResumeRead<T>>=>{
    let response:Response;
    try{response=await fetcher(options.endpoint??'/api/noor/personal/today',{method:'POST',credentials:'same-origin',cache:'no-store',headers:{'Content-Type':'application/json'},body:'{}',signal:controller.signal});}
    catch{return {kind:signal.aborted?'cancelled':'retryable'};}
    if(controller.signal.aborted)return {kind:signal.aborted?'cancelled':'retryable'};
    if(response.status===401)return {kind:'session-required'};
    if(response.status===403)return {kind:'forbidden'};
    if(response.status===409){observeResponse?.(response);return {kind:'setup-required'};}
    if([408,429,502,503,504].includes(response.status))return {kind:'retryable'};
    if(!response.ok||!response.headers.get('content-type')?.toLowerCase().startsWith('application/json'))return {kind:'terminal'};
    let snapshot:T|null;
    try{snapshot=validate(await response.json());}catch{return {kind:'terminal'};}
    if(controller.signal.aborted)return {kind:signal.aborted?'cancelled':'retryable'};
    if(snapshot===null)return {kind:'terminal'};
    if(ownerOf(snapshot)!==expectedOwner)return {kind:'owner-mismatch'};
    observeResponse?.(response);
    return {kind:'ready',snapshot};
  };
  try{return await Promise.race([deadline,request()]);}
  finally{clearTimeout(timer);signal.removeEventListener('abort',cancel);}
}
