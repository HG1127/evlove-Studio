import {EvolutionEventSchema,type EvolutionEvent} from "@evolution/contracts";
import {
  canonicalEvidenceJson,EventEvidenceIdentityConflictError,mirrorEvolutionEventToEvidenceLedger,
} from "./evidence-ledger";

type JsonRecord=Record<string,unknown>;

export class EventIdempotencyConflictError extends Error{
  readonly code="EVENT_IDEMPOTENCY_CONFLICT";
  constructor(readonly eventId:string){
    super(`Event ${eventId} already exists with different content`);
    this.name="EventIdempotencyConflictError";
  }
}

export class EventEvidenceMirrorError extends Error{
  readonly code="EVENT_EVIDENCE_MIRROR_FAILED";
  constructor(readonly eventId:string,cause:unknown){
    super(`Event ${eventId} was persisted but its Evidence mirror failed`,{cause});
    this.name="EventEvidenceMirrorError";
  }
}

export function eventRow(event:EvolutionEvent){
  const value=EvolutionEventSchema.parse(event);
  return {
    id:value.id,mission_id:value.missionId??null,schema_version:value.schemaVersion,
    type:value.type,source:value.source,job_id:value.jobId??null,checkpoint_id:value.checkpointId??null,
    causation_id:value.causationId??null,correlation_id:value.correlationId??null,
    payload:value.payload,at:value.at,
  };
}

export function rowEvent(row:JsonRecord):EvolutionEvent{
  return EvolutionEventSchema.parse({
    schemaVersion:row.schema_version,id:row.id,missionId:row.mission_id??undefined,
    type:row.type,source:row.source,jobId:row.job_id??undefined,
    checkpointId:row.checkpoint_id??undefined,causationId:row.causation_id??undefined,
    correlationId:row.correlation_id??undefined,payload:row.payload??{},at:row.at,
  });
}

function identity(event:EvolutionEvent){
  const row=eventRow(event);
  const at=Date.parse(row.at);
  if(!Number.isFinite(at))throw new Error("Event timestamp is invalid");
  const fractional=/\.(\d+)(?=Z$|[+-]\d{2}:\d{2}$)/i.exec(row.at)?.[1]??"";
  const micros=Math.round(Number("0."+fractional)*1_000_000);
  const secondStart=at-new Date(at).getUTCMilliseconds();
  const normalizedAt=new Date(secondStart+Math.floor(micros/1_000)).toISOString()
    .replace(/Z$/,String(micros%1_000).padStart(3,"0")+"Z");
  return canonicalEvidenceJson({...row,at:normalizedAt});
}

function filterValue(value:string){
  return "%22"+encodeURIComponent(value.replace(/\\/g,"\\\\").replace(/"/g,'\\"'))+"%22";
}

export async function readServerEventById(request:(path:string)=>Promise<unknown>,id:string){
  const rows=await request("events?select=*&id=eq."+filterValue(id)+"&limit=1");
  if(!Array.isArray(rows)||rows.length>1)throw new Error("Event identity readback is invalid");
  if(!rows.length)return undefined;
  if(!rows[0]||typeof rows[0]!=="object"||Array.isArray(rows[0])){
    throw new Error("Event identity row is invalid");
  }
  const event=rowEvent(rows[0] as JsonRecord);
  if(event.id!==id)throw new Error("Event identity lookup returned another Event");
  return event;
}

export async function probeServerEventReadback(request:(path:string)=>Promise<unknown>){
  if(await readServerEventById(request,"health-probe:no-such-event")){
    throw new Error("Event identity readback probe is invalid");
  }
  return true;
}

export async function appendServerEvent(
  request:(path:string,init?:RequestInit)=>Promise<unknown>,input:EvolutionEvent,
  mirror:(event:EvolutionEvent)=>Promise<unknown>=mirrorEvolutionEventToEvidenceLedger,
){
  const event=EvolutionEventSchema.parse(input);
  await request("events?on_conflict=id",{
    method:"POST",headers:{Prefer:"resolution=ignore-duplicates,return=minimal"},
    body:JSON.stringify(eventRow(event)),
  });
  const persisted=await readServerEventById(request,event.id);
  if(!persisted)throw new Error("Persisted Event could not be read back");
  if(identity(persisted)!==identity(event))throw new EventIdempotencyConflictError(event.id);
  try{await mirror(persisted);}
  catch(error){
    if(error instanceof EventEvidenceIdentityConflictError)throw error;
    throw new EventEvidenceMirrorError(event.id,error);
  }
}
