import {AsyncLocalStorage} from "node:async_hooks";
import {AiProviderTransportDiagnosticSchema,type AiProviderTransportDiagnostic} from "@evolution/contracts";

const active=new AsyncLocalStorage<WeakMap<object,AiProviderTransportDiagnostic>>();
const object=(value:unknown):value is object=>Boolean(value&&(typeof value==="object"||typeof value==="function"));
/** A fresh invocation owns its cache, including when a provider reuses one Error object concurrently. */
export const withServerAiTransportDiagnosticScope=<T>(work:()=>Promise<T>)=>active.run(new WeakMap(),work);
export function recordServerAiTransportDiagnostic(error:unknown,diagnostic:AiProviderTransportDiagnostic){
  const parsed=AiProviderTransportDiagnosticSchema.parse(diagnostic);
  if(object(error))active.getStore()?.set(error,structuredClone(parsed));
  return parsed;
}
/** Trust only our invocation's observations; never adopt an arbitrary error.transportDiagnostic field. */
export function currentServerAiTransportDiagnostic(error:unknown){
  const cache=active.getStore(),seen=new Set<object>();let current=error;
  for(let depth=0;cache&&depth<6&&object(current)&&!seen.has(current);depth++){
    seen.add(current);const value=cache.get(current);if(value)return AiProviderTransportDiagnosticSchema.parse(value);
    try{current=Reflect.get(current,"cause");}catch{return undefined;}
  }
  return undefined;
}
