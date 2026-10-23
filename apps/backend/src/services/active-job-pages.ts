type JobStatus="queued"|"running"|"waiting";
type JobKind="parse"|"campaign";
type JobCursor={updatedAt:string;id:string};
type JobRow=Record<string,unknown>&{id:string;updated_at:string};

function filterValue(value:string){
  return "%22"+encodeURIComponent(value.replace(/\\/g,"\\\\").replace(/"/g,'\\"'))+"%22";
}

function query(status:JobStatus,kind:JobKind,limit:number,missionId?:string,cursor?:JobCursor,
  campaignKeyScope:"workflow-control"|"all"="workflow-control"){
  const scope=missionId?"&mission_id=eq."+encodeURIComponent(missionId):"";
  const kindFilter=kind==="parse"?"&type=eq.parse"
    :"&type=eq.campaign"+(campaignKeyScope==="all"?"":"&idempotency_key=like.workflow-control*");
  const after=cursor?"&or=(updated_at.gt."+filterValue(cursor.updatedAt)
    +",and(updated_at.eq."+filterValue(cursor.updatedAt)+",id.gt."+filterValue(cursor.id)+"))":"";
  return "jobs?select=*&order=updated_at.asc,id.asc&limit="+limit
    +scope+"&status=eq."+status+kindFilter+after;
}

export async function readActiveJobRows(
  request:(path:string)=>Promise<unknown>,
  args:{status:JobStatus;kind:JobKind;limit:number;missionId?:string;initialCursor?:JobCursor;
    campaignKeyScope?:"workflow-control"|"all"},
){
  const limit=Math.max(1,Math.min(args.limit,100));
  const rows:JobRow[]=[];
  let cursor=args.initialCursor;
  while(rows.length<limit){
    const pageLimit=limit-rows.length;
    const page=await request(query(args.status,args.kind,pageLimit,args.missionId,cursor,args.campaignKeyScope));
    if(!Array.isArray(page))throw new Error("Active Job page is not an array");
    if(page.length===0)break;
    if(page.length>pageLimit)throw new Error("Active Job page exceeds the requested limit");
    for(const raw of page){
      if(!raw||typeof raw!=="object"||Array.isArray(raw))throw new Error("Active Job row is invalid");
      const row=raw as JobRow;
      if(typeof row.id!=="string"||!row.id||typeof row.updated_at!=="string"||!row.updated_at){
        throw new Error("Active Job cursor is invalid");
      }
      if(cursor&&(row.updated_at<cursor.updatedAt
        ||(row.updated_at===cursor.updatedAt&&row.id<=cursor.id))){
        throw new Error("Active Job page did not advance");
      }
      if(row.status!==args.status||row.type!==args.kind
        ||(args.missionId&&row.mission_id!==args.missionId)
        ||(args.kind==="campaign"&&args.campaignKeyScope!=="all"&&(
          typeof row.idempotency_key!=="string"
          ||!row.idempotency_key.startsWith("workflow-control:"
          )))){
        throw new Error("Active Job row does not match the requested filter");
      }
      rows.push(row);
      cursor={updatedAt:row.updated_at,id:row.id};
    }
  }
  return rows;
}

export async function probeActiveJobPage(request:(path:string)=>Promise<unknown>){
  await readActiveJobRows(request,{
    status:"queued",kind:"parse",limit:1,
    missionId:"health-probe-no-such-mission",
    initialCursor:{updatedAt:"2026-01-01T00:00:00Z",id:"health-probe-no-such-job"},
  });
  return true;
}
