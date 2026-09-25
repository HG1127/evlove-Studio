import {
  EventEvidenceReconcileRequestSchema,type EvolutionEvent,
} from "@evolution/contracts";
import {evidenceLedgerConfigured} from "../server-env";
import {
  createEventEvidenceVerifier,EventEvidenceIdentityConflictError,
  getEvidenceLedgerEntryById,mirrorEvolutionEventToEvidenceLedger,
} from "./evidence-ledger";
import {listServerEventEvidencePage} from "./production-runtime";

type EventPage={events:EvolutionEvent[];nextCursor?:string};
export type EventEvidenceReconcileDependencies={
  list:(args:{missionId?:string;afterId?:string;limit:number})=>Promise<EventPage>;
  lookup:(id:string)=>Promise<unknown>;
  mirror:(event:EvolutionEvent)=>Promise<unknown>;
  verifier:()=>ReturnType<typeof createEventEvidenceVerifier>;
  configured:()=>boolean;
};

const defaultDependencies:EventEvidenceReconcileDependencies={
  list:listServerEventEvidencePage,
  lookup:getEvidenceLedgerEntryById,
  mirror:mirrorEvolutionEventToEvidenceLedger,
  verifier:createEventEvidenceVerifier,
  configured:evidenceLedgerConfigured,
};

export async function reconcileEventEvidence(
  raw:unknown,deps:EventEvidenceReconcileDependencies=defaultDependencies,
){
  const input=EventEvidenceReconcileRequestSchema.parse(raw);
  if(!deps.configured())throw new Error("Evidence Ledger is not configured");
  const page=await deps.list({missionId:input.missionId,afterId:input.afterId,limit:input.limit});
  if(page.events.length>input.limit)throw new Error("Event Evidence page exceeded the requested limit");
  const results:Array<{eventId:string;status:"present"|"missing"|"repaired"|"conflict"|"failed"|"unscoped"}>=[];
  let verifier:ReturnType<typeof createEventEvidenceVerifier>|undefined;
  for(const event of page.events){
    if(!event.missionId){results.push({eventId:event.id,status:"unscoped"});continue;}
    let existing:unknown;
    try{existing=await deps.lookup("event-ledger-"+event.id);}
    catch{results.push({eventId:event.id,status:"failed"});continue;}
    if(existing){
      try{
        verifier??=deps.verifier();
        results.push({eventId:event.id,status:(await verifier)(event,existing)?"present":"conflict"});
      }catch{results.push({eventId:event.id,status:"failed"});}
      continue;
    }
    if(!input.repair){results.push({eventId:event.id,status:"missing"});continue;}
    try{
      if(!await deps.mirror(event))throw new Error("Evidence mirror produced no receipt");
      results.push({eventId:event.id,status:"repaired"});
    }catch(error){
      results.push({eventId:event.id,status:error instanceof EventEvidenceIdentityConflictError?"conflict":"failed"});
    }
  }
  return {
    inspected:page.events.length,
    missing:results.filter((item)=>item.status==="missing").length,
    repaired:results.filter((item)=>item.status==="repaired").length,
    conflicts:results.filter((item)=>item.status==="conflict").length,
    failed:results.filter((item)=>item.status==="failed").length,
    results,
    nextCursor:page.nextCursor,
  };
}
