import {HtmlNativeRunProofSchema,OriginalArtifactReferenceProofSchema,type Candidate,type EvolveProject,type OriginalArtifactReferenceProof,type TargetRunResult,type TestCase} from "@evolution/contracts";
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
export async function collectServerHtmlNativeRuns(project:EvolveProject,testCases:TestCase[],ports:ServerHtmlNativePort,candidate?:Candidate){
  const eligible=testCases.filter(test=>htmlNativeCaseSource(project,test)
    &&(candidate||!test.criterionIds.includes("SYS-PAIRWISE")));
  const ordered=new Map<string,TargetRunResult>();
  if(!eligible.length||!ports.executeNativeHtmlBatch)return ordered;
  let results:TargetRunResult[];
  try{results=await ports.executeNativeHtmlBatch({project,testCases:eligible,candidate});}catch{return ordered;}
  const {byId,duplicateIds}=indexUniqueBatchResults(results);
  for(const test of eligible){
    const run=byId.get(test.id);
    if(!run&&!duplicateIds.has(test.id))continue;
    const source=htmlNativeCaseSource(project,test)!;
    const snapshots=candidate?.artifactSnapshots.filter(snapshot=>snapshot.sourceArtifactId===source.id);
    const frozen=snapshots?.length===1?snapshots[0]?.frozenArtifact:undefined;
    const sha=candidate&&frozen?.sourceArtifactId===source.id?frozen.sha256:undefined;
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

export function bindServerHtmlNativeOriginalReferences(runs:Map<string,TargetRunResult>,references:OriginalArtifactReferenceProof[],missionId:string){
  for(const [id,run] of runs){
    if(!run.nativeHtmlProof)continue;
    if(!matchesLockedOriginal(run,references,missionId)||run.nativeHtmlProof.subjectSha256!==run.nativeHtmlProof.observation.original.sha256)
      runs.set(id,unavailableOriginalReference(run));
  }
}
