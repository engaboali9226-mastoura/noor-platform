/** Count units, not points. Session weighting/recovery remains in task-sessions.ts.
 * A session plan replaces its parent occurrence in the daily count.
 * Use the same civil-day due rule as sessionAchievementOnDate. */
export function countDailyAchievementUnits(
  item: Readonly<{kind:string;status:string}>,
  plan: Readonly<{sessions:readonly Readonly<{
    id:string;scheduledDate?:string|null;completedAt:string|null;target:number|null;
  }>[]}>|null|undefined,
  log: readonly Readonly<{taskSessionId?:string;localDate:string;at:string;amount:number}>[],
  date: string,
): Readonly<{scheduled:number;completed:number}> {
  if(item.status==="Cancelled"||item.status==="Suppressed")return {scheduled:0,completed:0};
  if(item.kind!=="Task"||!plan?.sessions.length)
    return {scheduled:1,completed:item.status==="Completed"?1:0};
  let scheduled=0,completed=0;
  for(const session of plan.sessions){
    const entries=log.filter(e=>e.taskSessionId===session.id);
    const due=session.scheduledDate?session.scheduledDate===date:
      !session.completedAt||entries.some(e=>e.localDate>=date);
    if(!due)continue;
    scheduled++;
    const throughDay=entries.filter(e=>e.localDate<=date);
    const progress=Math.round(throughDay.reduce((sum,e)=>sum+e.amount,0)*1e6)/1e6;
    if((session.completedAt!==null&&throughDay.some(e=>e.at===session.completedAt))||
      (session.target!==null&&progress>=session.target))completed++;
  }
  return {scheduled,completed};
}
