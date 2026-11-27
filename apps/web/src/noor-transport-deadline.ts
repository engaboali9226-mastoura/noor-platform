/** Bound a single transport attempt. Abort is not proof of server rollback.
 * A late result cannot settle the returned promise or apply a projection. */
export async function withNoorDeadline<T>(ms:number,attempt:(signal:AbortSignal)=>Promise<T>,onTimeout:()=>T):Promise<T>{
  if(!Number.isFinite(ms)||ms<=0)return onTimeout();
  const controller=new AbortController();
  let timer:ReturnType<typeof setTimeout>|undefined;
  const deadline=new Promise<T>(resolve=>{
    timer=setTimeout(()=>{controller.abort();resolve(onTimeout());},ms);
  });
  try{return await Promise.race([deadline,attempt(controller.signal)]);}
  finally{clearTimeout(timer);}
}
