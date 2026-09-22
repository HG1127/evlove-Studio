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
const PENDING_KEY="evolve-studio:events:pending:v1";
const MAX=1000;
let volatilePending=new Set<string>();

function readLocal():EvolutionEvent[]{
  if(typeof window==="undefined") return [];
  try{return EvolutionEventSchema.array().parse(JSON.parse(window.localStorage.getItem(KEY)??"[]"));}catch{return [];}
}
function readPendingIds(){
  const fallback=new Set(volatilePending);
  if(typeof window==="undefined")return fallback;
  try{
    const parsed=JSON.parse(window.localStorage.getItem(PENDING_KEY)??"[]") as unknown;
    if(!Array.isArray(parsed))return fallback;
    const values=new Set(parsed.filter((value):value is string=>typeof value==="string"&&value.length>0).slice(-MAX));
    volatilePending=new Set(values);
    return values;
  }catch{return fallback;}
}
function writePendingIds(values:Set<string>){
  volatilePending=new Set([...values].slice(-MAX));
  if(typeof window==="undefined")return;
  try{window.localStorage.setItem(PENDING_KEY,JSON.stringify([...volatilePending]));}catch{/* Volatile outbox still protects this tab. */}
}
function setPending(id:string,pending:boolean){
  const values=readPendingIds();
  if(pending)values.add(id);else values.delete(id);
  writePendingIds(values);
}

export function cacheLocalEvolutionEvent(eventInput:EvolutionEvent,options?:{pending?:boolean}){
  const event=EvolutionEventSchema.parse(eventInput);
  if(typeof window!=="undefined"){
    const next=[event,...readLocal().filter((item)=>item.id!==event.id)].slice(0,MAX);
    try{window.localStorage.setItem(KEY,JSON.stringify(next));}catch{/* local projection is best effort */}
    setPending(event.id,Boolean(options?.pending));
    window.dispatchEvent(new CustomEvent("evolve-events-changed",{detail:{missionId:event.missionId,type:event.type,eventId:event.id,pending:Boolean(options?.pending)}}));
  }
  return event;
}

export function appendLocalEvolutionEvent(input: Omit<EvolutionEvent,"schemaVersion"|"id"|"at"> & {id?:string;at?:string}) {
  return cacheLocalEvolutionEvent(createEvolutionEvent(input),{pending:true});
}

export function listLocalEvolutionEvents(missionId?:string){const all=readLocal();return missionId?all.filter((e)=>e.missionId===missionId):all;}
export function listPendingLocalEvolutionEvents(){
  const pending=readPendingIds();
  return readLocal().filter((event)=>pending.has(event.id)).reverse();
}
export function markLocalEvolutionEventSynced(id:string){setPending(id,false);}
export function pendingLocalEvolutionEventCount(){return readPendingIds().size;}
