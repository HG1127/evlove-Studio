import {z} from "zod";
/** Server-owned operation reservation in the existing versioned Mission JSONB. */
export const ServerWorkflowControlOwnerSchema=z.object({
  schemaVersion:z.literal("server-workflow-control-owner-v1"),
  controlJobId:z.string().min(1),operationKey:z.string().min(1),
  sourceUpdatedAt:z.string().min(1),inputFingerprint:z.string().regex(/^[0-9a-f]{64}$/),
  requestedAt:z.string().min(1),phase:z.enum(["reserved","dispatching","bound"]),
  runId:z.string().min(1).optional(),
  retryOfControlJobId:z.string().min(1).optional(),retryOfRunId:z.string().min(1).optional(),
}).superRefine((value,context)=>{
  if((value.phase==="bound")!==Boolean(value.runId))context.addIssue({code:"custom",message:"Only a bound control owner has a Run ID"});
  if(Boolean(value.retryOfControlJobId)!==Boolean(value.retryOfRunId))context.addIssue({code:"custom",message:"Retry source requires both original Job and Run"});
});
export type ServerWorkflowControlOwner=z.infer<typeof ServerWorkflowControlOwnerSchema>;
