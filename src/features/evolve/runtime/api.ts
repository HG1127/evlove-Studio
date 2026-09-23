import {
  ArtifactRoleSchema,
  IntakeAiResultSchema,
  SourceArtifactSchema,
  type AiOperation,
  type ArtifactRole,
  type IntakeAiResult,
  type SourceArtifact,
} from "@evolution/contracts";
import type {AiAttemptNotice} from "../ai/service";
import type {ProjectAiProfile} from "../schemas";
import {
  CandidateArtifactBuildError,
  getRunnerStatus,
  ingestSources as ingestLocalSources,
  retryFailedExperimentCases,
  runAi as runLocalAi,
  runBaseline,
  runExperiment,
  runIntake as runLocalIntake,
  runIntakeFromArtifacts as runLocalIntakeFromArtifacts,
  runRelease,
  runValidation,
} from "./run-local";
import {runServerAiOperation,ServerAiUnavailableError} from "./server-ai-client";
import {ingestSourcesOnServer,ServerParseUnavailableError} from "./server-source-client";
import {productionRuntimeMode} from "./production-runtime";

/**
 * Client compatibility surface.
 * Production/server-capable environments use the backend AI gateway first.
 * Browser BYOK remains a truthful offline fallback when the backend AI is unavailable.
 * Production never substitutes Demo AI for a missing live route; arbitrary semantic/server errors are not hidden.
 */
export async function runAi<T>(
  operation:AiOperation,
  payload:unknown,
  onAttemptNotice?:(notice:AiAttemptNotice)=>void,
):Promise<T>{
  if(productionRuntimeMode()==="local")return runLocalAi<T>(operation,payload,onAttemptNotice);
  try{
    return await runServerAiOperation<T>(operation,payload);
  }catch(error){
    if(!(error instanceof ServerAiUnavailableError))throw error;
    onAttemptNotice?.({
      kind:"retry",
      model:"local-fallback",
      message:"Server AI 当前不可用或浏览器尚未接入可信身份，降级到本地/BYOK 路由。",
    });
    return runLocalAi<T>(operation,payload,onAttemptNotice);
  }
}

export async function ingestSources(args:{
  files?:File[];
  text?:string;
  role?:"target"|"reference"|"eval";
}):Promise<SourceArtifact[]>{
  if(productionRuntimeMode()==="local")return ingestLocalSources(args);
  try{
    return await ingestSourcesOnServer(args);
  }catch(error){
    if(!(error instanceof ServerParseUnavailableError))throw error;
    return ingestLocalSources(args);
  }
}

function compactArtifactForIntake(artifact:SourceArtifact){
  const text=artifact.textContent??"";
  return {
    ...artifact,
    textContent:undefined,
    textExcerpt:(text||artifact.textExcerpt||"").slice(0,8_000),
  };
}

export async function runIntakeFromArtifacts(args:{
  command:string;
  artifacts:SourceArtifact[];
  department?:string;
  requestedObjectType?:string;
  conversation?:unknown;
  aiProfile?:ProjectAiProfile;
  pastedText?:string;
}):Promise<{intake:IntakeAiResult;artifacts:SourceArtifact[];provider:{provider:string;live:boolean;model:string}}>{
  const command=args.command.trim();
  const artifacts=args.artifacts.map((artifact)=>SourceArtifactSchema.parse(artifact));
  if(!command&&!artifacts.length)throw new Error("请上传需要进化的内容，或告诉 AI 你希望怎么进化");
  if(productionRuntimeMode()==="local")return runLocalIntakeFromArtifacts(args);
  try{
    const intake=IntakeAiResultSchema.parse(await runServerAiOperation<IntakeAiResult>("intake",{
      command,
      pastedText:(args.pastedText??"").slice(0,8_000),
      department:args.department??"其他",
      requestedObjectType:args.requestedObjectType??"auto",
      conversation:args.conversation,
      aiProfile:args.aiProfile,
      artifacts:artifacts.map(compactArtifactForIntake),
    }));
    const summaryMap=new Map(intake.artifactSummaries.map((item)=>[item.artifactId,item]));
    const enriched=artifacts.map((artifact)=>{
      const summary=summaryMap.get(artifact.id);
      return SourceArtifactSchema.parse({...artifact,summary:summary?.summary,role:summary?.detectedRole??artifact.role});
    });
    return {intake,artifacts:enriched,provider:{provider:"server-ai",live:true,model:"server"}};
  }catch(error){
    if(!(error instanceof ServerAiUnavailableError))throw error;
    return runLocalIntakeFromArtifacts(args);
  }
}

function intakeRoles(value:FormDataEntryValue|null,count:number):ArtifactRole[]{
  try{
    const parsed=JSON.parse(String(value??"[]"));
    if(!Array.isArray(parsed))throw new Error("invalid roles");
    return Array.from({length:count},(_,index)=>ArtifactRoleSchema.catch(index===0?"target":"reference").parse(parsed[index]));
  }catch{
    return Array.from({length:count},(_,index)=>index===0?"target":"reference");
  }
}

export async function runIntake(formData:FormData):Promise<{intake:IntakeAiResult;artifacts:SourceArtifact[];provider:{provider:string;live:boolean;model:string}}>{
  const command=String(formData.get("command")??"").trim();
  const pastedText=String(formData.get("pastedText")??"").trim();
  const files=formData.getAll("files").filter((value):value is File=>value instanceof File);
  if(!command&&!pastedText&&!files.length)throw new Error("请上传需要进化的内容，并告诉 AI 你希望怎么进化");
  let aiProfile:ProjectAiProfile|undefined;
  try{
    const raw=String(formData.get("aiProfile")??"");
    if(raw)aiProfile=JSON.parse(raw) as ProjectAiProfile;
  }catch{
    aiProfile=undefined;
  }
  if(productionRuntimeMode()==="local")return runLocalIntake(formData);
  try{
    const artifacts=await ingestSourcesOnServer({
      files,
      text:pastedText,
      role:"target",
      roles:intakeRoles(formData.get("roles"),files.length),
    });
    return runIntakeFromArtifacts({
      command,
      artifacts,
      department:String(formData.get("department")??"其他"),
      requestedObjectType:String(formData.get("requestedObjectType")??"auto"),
      conversation:String(formData.get("conversation")??""),
      aiProfile,
      pastedText,
    });
  }catch(error){
    if(!(error instanceof ServerParseUnavailableError))throw error;
    const artifacts=await ingestLocalSources({
      files,
      text:pastedText,
      role:"target",
      roles:intakeRoles(formData.get("roles"),files.length),
    });
    return runIntakeFromArtifacts({
      command,
      artifacts,
      department:String(formData.get("department")??"其他"),
      requestedObjectType:String(formData.get("requestedObjectType")??"auto"),
      conversation:String(formData.get("conversation")??""),
      aiProfile,
      pastedText,
    });
  }
}

export {
  CandidateArtifactBuildError,
  getRunnerStatus,
  retryFailedExperimentCases,
  runBaseline,
  runExperiment,
  runRelease,
  runValidation,
};
