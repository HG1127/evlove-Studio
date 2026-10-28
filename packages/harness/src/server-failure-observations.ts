import {EvolveProjectSchema,FailureObservationSourcesSchema,VisibleFailureObservationsSchema,FAILURE_OBSERVATION_CONTEXT_VERSION,
  type Candidate,type CandidateArtifactSnapshot,type EvolveProject,type VisibleFailureObservations} from "@evolution/contracts";
import {htmlPlanningDocument,visibleFailureObservationFacts} from "@evolution/core";
import {fingerprintServerExperimentRecord,hasCompleteServerExperimentFrozenSet,serverExperimentBuildCheckpoint} from "./server-experiment-recovery";
import {retrieveTextContext} from "./context-retrieval";

export type ServerFailureObservationPorts={
  readSourceMission(id:string):Promise<unknown>;
  fingerprintText(text:string):Promise<string>;
  verifyFrozenSnapshot(snapshot:CandidateArtifactSnapshot):Promise<boolean>;
  readExecutionArtifactFingerprint(args:{project:EvolveProject;candidate:Candidate;historicalDeploymentSha?:string}):Promise<string|undefined>;
  bodyAuthorized?(currentMissionId:string,sourceMissionId:string):boolean;
};
/** Explicit source commitments only. Never searches other Missions or calls a provider. */
export async function buildServerFailureObservations(project:EvolveProject,ports:ServerFailureObservationPorts,now=Date.now()){
  const refs=FailureObservationSourcesSchema.parse(project.failureObservationSources??[]);
  if(!refs.length)return undefined;
  const observations:VisibleFailureObservations["observations"]=[];
  for(const ref of refs){
    if(ref.missionId===project.id)throw Error("Historical failure source must not be the current mutable Mission");
    const source=EvolveProjectSchema.parse(await ports.readSourceMission(ref.missionId));
    if(source.id!==ref.missionId||await ports.fingerprintText(JSON.stringify(source))!==ref.missionSha256||source.experimentRun.id!==ref.experimentRunId)throw Error("Failure source Mission/record commitment differs");
    const facts=visibleFailureObservationFacts(source,ref.candidateId),candidate=facts.candidate;
    if(!hasCompleteServerExperimentFrozenSet(source,candidate))throw Error("Failure source lacks unique complete frozen Artifacts");
    const checkpoints=(source.experimentRun.executionCheckpoints??[]).filter(c=>c.candidateId===candidate.id);
    const checkpoint=checkpoints.length===1?checkpoints[0]:undefined,execution=checkpoint?.execution;
    // Completed campaigns clear their scheduler checkpoint. The declared historical
    // round is accepted only if it reproduces the stored cryptographic build binding.
    const historical={...source,campaign:{...source.campaign,checkpoint:{round:ref.round,completedPhase:"experiment" as const,at:source.updatedAt}}};
    const built=await serverExperimentBuildCheckpoint(historical,candidate,{fingerprint:ports.fingerprintText});
    if(!checkpoint||!execution||!built||built.buildInputFingerprint!==checkpoint.buildInputFingerprint||built.artifactFingerprint!==checkpoint.artifactFingerprint
      ||!execution.artifactFingerprint||!execution.inputFingerprint||execution.observedAt>now
      ||JSON.stringify(execution.runs)!==JSON.stringify(facts.result.runs)
      ||execution.evidenceFingerprint!==await fingerprintServerExperimentRecord({runs:execution.runs,observedAt:execution.observedAt},ports.fingerprintText))throw Error("Failure source lacks a bound Visible execution receipt");
    for(const snapshot of candidate.artifactSnapshots)if(!await ports.verifyFrozenSnapshot(snapshot))throw Error("Failure source frozen Artifact readback failed");
    if(execution.artifactFingerprint!==await ports.readExecutionArtifactFingerprint({project:{...source,baselineRun:facts.baseline},candidate,historicalDeploymentSha:ref.executionDeploymentSha}))throw Error("Failure execution physical binding differs");
    const originals=facts.baseline.originalReferences??[],artifacts=candidate.artifactSnapshots.map(snapshot=>{
      const matches=originals.filter(r=>r.missionId===source.id&&r.sourceArtifactId===snapshot.sourceArtifactId);
      if(matches.length!==1)throw Error("Failure source Original reference is missing or ambiguous");
      return {sourceArtifactId:snapshot.sourceArtifactId,snapshotId:snapshot.id,sha256:snapshot.frozenArtifact!.sha256,originalSha256:matches[0]!.sha256};
    });
    const originalText:VisibleFailureObservations["observations"][number]["originalText"]=[],candidateText:typeof originalText=[];
    if(ports.bodyAuthorized?.(project.id,source.id)){
      const query=[source.goal,source.evolutionCommand,...facts.comparisons.map(c=>c.title)].join("\n");
      const budget=Math.min(48_000,Math.floor(120_000/refs.length/2/Math.max(1,artifacts.length)));
      for(const snapshot of candidate.artifactSnapshots){
        const artifact=source.sourceArtifacts.find(a=>a.id===snapshot.sourceArtifactId)!,manifest=artifacts.find(a=>a.snapshotId===snapshot.id)!;
        const html=/^html?$/i.test(artifact.extension)||/^text\/html(?:;|$)/i.test(snapshot.mimeType);
        const projectText=(raw:string)=>html?htmlPlanningDocument(raw)?.text:raw;
        const candidateBody=projectText(snapshot.content);if(candidateBody===undefined)throw Error("Failure HTML has no safe body projection");
        const content=retrieveTextContext(candidateBody,query,{maxChars:budget,maxChunks:6});
        candidateText.push({sourceArtifactId:artifact.id,snapshotId:snapshot.id,name:snapshot.name,mimeType:snapshot.mimeType,physicalSha256:manifest.sha256,
          representation:html?"html-body-text":"snapshot-text",binding:"verified-snapshot-text",content,availableChars:candidateBody.length,complete:content===candidateBody});
        const raw=artifact.textContent??"",bound=await ports.fingerprintText(raw)===manifest.originalSha256;
        const originalBody=html&&!bound?undefined:projectText(raw),text=originalBody===undefined?"":retrieveTextContext(originalBody,query,{maxChars:budget,maxChunks:6});
        originalText.push({sourceArtifactId:artifact.id,name:artifact.name,mimeType:artifact.mimeType,physicalSha256:manifest.originalSha256,
          representation:originalBody===undefined?"unavailable":html?"html-body-text":"parsed-source-text",binding:originalBody===undefined?"unavailable":bound?"verified-original-text":"parsed-index",
          content:text,availableChars:originalBody?.length??0,complete:bound&&originalBody!==undefined&&text===originalBody});
      }
    }
    const after=EvolveProjectSchema.parse(await ports.readSourceMission(ref.missionId));
    if(await ports.fingerprintText(JSON.stringify(after))!==ref.missionSha256)throw Error("Failure source changed during readback");
    observations.push({source:ref,grade:"measured-visible-failure",sourceGoal:source.goal,sourceCommand:source.evolutionCommand,observedAt:execution.observedAt,
      executionEvidenceFingerprint:execution.evidenceFingerprint,artifacts,comparisons:facts.comparisons,failureCriterionIds:facts.failureCriterionIds,
      unpairedCriterionIds:facts.unpairedCriterionIds,completeUserGoalDelta:facts.completeUserGoalDelta,originalText,candidateText});
  }
  return VisibleFailureObservationsSchema.parse({schemaVersion:FAILURE_OBSERVATION_CONTEXT_VERSION,missionId:project.id,observations,
    limitations:["Retrospective persisted Visible comparisons bound to source Mission, execution and physical artifacts; they are not current-task evidence or Verified Skills.",
      "Only exact paired verified criteria are reported. Missing/partial measurements remain unknown. Body projections require explicit current/source Mission authorization; incomplete text is labelled.",
      "No independent-final or ordinary Hidden questions, runs, verdicts, raw snapshots/patches, scripts/styles, connectors or credentials are included.",
      "Past failure does not establish causation or transfer. Plan a new falsifiable change and independently verify every unchanged current goal and gate."]});
}
