import {type EvolutionEvent} from "@evolution/contracts";
import {rowEvent} from "./event-persistence";

function filterValue(value:string){
  return "%22"+encodeURIComponent(value.replace(/\\/g,"\\\\").replace(/"/g,'\\"'))+"%22";
}

export async function readEventEvidencePage(
  request:(path:string)=>Promise<unknown>,
  args:{missionId?:string;afterId?:string;limit:number},
){
  const bounded=Math.max(1,Math.min(args.limit,50));
  const path="events?select=*&order=id.asc&limit="+bounded
    +(args.missionId?"&mission_id=eq."+filterValue(args.missionId):"")
    +(args.afterId?"&id=gt."+filterValue(args.afterId):"");
  const raw=await request(path);
  if(!Array.isArray(raw)||raw.length>bounded)throw new Error("Event Evidence page is invalid");
  const events:EvolutionEvent[]=[];
  let previous=args.afterId;
  for(const row of raw){
    if(!row||typeof row!=="object"||Array.isArray(row))throw new Error("Event Evidence row is invalid");
    const event=rowEvent(row as Record<string,unknown>);
    if(!event.id||event.id<= (previous??"") ||(args.missionId&&event.missionId!==args.missionId)){
      throw new Error("Event Evidence page cursor or Mission scope is invalid");
    }
    events.push(event);
    previous=event.id;
  }
  return {events,nextCursor:events.at(-1)?.id};
}

export async function probeEventEvidencePage(request:(path:string)=>Promise<unknown>){
  const page=await readEventEvidencePage(request,{
    missionId:"health-probe-no-such-mission",afterId:"health-probe:no-such-event",limit:1,
  });
  if(page.events.length)throw new Error("Event Evidence health page returned data");
  return true;
}
