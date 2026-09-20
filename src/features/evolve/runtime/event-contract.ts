import {
  EvolutionEventSchema,
  createEvolutionEvent,
  type EvolutionEvent,
} from "@evolution/contracts";

export {
  EvolutionEventSchema,
  EvolutionEventTypeSchema,
  createEvolutionEvent,
} from "@evolution/contracts";
export type {
  EvolutionEvent,
  EvolutionEventType,
  EventStorePort,
} from "@evolution/contracts";

const KEY="evolve-studio:events:v1";
const MAX=1000;

function readLocal():EvolutionEvent[]{
  if(typeof window==="undefined") return [];
  try{return EvolutionEventSchema.array().parse(JSON.parse(window.localStorage.getItem(KEY)??"[]"));}catch{return [];}
}

export function cacheLocalEvolutionEvent(eventInput:EvolutionEvent){
  const event=EvolutionEventSchema.parse(eventInput);
  if(typeof window!=="undefined"){
    const next=[event,...readLocal().filter((item)=>item.id!==event.id)].slice(0,MAX);
    try{window.localStorage.setItem(KEY,JSON.stringify(next));}catch{/* local projection is best effort */}
    window.dispatchEvent(new CustomEvent("evolve-events-changed",{detail:{missionId:event.missionId,type:event.type,eventId:event.id}}));
  }
  return event;
}

export function appendLocalEvolutionEvent(input: Omit<EvolutionEvent,"schemaVersion"|"id"|"at"> & {id?:string;at?:string}) {
  return cacheLocalEvolutionEvent(createEvolutionEvent(input));
}

export function listLocalEvolutionEvents(missionId?:string){const all=readLocal();return missionId?all.filter((e)=>e.missionId===missionId):all;}
