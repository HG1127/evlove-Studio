import {EvolutionEventSchema,type EvolutionEvent,type EventStorePort} from "@evolution/contracts";
import {canonicalEvidenceJson} from "./evidence-ledger";
import {EventIdempotencyConflictError} from "./event-persistence";
import {getServerEventById} from "./production-runtime";

/** SDK retries keep the committed occurrence time only when every intent field matches. */
export async function appendWorkflowControlEvent(
  store:Pick<EventStorePort,"append">,
  input:EvolutionEvent,
  read:(id:string)=>Promise<EvolutionEvent|undefined>=(id)=>getServerEventById(id),
):Promise<void>{
  const event=EvolutionEventSchema.parse(input);
  try{await store.append(event);}
  catch(error){
    if(!(error instanceof EventIdempotencyConflictError))throw error;
    const row=await read(event.id);
    if(!row)throw error;
    const persisted=EvolutionEventSchema.parse(row);
    if(canonicalEvidenceJson({...event,at:undefined})!==canonicalEvidenceJson({...persisted,at:undefined}))throw error;
    // Append the authoritative payload to also finish a failed signed Evidence mirror.
    await store.append(persisted);
  }
}
