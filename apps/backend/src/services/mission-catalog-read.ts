import {z} from "zod";
import {MissionCatalogSnapshotSchema,type MissionHeader} from "@evolution/contracts";
const RowSchema=z.object({id:z.string().min(1),revision:z.number().int().nonnegative(),payload_id:z.string().min(1),title:z.string(),updated_at:z.string()}).refine(row=>row.id===row.payload_id,"Mission header identity mismatch");
const RowsSchema=z.array(RowSchema).max(500);
/** Display-only names and timestamps. Never selects source bodies or evidence. */
export async function readMissionCatalog(request:(path:string)=>Promise<unknown>,workspaceId:string|undefined){
 const entries:MissionHeader[]=[],seen=new Set<string>();let cursor:string|undefined;
 for(;;){
  const params=new URLSearchParams({select:"id,revision,payload_id:payload->>id,title:payload->>name,updated_at:payload->>updatedAt",order:"id.asc",limit:"500"});if(cursor)params.set("id","gt."+cursor);
  const rows=RowsSchema.parse(await request("missions?"+params));
  if(!rows.length)return MissionCatalogSnapshotSchema.parse({schemaVersion:"mission-catalog-v1",workspaceId,directoryComplete:true,entries});
  for(const row of rows){if(seen.has(row.id))throw new Error("Mission directory repeated an identity");seen.add(row.id);entries.push({missionId:row.id,revision:row.revision,title:row.title.slice(0,160),updatedAt:row.updated_at});}
  cursor=rows.at(-1)!.id;
 }
}
