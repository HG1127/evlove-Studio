type EventRow={id:string;at:string;mission_id?:unknown}&Record<string,unknown>;
type EventCursor=Pick<EventRow,"at"|"id">;

function filterValue(value:string){
  return "%22"+encodeURIComponent(value.replace(/\\/g,"\\\\").replace(/"/g,'\\"'))+"%22";
}

function query(missionId:string|undefined,limit:number,cursor?:EventCursor){
  const mission=missionId?"&mission_id=eq."+encodeURIComponent(missionId):"";
  const after=cursor
    ?"&or=(at.lt."+filterValue(cursor.at)
      +",and(at.eq."+filterValue(cursor.at)+",id.lt."+filterValue(cursor.id)+"))"
    :"";
  return "events?select=*&order=at.desc,id.desc&limit="+limit+mission+after;
}

export async function readServerEventRows(
  request:(path:string)=>Promise<unknown>,missionId:string|undefined,requestedLimit:number,
  initialCursor?:EventCursor,
){
  const limit=Math.max(1,Math.min(requestedLimit,1000));
  const rows:EventRow[]=[];
  const seen=new Set<string>();
  let cursor=initialCursor;
  while(rows.length<limit){
    const pageLimit=Math.min(500,limit-rows.length);
    const page=await request(query(missionId,pageLimit,cursor));
    if(!Array.isArray(page))throw new Error("Event page is not an array");
    if(page.length===0)break;
    if(page.length>pageLimit)throw new Error("Event page exceeds the requested limit");
    for(const raw of page){
      if(!raw||typeof raw!=="object"||Array.isArray(raw))throw new Error("Event row is invalid");
      const event=raw as EventRow;
      if(typeof event.id!=="string"||!event.id||typeof event.at!=="string"||!event.at){
        throw new Error("Event page cursor is invalid");
      }
      if(missionId&&event.mission_id!==missionId){
        throw new Error("Event row does not match the requested Mission");
      }
      if(seen.has(event.id)||cursor?.id===event.id)throw new Error("Event page repeated an id");
      seen.add(event.id);
      rows.push(event);
      cursor={at:event.at,id:event.id};
    }
  }
  return rows;
}

export async function probeServerEventPage(request:(path:string)=>Promise<unknown>){
  await readServerEventRows(request,"health-probe-no-such-mission",1,{
    at:"2026-01-01T00:00:00Z",id:"health-probe-no-such-event",
  });
  return true;
}
