import {ValidationResultSchema} from "@evolution/contracts";
import {readServerEventById} from "./event-persistence";

export async function readServerValidationRecord(request:(path:string)=>Promise<unknown>,id:string){
  const event=await readServerEventById(request,"validation-result:"+id);
  if(!event)return undefined;
  const result=ValidationResultSchema.parse(event.payload.validation);
  const expectedType=result.status==="passed"?"ValidationPassed"
    :result.status==="failed"?"ValidationFailed":"ValidationUnverified";
  if(event.type!==expectedType||event.source!=="backend-validation-runtime"
    ||event.payload.validationId!==id||result.id!==id
    ||event.missionId!==result.missionId||event.jobId!==result.jobId
    ||event.checkpointId!==result.checkpointId){
    throw new Error("Persisted Validation Event binding is invalid");
  }
  return {event,result};
}
