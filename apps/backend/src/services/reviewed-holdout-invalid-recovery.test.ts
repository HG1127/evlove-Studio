// @vitest-environment node
import {beforeEach,describe,expect,it,vi} from "vitest";
import {reviewedHoldoutFixture} from "@evolution/testkit";
import {createEvolutionEvent,EvolutionJobSchema,ReviewedHoldoutRunInputSchema,ValidationRunSchema,type EvolveProject} from "@evolution/contracts";
import {StructuredAiJsonError} from "@evolution/adapters";
import {reviewedBinding,reviewedSha} from "./reviewed-holdout-identity";
import {certifyReviewedInvalidAttempt,previewReviewedInvalidRecovery} from "./reviewed-holdout-invalid-recovery";
import type {ReviewedSdkEvidence} from "./reviewed-holdout-sdk-evidence";
const m=vi.hoisted(()=>({runtime:vi.fn(),preview:vi.fn(),sdk:vi.fn()}));
vi.mock("./production-runtime",()=>({getServerProductionRuntime:m.runtime}));
vi.mock("./reviewed-holdout-admission",()=>({previewReviewedHoldout:m.preview}));
vi.mock("./reviewed-holdout-sdk-evidence",async original=>({...await original<typeof import("./reviewed-holdout-sdk-evidence")>(),readReviewedSdkEvidence:m.sdk}));
const actualSdk=await vi.importActual<typeof import("./reviewed-holdout-sdk-evidence")>("./reviewed-holdout-sdk-evidence");
async function fixture(){
 const p=reviewedHoldoutFixture().project,before=structuredClone(p),binding=reviewedBinding(p,"a".repeat(64),"b".repeat(64),"old-route");
 const input=ReviewedHoldoutRunInputSchema.parse({missionId:p.id,controlJobId:"old-job",controlOwnerKey:"workflow-control:synthetic:reviewed-holdout:old",requestedAt:p.updatedAt,approval:{schemaVersion:"reviewed-holdout-approval-v1",request:{binding,idempotencyKey:"old",humanReviewNote:"Human confirms exact Original REVIEW",preserveReview:true,preserveAcceptanceGates:true},actorId:"operator",actorSource:"browser-session",confirmedAt:p.updatedAt}});
 const approval=input.approval,job=EvolutionJobSchema.parse({schemaVersion:"job-v1",id:"old-job",missionId:p.id,type:"campaign",status:"running",label:"old",idempotencyKey:"workflow-control:synthetic:reviewed-holdout:old",outputRef:"old-run",generation:1,createdAt:p.updatedAt,updatedAt:p.updatedAt,metadata:{workflowIntent:"reviewed-holdout",reviewedApproval:approval,reviewedActorId:approval.actorId,requestSha256:reviewedSha(approval.request)}});
 const rawSdk:ReviewedSdkEvidence={runId:"old-run",deploymentId:"old-deployment",stepId:"private-step",input,output:{result:{missionId:p.id,controlJobId:job.id,status:"waiting-human",iterations:1,reason:"Retain failed pair"}}};
 const meta={runId:rawSdk.runId,stepId:rawSdk.stepId,stepName:actualSdk.REVIEWED_EXECUTE_STEP_ID,status:"completed",attempt:1};
 const sdk=await actualSdk.readReviewedSdkEvidence(rawSdk.runId,{run:async()=>({runId:rawSdk.runId,deploymentId:rawSdk.deploymentId,workflowName:actualSdk.REVIEWED_WORKFLOW_ID,status:"completed"}),page:async()=>({data:[meta],hasMore:false,cursor:null}),step:async()=>({...meta,input:[input],output:rawSdk.output})});
 const admission=createEvolutionEvent({id:'evt-'+job.id+'-reviewed-holdout-authorized',missionId:p.id,jobId:job.id,type:"MissionUpdated",source:"human-reviewed-holdout",payload:{approval,priorBaseline:before.baselineRun,priorValidation:before.validationRun,priorRecoveryWait:before.campaign.serverRecoveryWait,priorCheckpoint:before.campaign.checkpoint}});
 p.stage="validation";const runs=p.hiddenEvalSuite.map(t=>({testCaseId:t.id,output:"synthetic measured",latencyMs:1,cost:0,trace:[]}));
 p.validationRun=ValidationRunSchema.parse({id:"validation-server-r1",status:"failed",validationMode:"full",candidateId:p.experimentRun.winnerId,runs,baselineRuns:structuredClone(runs),baselineSuiteIds:runs.map(r=>r.testCaseId),checks:[],executionArtifactFingerprint:"a".repeat(64),executionEvidenceFingerprint:"a-1",error:"[server-campaign-holdout-judge-pending] Hidden 同卷已进入 Server 执行，但独立 Judge 未完成："+new StructuredAiJsonError("trailing-content").message+" [completionPhase=initial; protocol=chat-completions; finish=stop] [completionPhase=correction; protocol=chat-completions; finish=stop]"});
 p.campaign.serverControlOwner={schemaVersion:"server-workflow-control-owner-v1",controlJobId:job.id,operationKey:"workflow-control:synthetic:reviewed-holdout:old",requestedAt:p.updatedAt,sourceUpdatedAt:p.updatedAt,inputFingerprint:binding.inputSha256,phase:"bound",runId:sdk.runId};
 const result=createEvolutionEvent({id:'evt-'+job.id+'-reviewed-hidden-result',missionId:p.id,jobId:job.id,type:"ActionCompleted",source:"human-reviewed-holdout",payload:{approval,validation:structuredClone(p.validationRun),reason:p.validationRun.error}});
 const current=reviewedBinding(p,"a".repeat(64),"b".repeat(64),"fixed-route");return {p,before,job,sdk,admission,result,current};
}
beforeEach(()=>vi.resetAllMocks());
describe("private completed-step corroboration for invalid-only continuation",()=>{
 it("certifies an unchanged contract after real execution-state fields changed, without changing either record",async()=>{const x=await fixture(),copy=structuredClone(x);expect(certifyReviewedInvalidAttempt(x.p,x.job,x.sdk,x.result,x.admission,x.current)).toMatchObject({controlJobId:x.job.id,runId:x.sdk.runId,validationSha256:reviewedSha(x.p.validationRun)});expect(x).toEqual(copy);});
 it.each(["route","job","actor","input","approval","result-event","admission-event","verdict","one-verdict","previous-verdict","missing-case","syntax","phase","physical","old-verdict","goal","rubric","protected","checkpoint"])("refuses changed or unsafe prior evidence: %s",async kind=>{
  const x=await fixture();
  if(kind==="route")x.current.scoringRouteFingerprint="old-route";
  if(kind==="job")x.job.generation=2;
  if(kind==="actor")x.job.metadata!.reviewedActorId="other";
  if(kind==="input")x.sdk.input.controlOwnerKey="other";
  if(kind==="approval")x.result.payload.approval={};
  if(kind==="result-event")x.result.id="forged";
  if(kind==="admission-event")x.admission.source="browser";
  const v=x.result.payload.validation as EvolveProject["validationRun"];
  if(kind==="verdict")v.evaluation=structuredClone(x.p.experimentRun.candidateResults[0]!.evaluation);
  if(kind==="one-verdict")v.baselineEvaluation=structuredClone(x.p.experimentRun.candidateResults[0]!.evaluation);
  if(kind==="previous-verdict")v.previousEvaluation=structuredClone(x.p.experimentRun.candidateResults[0]!.evaluation);
  if(kind==="missing-case")v.runs=[];
  if(kind==="syntax")v.error="ordinary provider error";
  if(kind==="phase")v.error=v.error!.replace("completionPhase=correction;","not-correction");
  if(kind==="physical")v.executionArtifactFingerprint=undefined;
  if(kind==="old-verdict")(x.admission.payload.priorValidation as EvolveProject["validationRun"]).evaluation=structuredClone(x.p.experimentRun.candidateResults[0]!.evaluation);
  if(kind==="goal")x.p.goal+="changed";
  if(kind==="rubric")x.p.acceptanceRubric[0]!.minScore=91;
  if(kind==="protected")x.p.protectedItems.push("changed");
  if(kind==="checkpoint")x.admission.payload.priorCheckpoint=undefined;
  expect(()=>certifyReviewedInvalidAttempt(x.p,x.job,x.sdk,x.result,x.admission,x.current)).toThrow();
 });
});
it("builds only an explicit read-only recovery proposal from complete private observations",async()=>{
 const x=await fixture(),before=structuredClone(x.p),get=vi.fn(async(id:string)=>id.endsWith("hidden-result")?x.result:x.admission);
 m.preview.mockResolvedValue({binding:x.current,reviewNotes:x.p.baselineRun.result!.notes,preservationNotice:"REVIEW 保留；仅同一冻结文件的隔离隐藏验证；验收标准、保护要求和 Gate F 不豁免。"});
 m.runtime.mockReturnValue({jobs:{list:async()=>[x.job]},events:{get,append:vi.fn()}});m.sdk.mockResolvedValue(x.sdk);
 const preview=await previewReviewedInvalidRecovery(x.p);expect(preview.invalidOutputRecovery?.priorAttempts).toHaveLength(1);expect(x.p).toEqual(before);expect(JSON.stringify(preview.invalidOutputRecovery)).not.toContain("synthetic measured");expect(m.sdk).toHaveBeenCalledWith("old-run");expect(m.preview).toHaveBeenCalledTimes(2);
});
it("never accepts public Event data without private SDK proof",async()=>{
 const x=await fixture();m.preview.mockResolvedValue({binding:x.current});m.runtime.mockReturnValue({jobs:{list:async()=>[x.job]},events:{get:async()=>x.result}});m.sdk.mockRejectedValue(new Error("private step unavailable"));await expect(previewReviewedInvalidRecovery(x.p)).rejects.toThrow("无法核验旧 Workflow 私有完成记录");
});

it.each(["PASS","REVIEW","FAIL"] as const)("never retries either arm after a valid Safety %s",async safety=>{
 for(const arm of ["evaluation","baselineEvaluation"] as const){const x=await fixture();const v=x.result.payload.validation as EvolveProject["validationRun"];v[arm]={...structuredClone(x.p.experimentRun.candidateResults[0]!.evaluation),safety};expect(()=>certifyReviewedInvalidAttempt(x.p,x.job,x.sdk,x.result,x.admission,x.current)).toThrow();}
});
it("sanitizes private SDK read failures without echoing serialized payload or credential text",async()=>{
 const x=await fixture();m.preview.mockResolvedValue({binding:x.current});m.runtime.mockReturnValue({jobs:{list:async()=>[x.job]},events:{get:vi.fn()}});m.sdk.mockRejectedValue(new Error("private-payload fictional-credential"));
 const error=await previewReviewedInvalidRecovery(x.p).catch(e=>e);expect(error.message).not.toMatch(/private-payload|fictional-credential/);
});

it("cannot restore private authority from a public serialized SDK-looking DTO",async()=>{
 const x=await fixture();expect(()=>certifyReviewedInvalidAttempt(x.p,x.job,JSON.parse(JSON.stringify(x.sdk)),x.result,x.admission,x.current)).toThrow("私有 SDK 证据");
});

it("does not silently omit malformed reviewed history when checking prior verdicts",async()=>{
 const x=await fixture();m.preview.mockResolvedValue({binding:x.current});m.runtime.mockReturnValue({jobs:{list:async()=>[x.job,{...x.job,id:"unknown-history",metadata:{workflowIntent:"reviewed-holdout",reviewedApproval:{invalid:true}}}]},events:{get:vi.fn()}});
 await expect(previewReviewedInvalidRecovery(x.p)).rejects.toThrow("审批记录不完整");expect(m.sdk).not.toHaveBeenCalled();
});

it("may resume only the same queued reservation before dispatch, with the original recovery proof intact",async()=>{
 const x=await fixture(),proof=certifyReviewedInvalidAttempt(x.p,x.job,x.sdk,x.result,x.admission,x.current);
 const recovery={schemaVersion:"reviewed-invalid-output-recovery-v1",preserveFailedAttempts:true,acknowledgeNoValidVerdict:true,priorAttempts:[proof]};
 const approval={...x.sdk.input.approval,request:{...x.sdk.input.approval.request,binding:x.current,invalidOutputRecovery:recovery,idempotencyKey:"new-confirmed"}};
 const key='workflow-control:'+x.p.id+':reviewed-holdout:new-confirmed',pending=EvolutionJobSchema.parse({...x.job,id:"pending-job",idempotencyKey:key,status:"queued",outputRef:undefined,metadata:{workflowIntent:"reviewed-holdout",reviewedApproval:approval,requestSha256:reviewedSha(approval.request),reviewedActorId:approval.actorId}});
 x.p.campaign.serverControlOwner={...x.p.campaign.serverControlOwner!,controlJobId:pending.id,operationKey:key,phase:"reserved",runId:undefined,sourceUpdatedAt:x.current.sourceUpdatedAt,inputFingerprint:x.current.inputSha256};
 m.preview.mockResolvedValue({binding:x.current,reviewNotes:x.p.baselineRun.result!.notes,preservationNotice:"REVIEW 保留；仅同一冻结文件的隔离隐藏验证；验收标准、保护要求和 Gate F 不豁免。"});m.runtime.mockReturnValue({jobs:{list:async()=>[x.job,pending]},events:{get:async(id:string)=>id.endsWith("hidden-result")?x.result:x.admission}});m.sdk.mockResolvedValue(x.sdk);
 expect((await previewReviewedInvalidRecovery(x.p,{controlJobId:pending.id,operationKey:key})).invalidOutputRecovery).toEqual(recovery);
 x.p.campaign.serverControlOwner!.phase="dispatching";await expect(previewReviewedInvalidRecovery(x.p,{controlJobId:pending.id,operationKey:key})).rejects.toThrow("已发送");
});
