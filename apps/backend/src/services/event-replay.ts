import {EvolutionEventSchema,type EvolutionEvent,type EventStorePort} from "@evolution/contracts";
import {canonicalEvidenceJson} from "./evidence-ledger";
import {EventIdempotencyConflictError} from "./event-persistence";
import {getServerEventById} from "./production-runtime";

/** Retry a committed occurrence only if every intent field still matches its authoritative Event. */
export async function appendCanonicalOccurrenceEvent(
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
    // Replay the exact occurrence, completing its signed mirror without overwriting the Event.
    await store.append(persisted);
  }
}
