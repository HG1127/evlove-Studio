import {HTML_NATIVE_PAYMENT_REQUIRED,HtmlNativeRunProofSchema,OriginalArtifactReferenceProofSchema,type Candidate,type EvolveProject,type OriginalArtifactReferenceProof,type TargetRunResult,type TestCase} from "@evolution/contracts";
import {htmlNativeCaseSource,inspectHtmlNativeEvidence} from "@evolution/core";
import {indexUniqueBatchResults} from "./server-batch-results";

export type ServerHtmlNativePort={
  executeNativeHtmlBatch?(args:{project:EvolveProject;testCases:TestCase[];candidate?:Candidate}):Promise<TargetRunResult[]>;
};

function matchesLockedOriginal(run:TargetRunResult,references:OriginalArtifactReferenceProof[],missionId:string){
  const parsed=HtmlNativeRunProofSchema.safeParse(run.nativeHtmlProof);
  if(!parsed.success)return false;
  const proof=parsed.data;
  const matches=references.filter(item=>item.sourceArtifactId===proof.sourceArtifactId);
  if(matches.length!==1)return false;
  const reference=OriginalArtifactReferenceProofSchema.safeParse(matches[0]);
  return reference.success&&reference.data.missionId===missionId
    &&reference.data.sha256===proof.observation.original.sha256;
}

function unavailableOriginalReference(run:TargetRunResult):TargetRunResult{
  return {testCaseId:run.testCaseId,output:"UNVERIFIED: 原生 HTML 原版观察没有绑定本次 Baseline 的唯一物理原文件引用。",
    verificationStatus:"unverified",error:"NATIVE_HTML_ORIGINAL_REFERENCE_MISMATCH",latencyMs:run.latencyMs,cost:0,trace:[]};
}

/** Recheck stored receipts before reuse; matching cache digests do not prove their Original binding. */
export function serverHtmlNativeRunsMatchOriginal(project:EvolveProject,runs:TargetRunResult[],candidate?:Candidate,testCases:TestCase[]=project.evalSuite){
  return runs.every(run=>{
    if(!run.nativeHtmlProof)return true;
    const parsed=HtmlNativeRunProofSchema.safeParse(run.nativeHtmlProof);
    if(!parsed.success)return false;
    const sourceId=parsed.data.sourceArtifactId;
    const tests=testCases.filter(test=>test.id===run.testCaseId),test=tests.length===1?tests[0]:undefined;
    if(!test||!htmlNativeCaseSource(project,test))return false;
    const sources=project.sourceArtifacts.filter(source=>source.role==="target"&&source.id===sourceId);
    const snapshots=candidate?.artifactSnapshots.filter(snapshot=>snapshot.sourceArtifactId===sourceId);
    const frozen=snapshots?.length===1?snapshots[0]?.frozenArtifact:undefined;
    const sha=candidate?(frozen?.sourceArtifactId===sourceId?frozen.sha256:undefined):parsed.data.observation.original.sha256;
    return sources.length===1&&Boolean(sha)&&matchesLockedOriginal(run,project.baselineRun.originalReferences??[],project.id)
      &&inspectHtmlNativeEvidence(run,run.testCaseId,sourceId,sha,test.browserSteps)?.complete===true;
  });
}

/** A missing/unknown profile leaves the existing executor in charge. Invalid returned receipts never strengthen evidence. */
export async function collectServerHtmlNativeRuns(project:EvolveProject,testCases:TestCase[],ports:ServerHtmlNativePort,candidate?:Candidate,onExecutionFailure?:(error:unknown)=>void){
  const eligible=testCases.filter(test=>htmlNativeCaseSource(project,test)
    &&(candidate||!test.criterionIds.includes("SYS-PAIRWISE")));
  const ordered=new Map<string,TargetRunResult>();
  if(!eligible.length||!ports.executeNativeHtmlBatch)return ordered;
  let results:TargetRunResult[];
  try{results=await ports.executeNativeHtmlBatch({project,testCases:eligible,candidate});}catch(error){onExecutionFailure?.(error);return ordered;}
  const {byId,duplicateIds}=indexUniqueBatchResults(results);
  for(const test of eligible){
    const run=byId.get(test.id);
    if(!run&&!duplicateIds.has(test.id))continue;
    const source=htmlNativeCaseSource(project,test)!;
    const snapshots=candidate?.artifactSnapshots.filter(snapshot=>snapshot.sourceArtifactId===source.id);
    const frozen=snapshots?.length===1?snapshots[0]?.frozenArtifact:undefined;
    const sha=candidate&&frozen?.sourceArtifactId===source.id?frozen.sha256:undefined;
    if(!duplicateIds.has(test.id)&&run?.error===HTML_NATIVE_PAYMENT_REQUIRED&&run.verificationStatus==="unverified"
      &&!run.nativeHtmlProof&&typeof run.artifactHash==="string"&&/^[a-f0-9]{64}$/.test(run.artifactHash)
      &&(!candidate||Boolean(sha)&&run.artifactHash===sha)){
      ordered.set(test.id,{testCaseId:test.id,artifactHash:run.artifactHash,verificationStatus:"unverified",error:HTML_NATIVE_PAYMENT_REQUIRED,
        output:"UNVERIFIED: 隔离执行需要付费或恢复免费额度；停止依赖执行与评分，不自动升级。",latencyMs:run.latencyMs,cost:0,trace:[]});
      continue;
    }
    const proof=run&&inspectHtmlNativeEvidence(run,test.id,source.id,sha,test.browserSteps);
    if(!duplicateIds.has(test.id)&&proof?.complete&&(candidate?Boolean(sha):proof.proof.observation.original.sha256===proof.proof.subjectSha256)){
      ordered.set(test.id,candidate&&!matchesLockedOriginal(run!,project.baselineRun.originalReferences??[],project.id)
        ?unavailableOriginalReference(run!):run!);
    }
    else ordered.set(test.id,{testCaseId:test.id,output:"UNVERIFIED: 原生 HTML 执行证据不完整、重复或文件身份不匹配。",
      verificationStatus:"unverified",error:"NATIVE_HTML_EVIDENCE_INVALID",latencyMs:run?.latencyMs??0,cost:0,trace:[]});
  }
  return ordered;
}

/** Preserve existing observations; unstarted dependent cases remain unknown, never failed products. */
export function serverHtmlNativePaymentBlockedRuns(testCases:TestCase[],ordered:Map<string,TargetRunResult>){
  if(![...ordered.values()].some(run=>run.error===HTML_NATIVE_PAYMENT_REQUIRED))return undefined;
  return testCases.map(test=>ordered.get(test.id)??{testCaseId:test.id,verificationStatus:"unverified" as const,error:HTML_NATIVE_PAYMENT_REQUIRED,
    output:"UNVERIFIED: 本轮必要隔离执行需要付费或恢复免费额度，依赖步骤尚未执行。",latencyMs:0,cost:0,trace:[]});
}

export function assertServerHtmlNativePaymentAvailable(runs:TargetRunResult[]){
  if(runs.some(run=>run.error===HTML_NATIVE_PAYMENT_REQUIRED))throw Object.assign(new Error("必要隔离执行需要付费或恢复免费额度；冻结文件与原观察已保留，尚未进行本轮评分。"),{code:HTML_NATIVE_PAYMENT_REQUIRED});
}

export function bindServerHtmlNativeOriginalReferences(runs:Map<string,TargetRunResult>,references:OriginalArtifactReferenceProof[],missionId:string){
  for(const [id,run] of runs){
    if(!run.nativeHtmlProof)continue;
    if(!matchesLockedOriginal(run,references,missionId)||run.nativeHtmlProof.subjectSha256!==run.nativeHtmlProof.observation.original.sha256)
      runs.set(id,unavailableOriginalReference(run));
  }
}
