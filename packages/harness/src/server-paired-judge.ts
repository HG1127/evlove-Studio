import {PAIRED_JUDGE_POLICY,PAIRED_JUDGE_FILE_METADATA_POLICY,PairedJudgeRequestSchema,PairedJudgeReceiptSchema,type AcceptanceCriterion,type Candidate,type EvolveProject,type ServerEvidenceJudgeResult,type TargetRunResult,type TestCase} from "@evolution/contracts";
import {fastHash,pairedJudgeFileMetadata,qualifyPairedEvaluation,settleAiEvaluation,inspectHtmlNativeEvidence} from "@evolution/core";
import {measuredDocumentObservations,SERVER_MEASURED_REVIEW_VERSION} from "./server-measured-review-evidence";
import {compactExperimentRunOutput} from "./server-experiment-evidence";

export function serverPairedJudgeRequest(project:EvolveProject,candidate:Candidate,suite:TestCase[],criteria:AcceptanceCriterion[],runs:TargetRunResult[],originalRuns:TargetRunResult[],phase:"visible"|"holdout"){
  const targets=project.sourceArtifacts.filter(s=>s.role==="target"),refs=project.baselineRun.originalReferences??[];
  const withMetadata=project.experimentPolicy.judgeFileMetadata===PAIRED_JUDGE_FILE_METADATA_POLICY;
  if(project.searchChampion)throw Error("paired-two-order-v1 requires the recorded Original-source baseline; a Champion parent needs a separately bound comparison protocol");
  if(project.targetConnection.adapter!=="artifact"||!targets.length||new Set(targets.map(s=>s.id)).size!==targets.length)throw Error("Paired review requires unique stored Artifact targets");
  for(const arm of [runs,originalRuns])if(arm.length!==suite.length||new Set(arm.map(r=>r.testCaseId)).size!==arm.length||suite.some(t=>!arm.some(r=>r.testCaseId===t.id)))throw Error("Paired review requires both complete same-paper run identities");
  const bindings=targets.map(source=>{
    const originals=refs.filter(r=>r.sourceArtifactId===source.id&&r.missionId===project.id),snapshots=candidate.artifactSnapshots.filter(s=>s.sourceArtifactId===source.id);
    if(originals.length!==1||snapshots.length!==1||!snapshots[0]!.frozenArtifact)throw Error("Paired review physical source identity unavailable");
    const original=originals[0]!,frozen=snapshots[0]!.frozenArtifact!;
    if(frozen.sourceArtifactId!==source.id)throw Error("Paired review frozen source identity differs");
    return {sourceArtifactId:source.id,originalSha256:original.sha256,candidateSha256:frozen.sha256,
      ...(withMetadata?{fileMetadata:pairedJudgeFileMetadata(source,original,frozen)}:{})};
  });
  const bothRendered=[{arm:originalRuns,candidateArm:false},{arm:runs,candidateArm:true}].every(({arm,candidateArm})=>bindings.every(binding=>arm.some(run=>{
    if(run.error||run.verificationStatus!=="verified")return false;
    const proof=inspectHtmlNativeEvidence(run,run.testCaseId,binding.sourceArtifactId,candidateArm?binding.candidateSha256:binding.originalSha256);
    return proof?.complete&&proof.proof.observation.original.sha256===binding.originalSha256;
  })));
  const packet=(arm:TargetRunResult[],candidateArm:boolean)=>({
    ...(withMetadata?{files:bindings.map(b=>({sourceArtifactId:b.sourceArtifactId,sha256:candidateArm?b.candidateSha256:b.originalSha256,...b.fileMetadata![candidateArm?"candidate":"original"]}))}:{}),
    documents:measuredDocumentObservations(bothRendered?arm.filter(run=>run.nativeHtmlProof):arm,undefined,bindings.map(b=>({sourceArtifactId:b.sourceArtifactId,subjectSha256:candidateArm?b.candidateSha256:b.originalSha256,originalSha256:b.originalSha256}))),
    runs:arm.map(run=>{const test=suite.find(t=>t.id===run.testCaseId)!;return {testCaseId:run.testCaseId,verificationStatus:run.verificationStatus,
      outputChunks:[compactExperimentRunOutput(run.output,`${test.title} ${test.input} ${test.expected.join(" ")}`)],
      trace:run.trace.slice(0,12).map(step=>({stage:step.stage,status:step.status,summary:step.summary}))};}),
  });
  const value=PairedJudgeRequestSchema.parse(JSON.parse(JSON.stringify({context:{protocol:PAIRED_JUDGE_POLICY,missionId:project.id,candidateId:candidate.id,phase,
    inputFingerprint:"pending",rubricFingerprint:fastHash(project.acceptanceRubric),suiteFingerprint:fastHash(suite),testCaseIds:suite.map(t=>t.id),criterionIds:criteria.map(c=>c.id),bindings,
    ...(withMetadata?{fileMetadataPolicy:PAIRED_JUDGE_FILE_METADATA_POLICY}:{})},
    criteria,testCases:suite,goal:project.goal,metrics:project.metrics,versions:{original:packet(originalRuns,false),candidate:packet(runs,true)}})));
  const {inputFingerprint:_,...context}=value.context;void _;
  value.context.inputFingerprint=fastHash({...value,context});return value;
}

export function settleServerPairedJudgment(project:EvolveProject,suite:TestCase[],runs:TargetRunResult[],originalRuns:TargetRunResult[],request:ReturnType<typeof serverPairedJudgeRequest>,ai:ServerEvidenceJudgeResult){
  const paired=ai.pairedComparison,receipt=PairedJudgeReceiptSchema.parse(paired?.receipt);
  const {samples:_,limitations:__,scoringRouteFingerprint:___,...context}=receipt;void _;void __;void ___;
  if(!paired||JSON.stringify(context)!==JSON.stringify(request.context))throw Error("Paired runtime receipt does not match the issued request");
  const settle=(arm:TargetRunResult[],value:typeof paired.original)=>qualifyPairedEvaluation({...settleAiEvaluation({criteria:project.acceptanceRubric,testCases:suite,runs:arm,ai:value,
    notes:["paired-two-order-v1: both versions judged together twice with swapped order; each criterion retains its least-favorable observed pair. No thresholds or physical runs changed."]}),measuredReviewVersion:SERVER_MEASURED_REVIEW_VERSION},receipt,project.acceptanceRubric);
  return {...settle(runs,ai),judgeComparison:{baseline:settle(originalRuns,paired.original),receipt}};
}
