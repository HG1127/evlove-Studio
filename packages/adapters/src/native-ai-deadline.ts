import {z} from "zod";
import type {Dispatcher} from "undici";

/** Native fetch only needs dispatch. The wrapper owns no pool or dispatcher lifecycle. */
export type AiRequestDispatcher=Pick<Dispatcher,"dispatch">;
export type NativeAiFetchInit=RequestInit&{dispatcher?:AiRequestDispatcher};
const duration=z.number().int().min(1).max(900_000);
const key=Symbol.for("undici.globalDispatcher.1");
const dispatcher=(value:unknown):value is AiRequestDispatcher=>Boolean(value&&(typeof value==="object"||typeof value==="function")&&typeof (value as {dispatch?:unknown}).dispatch==="function");
class NativeAiDeadlineError extends Error{
  readonly code:string;
  constructor(code:string,cause?:unknown){super("网络能力检查未通过，当前连接已在发送前停止；无法保留现有连接并应用模型等待时限。",cause===undefined?undefined:{cause});this.code=code;}
}
const unavailable=(code:string,cause?:unknown)=>new NativeAiDeadlineError(code,cause);

/** Backend-only request options. Never initializes, replaces, closes or destroys a global dispatcher. */
export async function nativeAiDeadlineOptions(timeoutMs:number,explicit?:AiRequestDispatcher):Promise<NativeAiFetchInit&{dispatcher:AiRequestDispatcher}>{
  const parsed=duration.safeParse(timeoutMs);
  if(!parsed.success)throw unavailable("AI_NATIVE_DEADLINE_INVALID");
  let parent:AiRequestDispatcher;
  try{if(explicit!==undefined){
      if(!dispatcher(explicit))throw unavailable("AI_NATIVE_DISPATCHER_UNAVAILABLE");
      parent=explicit;
    }else{
    // A passive compatibility assertion prevents undici's import from creating a
    // new default Agent before Node has initialized its proxy-aware dispatcher.
    const prior:unknown=Reflect.get(globalThis,key);
    if(!dispatcher(prior))throw unavailable("AI_NATIVE_DISPATCHER_UNAVAILABLE");
    const {getGlobalDispatcher}=await import("undici");
    if(getGlobalDispatcher()!==prior)throw unavailable("AI_NATIVE_DISPATCHER_CHANGED");
      parent=prior;
    }
  }catch(error){
    if(error instanceof NativeAiDeadlineError)throw error;
    throw unavailable("AI_NATIVE_DISPATCHER_UNAVAILABLE",error);
  }
  return {dispatcher:{dispatch(options:Dispatcher.DispatchOptions,handler:Dispatcher.DispatchHandler){
    return parent.dispatch({...options,headersTimeout:parsed.data,bodyTimeout:parsed.data},handler);
  }} satisfies AiRequestDispatcher};
}
