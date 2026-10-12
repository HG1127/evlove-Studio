import {getWorld} from "workflow/runtime";
import {z} from "zod";
import {workflowRunExists} from "./workflow-run-control";

const WorkflowRunMetadataSchema=z.object({
  runId:z.string().min(1),status:z.enum(["pending","running","completed","failed","cancelled"]),
});

/** Read public World metadata only; SDK Run.status defaults to materializing input/output. */
export async function readWorkflowRunMetadata(
  runId:string,
  presence:(id:string)=>Promise<boolean>=workflowRunExists,
  read:(id:string)=>Promise<unknown>=(id)=>getWorld().runs.get(id,{resolveData:"none"}),
){
  if(!z.boolean().parse(await presence(runId)))return {exists:false as const};
  const metadata=WorkflowRunMetadataSchema.parse(await read(runId));
  if(metadata.runId!==runId)throw new Error("Workflow metadata belongs to another Run");
  return {exists:true as const,status:metadata.status};
}
