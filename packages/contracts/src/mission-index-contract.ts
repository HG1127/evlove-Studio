import {z} from "zod";

export const MissionIndexSnapshotSchema=z.object({
  schemaVersion:z.literal("mission-index-v1"),
  workspaceId:z.string().min(1),
  complete:z.literal(true),
  items:z.array(z.object({missionId:z.string().min(1),revision:z.number().int().nonnegative()})),
}).superRefine((snapshot,context)=>{
  const seen=new Set<string>();
  for(const item of snapshot.items){
    if(seen.has(item.missionId))context.addIssue({code:"custom",message:"Duplicate Mission index identity"});
    seen.add(item.missionId);
  }
});
export type MissionIndexSnapshot=z.infer<typeof MissionIndexSnapshotSchema>;
