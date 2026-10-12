import {postgrestLogicValue,postgrestScalarValue} from "./postgrest-filter-values";

type ParseJobCursor={createdAt:string;id:string};
type ParseJobRow=Record<string,unknown>&{id:string;created_at:string;updated_at:string};

function query(since:string,limit:number,sessionId?:string,cursor?:ParseJobCursor){
  const scope=sessionId?"&metadata->>sessionId=eq."+postgrestScalarValue(sessionId):"";
  const after=cursor?"&or=(created_at.lt."+postgrestLogicValue(cursor.createdAt)
    +",and(created_at.eq."+postgrestLogicValue(cursor.createdAt)+",id.lt."+postgrestLogicValue(cursor.id)+"))":"";
  return "jobs?select=*&type=eq.parse&updated_at=gte."+postgrestScalarValue(since)
    +scope+"&order=created_at.desc,id.desc&limit="+limit+after;
}

export async function readRecentParseJobRows(
  request:(path:string)=>Promise<unknown>,
  args:{since:string;limit:number;sessionId?:string;after?:ParseJobCursor},
){
  const limit=Math.max(1,Math.min(args.limit,100));
  const sinceTime=Date.parse(args.since);
  if(!Number.isFinite(sinceTime))throw new Error("Parse Job since is invalid");
  const rows:ParseJobRow[]=[];
  let cursor=args.after;
  while(rows.length<limit){
    const pageLimit=limit-rows.length;
    const page=await request(query(args.since,pageLimit,args.sessionId,cursor));
    if(!Array.isArray(page))throw new Error("Parse Job page is not an array");
    if(page.length===0)break;
    if(page.length>pageLimit)throw new Error("Parse Job page exceeds the requested limit");
    for(const raw of page){
      if(!raw||typeof raw!=="object"||Array.isArray(raw))throw new Error("Parse Job row is invalid");
      const row=raw as ParseJobRow;
      if(typeof row.id!=="string"||!row.id
        ||typeof row.created_at!=="string"||!row.created_at
        ||typeof row.updated_at!=="string"||!row.updated_at){
        throw new Error("Parse Job cursor is invalid");
      }
      const createdTime=Date.parse(row.created_at);
      const updatedTime=Date.parse(row.updated_at);
      if(!Number.isFinite(createdTime)||!Number.isFinite(updatedTime)){
        throw new Error("Parse Job timestamps are invalid");
      }
      if(cursor&&(row.created_at>cursor.createdAt
        ||(row.created_at===cursor.createdAt&&row.id>=cursor.id))){
        throw new Error("Parse Job page did not advance");
      }
      const metadata=row.metadata;
      if(row.type!=="parse"||updatedTime<sinceTime
        ||(args.sessionId&&(!metadata||typeof metadata!=="object"
          ||Array.isArray(metadata)
          ||(metadata as Record<string,unknown>).sessionId!==args.sessionId))){
        throw new Error("Parse Job row does not match the requested filter");
      }
      rows.push(row);
      cursor={createdAt:row.created_at,id:row.id};
    }
  }
  return rows;
}
