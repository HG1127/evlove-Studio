import type {Candidate,EvolveProject,OriginalArtifactReferenceProof,TargetRunResult,TestCase} from "@evolution/contracts";
import {htmlNativeCaseSource,inspectHtmlNativeEvidence} from "@evolution/core";
import {indexUniqueBatchResults} from "./server-batch-results";

export type ServerHtmlNativePort={
  executeNativeHtmlBatch?(args:{project:EvolveProject;testCases:TestCase[];candidate?:Candidate}):Promise<TargetRunResult[]>;
};

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
    const sha=candidate?(snapshots?.length===1?snapshots[0]?.frozenArtifact?.sha256:undefined):undefined;
    const proof=run&&inspectHtmlNativeEvidence(run,test.id,source.id,sha);
    if(!duplicateIds.has(test.id)&&proof?.complete&&(candidate?Boolean(sha):proof.proof.observation.original.sha256===proof.proof.subjectSha256))ordered.set(test.id,run!);
    else ordered.set(test.id,{testCaseId:test.id,output:"UNVERIFIED: 原生 HTML 执行证据不完整、重复或文件身份不匹配。",
      verificationStatus:"unverified",error:"NATIVE_HTML_EVIDENCE_INVALID",latencyMs:run?.latencyMs??0,cost:0,trace:[]});
  }
  return ordered;
}

export function bindServerHtmlNativeOriginalReferences(runs:Map<string,TargetRunResult>,references:OriginalArtifactReferenceProof[],missionId:string){
  for(const [id,run] of runs){
    if(!run.nativeHtmlProof)continue;
    const proof=run.nativeHtmlProof,matches=references.filter(item=>item.sourceArtifactId===proof.sourceArtifactId);
    if(matches.length!==1||matches[0]!.missionId!==missionId||matches[0]!.sha256!==proof.subjectSha256||matches[0]!.sha256!==proof.observation.original.sha256)
      runs.set(id,{testCaseId:id,output:"UNVERIFIED: 原生 HTML 原版观察没有绑定本次 Baseline 的唯一物理原文件引用。",
        verificationStatus:"unverified",error:"NATIVE_HTML_ORIGINAL_REFERENCE_MISMATCH",latencyMs:run.latencyMs,cost:0,trace:[]});
  }
}
