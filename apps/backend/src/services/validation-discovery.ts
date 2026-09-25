import {
  ValidationDiscoveryPageSchema,ValidationDiscoveryQuerySchema,type EvolutionEvent,
} from "@evolution/contracts";
import {listServerEventEvidencePage} from "./production-runtime";
import {parsePersistedValidationEvent} from "./validation-event-record";

type EventPage={events:EvolutionEvent[];nextCursor?:string};

export async function discoverValidations(
  raw:unknown,
  list:(args:{missionId?:string;afterId?:string;limit:number})=>Promise<EventPage>=listServerEventEvidencePage,
){
  const input=ValidationDiscoveryQuerySchema.parse(raw);
  const page=await list({missionId:input.missionId,afterId:input.afterId,limit:input.limit});
  if(page.events.length>input.limit)throw new Error("Validation discovery page exceeded the requested limit");
  const validations=[];
  for(const event of page.events){
    if(event.missionId!==input.missionId)throw new Error("Validation discovery page crossed Mission scope");
    const record=parsePersistedValidationEvent(event);
    if(record&&(!input.artifactId||record.result.artifactId===input.artifactId)){
      validations.push(record.result);
    }
  }
  return ValidationDiscoveryPageSchema.parse({
    scanned:page.events.length,validations,nextCursor:page.nextCursor,
  });
}
