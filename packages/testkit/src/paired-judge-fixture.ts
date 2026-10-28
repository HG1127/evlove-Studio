import {createHash} from "node:crypto";
import {EvaluateAiResultSchema,TestCaseSchema,type EvolveProject} from "@evolution/contracts";
import {failureObservationFixture} from "./failure-observation-fixture";

/** Synthetic stored-text pair for protocol tests. It is never real model, business or execution evidence. */
export function pairedJudgeFixture(){
  const x=failureObservationFixture(),project=x.source,candidate=x.candidate,source=project.sourceArtifacts[0]!,snapshot=candidate.artifactSnapshots[0]!;
  const hash=(text:string)=>createHash("sha256").update(text).digest("hex");
  source.name="original.md";source.extension="md";source.mimeType="text/markdown";source.textContent="Original measured body";source.size=Buffer.byteLength(source.textContent);
  snapshot.name="updated.md";snapshot.mimeType="text/markdown";snapshot.content="Updated measured body";snapshot.contentHash=hash(snapshot.content);
  snapshot.frozenArtifact={...snapshot.frozenArtifact!,mimeType:snapshot.mimeType,name:snapshot.name,sha256:snapshot.contentHash,snapshotHash:snapshot.contentHash,size:Buffer.byteLength(snapshot.content)};
  project.baselineRun.originalReferences=[{schemaVersion:"original-artifact-reference-v1",missionId:project.id,sourceArtifactId:source.id,blobId:source.id,sha256:hash(source.textContent),sizeBytes:source.size}];
  project.experimentPolicy.judgeComparison="paired-two-order-v1";
  project.acceptanceRubric[0]!.minScore=85;
  project.evalSuite=[TestCaseSchema.parse({...project.evalSuite[0],executionMode:"external-runner"})];
  project.hiddenEvalSuite=[TestCaseSchema.parse({...project.hiddenEvalSuite[0],executionMode:"external-runner"})];
  project.candidates=[candidate];project.selectedCandidateIds=[candidate.id];
  project.campaign.checkpoint={round:1,completedPhase:"plan",at:x.at};project.campaign.currentRound=0;project.campaign.status="running";
  project.gates=[{id:"experiment-ready",status:"approved",approvedAt:x.at}];
  project.experimentRun={id:"new-visible",status:"idle",candidateResults:[]};
  const makeRun=(id:string,body:string,sha256:string)=>({testCaseId:id,output:body,artifactHash:sha256,verificationStatus:"verified" as const,latencyMs:1,cost:0,trace:[]});
  const originalRuns=[makeRun("V1",source.textContent,hash(source.textContent))],candidateRuns=[makeRun("V1",snapshot.content,snapshot.frozenArtifact.sha256)];
  project.baselineRun.runs=originalRuns;project.baselineRun.status="completed";
  project.baselineRun.result={...project.baselineRun.result!,rubricScore:99,criterionScores:[{criterionId:"GOAL",score:99,pass:true,verificationStatus:"verified",evidence:[],gaps:[],testCaseIds:["V1"]}]};
  return {project:project as EvolveProject,candidate,originalRuns,candidateRuns,at:x.at};
}

export const pairedJudgeRawEvaluation=(score:number,caseId="V1")=>EvaluateAiResultSchema.parse({accuracy:score,evidence:score,riskCoverage:score,completeness:score,safety:"PASS",notes:[],failures:[],cases:[],
  criteria:[{criterionId:"GOAL",score,pass:score>=85,evidence:["observed synthetic body"],gaps:[],testCaseIds:[caseId]}]});
