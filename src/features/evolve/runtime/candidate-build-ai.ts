import {runEvolveAi,type AiAttemptNotice} from "../ai/service";
import {productionRuntimeMode} from "./production-runtime";
import {runServerAiOperation,ServerAiUnavailableError} from "./server-ai-client";
/** Compatibility composition: use the configured backend, with a real BYOK route as fallback. */
export async function runCandidateBuildAi(payload:unknown,signal:AbortSignal,onNotice?:(notice:AiAttemptNotice)=>void){
  signal.throwIfAborted();
  if(productionRuntimeMode()!=="local"){
    try{return await runServerAiOperation("build-candidate",payload,{signal});}
    catch(error){
      signal.throwIfAborted();
      if(!(error instanceof ServerAiUnavailableError))throw error;
      onNotice?.({kind:"retry",model:"BYOK",message:error.message});
    }
  }
  return runEvolveAi("build-candidate",payload,undefined,onNotice,{signal,requireLive:productionRuntimeMode()!=="local"});
}
