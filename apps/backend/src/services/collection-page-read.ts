import {z} from "zod";

type RestRead=(path:string,init?:RequestInit)=>Promise<unknown>;
const RowsSchema=z.array(z.object({id:z.string().min(1)}).passthrough());
const StatementTimeoutFailureSchema=z.object({
  statusCode:z.literal(503),
  data:z.object({code:z.literal("SERVER_DATA_PLANE_UNAVAILABLE"),service:z.literal("production-runtime"),upstreamStatus:z.literal(500),upstreamCode:z.literal("57014")}),
});

/** Read complete rows; a confirmed query timeout reduces work without changing
 * the input cursor, row payload, or continuation identity. Never replay writes. */
export async function readRowsByIdPage(request:RestRead,table:"missions"|"jobs",filter="",cursor?:string,limit=500){
  let pageLimit=table==="missions"?Math.min(limit,10):limit;
  for(;;){
    const path=`${table}?select=*&order=id.asc&limit=${pageLimit}${filter}`
      +(cursor?`&id=gt.${encodeURIComponent(cursor)}`:"");
    let value:unknown;
    try{value=await request(path);}
    catch(error){
      if(table!=="missions"||pageLimit<=1||!StatementTimeoutFailureSchema.safeParse(error).success)throw error;
      pageLimit=Math.max(1,Math.floor(pageLimit/2));
      continue;
    }
    const rows=RowsSchema.parse(value);
    if(rows.length>pageLimit)throw new Error(`${table} list exceeds the requested page`);
    if(rows.length===0)return {rows:[],nextCursor:undefined};
    const last=rows[rows.length-1];
    if(last.id===cursor)throw new Error(`${table} list cursor is invalid`);
    return {rows,nextCursor:last.id};
  }
}
