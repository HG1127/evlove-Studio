import {z} from "zod";
import {MissionIndexSnapshotSchema} from "@evolution/contracts";

const RowsSchema=z.array(z.object({id:z.string().min(1),revision:z.number().int().nonnegative()}));

export async function readMissionIndexSnapshot(request:(path:string)=>Promise<unknown>,workspaceId:string|undefined){
  const items:Array<{missionId:string;revision:number}>=[];
  const seen=new Set<string>();let cursor:string|undefined;
  for(;;){
    const path="missions?select=id,revision&order=id.asc&limit=500"+(cursor?`&id=gt.${encodeURIComponent(cursor)}`:"");
    const rows=RowsSchema.parse(await request(path));
    if(rows.length>500)throw new Error("Mission index exceeds requested page");
    if(!rows.length)return MissionIndexSnapshotSchema.parse({schemaVersion:"mission-index-v1",workspaceId,complete:true,items});
    for(const row of rows){
      if(seen.has(row.id))throw new Error("Mission index cursor repeated an identity");
      seen.add(row.id);items.push({missionId:row.id,revision:row.revision});
    }
    cursor=rows.at(-1)!.id;
  }
}
