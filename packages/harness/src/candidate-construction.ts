import {CandidateConstructionFailureSchema,type BuildCandidateAiResult,type CandidateConstructionFailure} from "@evolution/contracts";

/** This type is raised only for validated output faults, never I/O or source identity failures. */
export class CandidateConstructionOutputError extends Error{
 readonly failure:CandidateConstructionFailure;
 constructor(code:CandidateConstructionFailure["code"],message:string,options?:ErrorOptions){
  const failure=CandidateConstructionFailureSchema.parse({version:"candidate-construction-failure-v1",code,message:message.slice(0,4000)});
  super(failure.message,options);this.name="CandidateConstructionOutputError";this.failure=failure;
 }
}
export function checkCandidateConstructionOutput<T>(code:CandidateConstructionFailure["code"],action:()=>T):T{
 try{return action();}catch(error){if(error instanceof CandidateConstructionOutputError)throw error;throw new CandidateConstructionOutputError(code,error instanceof Error?error.message:"候选成果内容无效",{cause:error});}
}

/** One bounded content repair; provider/source/storage failures escape without regeneration. */
export async function runCandidateConstruction<T>(ports:{
 initial:()=>Promise<BuildCandidateAiResult>;
 prepare:(output:BuildCandidateAiResult,attempt:0|1)=>Promise<T>;
 recover:(args:{attempt:1;failure:CandidateConstructionFailure;previousOutput:BuildCandidateAiResult})=>Promise<BuildCandidateAiResult>;
}):Promise<T>{
 const first=await ports.initial();
 let failure:CandidateConstructionFailure;
 try{return await ports.prepare(first,0);}catch(error){if(!(error instanceof CandidateConstructionOutputError))throw error;failure=error.failure;}
 const recovered=await ports.recover({attempt:1,failure,previousOutput:first});
 try{return await ports.prepare(recovered,1);}catch(error){
  if(!(error instanceof CandidateConstructionOutputError))throw error;
  throw Object.assign(new Error(`实际文件构造失败：首次 ${failure.message}；定向修复后 ${error.message}`,{cause:error}),{code:"CANDIDATE_CONSTRUCTION_RECOVERY_FAILED",initialFailure:failure,recoveryFailure:error.failure});
 }
}

/** Verified offsets refer to the actual complete parent, never retrieved chunk positions. */
export function verifiedCandidateTextAnchors(source:string,hints:string[],options?:{maxChars:number}){
 let remaining=Math.max(0,options?.maxChars??2000);
 return [...new Set(hints)].filter(text=>text.length>0&&text.length<=6000).flatMap(text=>{
  if(text.length>remaining)return [];
  const start=source.indexOf(text);if(start<0||source.indexOf(text,start+1)>=0)return [];remaining-=text.length;return [{start,end:start+text.length,text}];
 }).slice(0,8);
}
