/** One bounded foreground recovery cycle. The caller supplies the authorized
 * read and owns UI/session handling. No credentials, storage, writes or polling. */
export type ResumeOutcome = 'ready'|'retryable'|'session-required'|'forbidden'|'terminal';
export function classifyResumeHttp(status: number): ResumeOutcome {
  if(status>=200&&status<300)return 'ready';
  if(status===401)return 'session-required';
  if(status===403)return 'forbidden';
  if(status===408||status===429||status===502||status===503||status===504)return 'retryable';
  return 'terminal';
}
export type ResumeResult = ResumeOutcome|'deferred'|'cancelled';
export interface ResumeDependencies {
  eligible(): boolean;
  read(signal: AbortSignal): Promise<ResumeOutcome>;
  wait(ms: number,signal: AbortSignal): Promise<void>;
}
/** Coalesce focus/pageshow/online bursts. Deferred cycles are resumed by the
 * caller on queue drain or next foreground event, not by background polling. */
export function createResumeRecovery(deps: ResumeDependencies) {
  let active: {controller:AbortController;promise:Promise<ResumeResult>}|undefined;
  let deferred=false;
  const delays=[0,1000,3000,7000] as const;
  function resume():Promise<ResumeResult> {
    if(active)return active.promise;
    if(!deps.eligible()){deferred=true;return Promise.resolve('deferred');}
    deferred=false;
    const controller=new AbortController(), signal=controller.signal;
    const run=async():Promise<ResumeResult>=>{
      for(const delay of delays){
        if(signal.aborted)return 'cancelled';
        if(!deps.eligible()){deferred=true;return 'deferred';}
        if(delay){try{await deps.wait(delay,signal);}catch{return signal.aborted?'cancelled':'terminal';}}
        if(signal.aborted)return 'cancelled';
        if(!deps.eligible()){deferred=true;return 'deferred';}
        let result:ResumeOutcome;
        try{result=await deps.read(signal);}catch{result='retryable';}
        if(signal.aborted)return 'cancelled';
        if(result!=='retryable')return result;
      }
      return 'retryable';
    };
    const promise=Promise.resolve().then(run).finally(()=>{if(active?.controller===controller)active=undefined;});
    active={controller,promise};
    return promise;
  }
  return {resume,afterWrites:()=>deferred?resume():Promise.resolve(undefined),cancel(){deferred=false;active?.controller.abort();}};
}
