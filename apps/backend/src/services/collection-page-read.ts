import {z} from "zod";

type RestRead=(path:string,init?:RequestInit)=>Promise<unknown>;
const RowsSchema=z.array(z.object({id:z.string().min(1)}).passthrough());
const SingleRowSchema=RowsSchema.max(1);

export async function readMissionRowById(request:RestRead,id:string){
  const params=new URLSearchParams({p_mission_id:id});
  const rows=SingleRowSchema.parse(await request(`rpc/read_evolution_mission_envelope?${params}`));
  const row=rows[0];
  if(row&&row.id!==id)throw new Error("Mission read identity mismatch");
  return row;
}

/** Bound serialization and transport work to one complete Mission. Never trim
 * its state or publish a partial collection. Job pagination stays unchanged. */
export async function readRowsByIdPage(request:RestRead,table:"missions"|"jobs",filter="",cursor?:string,limit=500){
  if(table==="missions"&&filter)throw new Error("Mission page filters are not supported");
  const pageLimit=table==="missions"?Math.min(limit,1):limit;
  const params=new URLSearchParams({p_page_limit:String(pageLimit)});
  if(cursor)params.set("p_after_id",cursor);
  const path=table==="missions"?`rpc/read_evolution_mission_envelope_page?${params}`
    :`${table}?select=*&order=id.asc&limit=${pageLimit}${filter}`+(cursor?`&id=gt.${encodeURIComponent(cursor)}`:"");
  const value=await request(path);
  const rows=RowsSchema.parse(value);
  if(rows.length>pageLimit)throw new Error(`${table} list exceeds the requested page`);
  if(rows.length===0)return {rows:[],nextCursor:undefined};
  const last=rows[rows.length-1];
  if(last.id===cursor)throw new Error(`${table} list cursor is invalid`);
  return {rows,nextCursor:last.id};
}
