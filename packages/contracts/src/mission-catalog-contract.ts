import {z} from "zod";
/** Directory metadata only. Never usable as a complete Mission payload. */
export const MissionHeaderSchema=z.object({missionId:z.string().min(1),revision:z.number().int().nonnegative(),title:z.string().max(160),updatedAt:z.string().min(1)});
export const MissionCatalogEntrySchema=MissionHeaderSchema;
export const MissionCatalogSnapshotSchema=z.object({schemaVersion:z.literal("mission-catalog-v1"),workspaceId:z.string().min(1),directoryComplete:z.literal(true),entries:MissionCatalogEntrySchema.array()}).superRefine((snapshot,context)=>{
 const ids=new Set<string>();for(const item of snapshot.entries){if(ids.has(item.missionId))context.addIssue({code:"custom",message:"Duplicate Mission directory identity"});ids.add(item.missionId);}
});
export type MissionCatalogSnapshot=z.infer<typeof MissionCatalogSnapshotSchema>;
export type MissionHeader=z.infer<typeof MissionHeaderSchema>;
export const MissionReadProgressSchema=z.object({schemaVersion:z.literal("mission-read-progress-v1"),workspaceId:z.string().min(1),total:z.number().int().nonnegative(),verified:z.number().int().nonnegative(),complete:z.boolean()}).superRefine((value,context)=>{
 if(value.verified>value.total||value.complete&&value.verified!==value.total)context.addIssue({code:"custom",message:"Invalid Mission read progress"});
});
export type MissionReadProgress=z.infer<typeof MissionReadProgressSchema>;
