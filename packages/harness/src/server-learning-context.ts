import {LEARNING_CONTEXT_VERSION,LessonDistillationContextSchema,type CandidateArtifactSnapshot,type EvolveProject,type LearningArtifactContext} from "@evolution/contracts";
import {evidenceFingerprint,htmlPlanningDocument,lessonDistillationSource,productionOutcomeFreshness,productionOutcomeTrend,projectHasLiveReleaseDecision,projectHasOnlineReleaseTarget} from "@evolution/core";
import {retrieveTextContext} from "./context-retrieval";
import {measuredDocumentObservations} from "./server-measured-review-evidence";

export type ServerLearningContextPorts={
  verifyFrozenSnapshot(snapshot:CandidateArtifactSnapshot):Promise<boolean>;
  fingerprintText(text:string):Promise<string>;
};
type Projection=LearningArtifactContext;

/** Bound projections, not serialization of live Domain objects. No source execution or AI call. */
export async function buildServerLessonContext(project:EvolveProject,ports:ServerLearningContextPorts,now=Date.now()){
  const source=lessonDistillationSource(project);
  if(!source)throw Error("Learning source lacks the exact Candidate / Validation binding");
  const {candidate,validation}=source,offline=!projectHasOnlineReleaseTarget(project);
  if(validation.status!=="completed"||validation.evaluation?.demoJudged||validation.evidenceFingerprint!==evidenceFingerprint(project,candidate))throw Error("Learning Validation is not bound to the current exact source inputs");
  if(!projectHasLiveReleaseDecision(project)&&!(offline&&project.artifactAcceptance.status==="passed"&&project.artifactAcceptance.candidateId===candidate.id))throw Error("Learning requires the existing accepted Artifact or live Release decision");
  const targets=project.sourceArtifacts.filter(a=>a.role==="target"),snapshots=candidate.artifactSnapshots;
  if(new Set(snapshots.map(s=>s.sourceArtifactId)).size!==snapshots.length||new Set(snapshots.map(s=>s.id)).size!==snapshots.length
    ||snapshots.some(s=>project.sourceArtifacts.filter(a=>a.id===s.sourceArtifactId).length!==1)
    ||offline&&(snapshots.length!==targets.length||targets.some(t=>!snapshots.some(s=>s.sourceArtifactId===t.id))))throw Error("Learning source requires unique complete Artifact identities");
  const query=[project.goal,project.evolutionCommand,candidate.change,...project.acceptanceRubric.map(c=>c.requirement)].join("\n");
  const projectText=(raw:string,html:boolean)=>{
    if(!html)return {text:raw,representation:"snapshot-text" as const};
    const body=htmlPlanningDocument(raw);if(!body)throw Error("Learning HTML needs complete physical body boundaries; raw programs cannot be a fallback");
    return {text:body.text,representation:"html-body-text" as const};
  };
  const candidateArtifacts:Projection[]=[],bindings:Array<{sourceArtifactId:string;subjectSha256:string;originalSha256?:string}>=[];
  for(const snapshot of snapshots){
    const artifact=project.sourceArtifacts.find(a=>a.id===snapshot.sourceArtifactId)!,ref=snapshot.frozenArtifact;
    if(offline&&!ref)throw Error("Accepted offline learning requires frozen Artifact receipts");
    if(ref&&(ref.sourceArtifactId!==snapshot.sourceArtifactId||!await ports.verifyFrozenSnapshot(snapshot)))throw Error("Learning frozen Artifact readback failed; no provider call is permitted");
    const contentHash=await ports.fingerprintText(snapshot.content);
    if(!/^[0-9a-f]{64}$/.test(contentHash)||ref&&(snapshot.contentHash&&snapshot.contentHash!==contentHash||ref.snapshotHash!==contentHash))throw Error("Learning Snapshot content hash differs");
    const projected=projectText(snapshot.content,/^html?$/i.test(artifact.extension)||/^text\/html(?:;|$)/i.test(snapshot.mimeType));
    const budget=Math.min(48_000,Math.floor(60_000/Math.max(1,snapshots.length))),content=retrieveTextContext(projected.text,query,{maxChars:budget,maxChunks:6});
    candidateArtifacts.push({sourceArtifactId:snapshot.sourceArtifactId,snapshotId:snapshot.id,name:snapshot.name,mimeType:snapshot.mimeType,
      representation:projected.representation,binding:ref?"frozen-snapshot":"snapshot-record",sha256:ref?.sha256,contentHash:snapshot.contentHash,snapshotTextSha256:contentHash,content,availableChars:projected.text.length,complete:content===projected.text});
    if(ref){const originals=(project.baselineRun.originalReferences??[]).filter(r=>r.missionId===project.id&&r.sourceArtifactId===snapshot.sourceArtifactId);
      bindings.push({sourceArtifactId:snapshot.sourceArtifactId,subjectSha256:ref.sha256,originalSha256:originals.length===1?originals[0]!.sha256:undefined});}
  }
  const sourceArtifacts:Projection[]=[];
  for(const artifact of project.sourceArtifacts){
    const raw=artifact.textContent||artifact.textExcerpt||"",html=/^html?$/i.test(artifact.extension)||/^text\/html(?:;|$)/i.test(artifact.mimeType);
    const bodyAvailable=!html||Boolean(htmlPlanningDocument(raw));
    const projected=raw&&bodyAvailable?projectText(raw,html):{text:"",representation:"parsed-source-text" as const};
    const refs=(project.baselineRun.originalReferences??[]).filter(r=>r.missionId===project.id&&r.sourceArtifactId===artifact.id),digest=raw?await ports.fingerprintText(raw):undefined;
    const bound=refs.length===1&&refs[0]!.sha256===digest;
    const budget=Math.min(48_000,Math.floor(60_000/Math.max(1,project.sourceArtifacts.length))),content=retrieveTextContext(projected.text,query,{maxChars:budget,maxChunks:6});
    sourceArtifacts.push({sourceArtifactId:artifact.id,name:artifact.name,mimeType:artifact.mimeType,representation:html?"html-body-text":"parsed-source-text",
      binding:bound?"baseline-original-text":"parsed-source",sha256:bound?digest:undefined,content,availableChars:projected.text.length,complete:bodyAvailable&&content===projected.text&&Boolean(artifact.textContent)});
  }
  const caseIds=new Set(project.hiddenEvalSuite.map(t=>t.id)),hashes=new Set(bindings.map(b=>b.subjectSha256));
  const runs=validation.runs.filter(run=>caseIds.has(run.testCaseId)&&run.artifactHash&&hashes.has(run.artifactHash));
  const measured=measuredDocumentObservations(runs,100_000,bindings);
  const {id,name,title,change,hypothesis,designRationale}=candidate;
  return LessonDistillationContextSchema.parse({schemaVersion:LEARNING_CONTEXT_VERSION,missionId:project.id,
    project:{goal:project.goal,command:project.evolutionCommand,protectedItems:project.protectedItems,editableItems:project.editableItems,acceptanceRubric:project.acceptanceRubric,metrics:project.metrics},
    winner:{id,name,title,change,hypothesis,designRationale},sourceArtifacts,candidateArtifacts,baseline:project.baselineRun.result,
    validation:{id:validation.id,candidateId:candidate.id,status:validation.status,evidenceFingerprint:validation.evidenceFingerprint,recommendation:validation.recommendation,evaluation:validation.evaluation,baselineEvaluation:validation.baselineEvaluation},
    measuredDocuments:{observations:measured.observations,omittedTestCaseIds:measured.omittedTestCaseIds,
      nativeSummaries:measured.nativeObservations.map(row=>({testCaseIds:row.testCaseIds,sourceArtifactId:row.facts.sourceArtifactId,originalSha256:row.facts.original.sha256,subjectSha256:row.facts.subject.sha256,kernelSha256:row.facts.kernelSha256,
        programSignature:row.facts.programSignature,styleSignature:row.facts.styleSignature,profilePass:row.facts.profilePass,originalHealthy:row.facts.originalHealthy,failedCheckCount:row.facts.subject.failedCheckCount,
        styleComparison:row.facts.styleComparison.map(s=>({width:s.width,pass:s.pass,missingGroupCount:s.missingGroupCount,changedNamedCount:s.changedNamedCount}))})),omittedNativeTestCaseIds:measured.omittedNativeTestCaseIds},
    release:{status:project.release.status,candidateId:project.release.candidateId,deploymentId:project.release.deploymentId,healthy:project.release.healthy,evidenceMode:project.release.evidenceMode,environment:project.release.environment,observedAt:project.release.observedAt,kpis:project.release.kpis},
    releaseFreshness:productionOutcomeFreshness(project,{now}),releaseTrend:productionOutcomeTrend(project,{now}),
    limitations:["HTML projections contain body text only; executable programs, styles, attributes and raw patches are excluded. Displayed code examples remain body evidence.",
      "Independent final questions, executions, scores and feedback are absent. Ordinary validation only; no raw runs, screenshots, credentials or connector configuration.",
      "Completeness applies to the available text projection, not unseen file bytes or runtime behavior. Parsed-source context without an Original hash binding remains unbound. Omitted observations remain unknown.",
      "Measured native facts are not semantic or business improvement verdicts. Acceptance and recorded token counters do not establish human benefit, actual money or causal Lesson transfer."]});
}
