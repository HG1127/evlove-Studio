// @vitest-environment node
import {randomUUID} from "node:crypto";
import {describe,expect,it,vi} from "vitest";
import {createEvolutionEvent,EvolutionJobSchema,type EvolutionEvent,type PairedReassessmentPin} from "@evolution/contracts";
import {pairedJudgeFixture} from "@evolution/testkit";
import {serverExperimentJudgeScope,serverPairedJudgeRequest} from "@evolution/harness";
import {claimPairedJudgeAttempt,pairedJudgePhysicalScopeSha256,serverPairedCandidateAssessmentRequests} from "./server-paired-judge-claim";
import {pairedAdmissionDigest,recoverConsumedPairedIdentity,resolvePairedAttemptIdentity} from "./server-paired-reassessment";

function fixture(){
  const x=pairedJudgeFixture(),request=serverPairedJudgeRequest(x.project,x.candidate,x.project.evalSuite,x.project.acceptanceRubric,x.candidateRuns,x.originalRuns,"visible");
  const physical=pairedJudgePhysicalScopeSha256(request),at=Date.parse(x.at),time=(offset:number)=>new Date(at+offset).toISOString();
  const priorJobId="old-control-job",route={operation:"evaluate-paired" as const,protocol:"chat-completions" as const,model:"old-evaluator",routeFingerprint:"d".repeat(64)};
  const target={...route,model:"qualified-evaluator",routeFingerprint:"e".repeat(64)};
  const old=createEvolutionEvent({id:"evt-paired-judge-claim-"+physical,missionId:x.project.id,jobId:priorJobId,type:"ActionPlanned",source:"server-paired-evidence-judge",at:x.at,
    payload:{measurementKind:"paired-judge-claim-v1",ownerNonce:"old-owner",scopeSha256:physical,inputFingerprint:request.context.inputFingerprint,protocol:request.context.protocol,candidateId:request.context.candidateId,phase:"visible"}});
  const usageRequest={schemaVersion:"ai-usage-request-v1" as const,callId:randomUUID(),scope:{missionId:x.project.id,jobId:priorJobId,phase:"experiment"},route,attempt:1,granularity:"physical-http-attempt" as const,startedAt:time(10)};
  const result={schemaVersion:"ai-provider-usage-v3" as const,request:usageRequest,completedAt:time(20),elapsedMs:10,outcome:"response" as const,httpStatus:200,responseModel:route.model,
    usage:{status:"complete" as const,counts:{input:1,output:1,total:2}},completion:{finishReason:"stop" as const},billing:{status:"unavailable" as const}};
  const record=(id:string,payload:unknown,offset:number)=>createEvolutionEvent({id,missionId:x.project.id,jobId:priorJobId,type:"JobProgress",source:"server-ai-usage",at:time(offset),payload:{record:payload}});
  const failure=createEvolutionEvent({id:"prior-invalid-output",missionId:x.project.id,jobId:priorJobId,type:"JobProgress",source:"vercel-workflow-control",at:time(30),payload:{reason:"[server-campaign-experiment-judge-pending] 模型返回的 JSON 不符合任务结构"}});
  const events=[old,record("old-start",{kind:"request-start",request:usageRequest},10),record("old-result",{kind:"request-result",observation:result},20),failure];
  const pin:PairedReassessmentPin={missionId:x.project.id,physicalScopeSha256:physical,runtimeCommit:"a".repeat(40),priorClaimId:old.id,priorClaimPayloadSha256:pairedAdmissionDigest(old.payload),priorJobId,
    priorFailureEventId:failure.id,priorFailurePayloadSha256:pairedAdmissionDigest(failure.payload),priorPhysicalRoute:route,targetScoringRouteFingerprint:"f".repeat(64),targetPhysicalRoute:target,
    qualificationOutcomeSha256:"1".repeat(64),qualificationAuditSha256:"2".repeat(64),authorizationSha256:"3".repeat(64),reason:"qualified-evaluator-replacement-after-schema-failure",expiresAt:time(1000)};
  const job=EvolutionJobSchema.parse({schemaVersion:"job-v1",id:priorJobId,missionId:x.project.id,type:"campaign",status:"failed",label:"prior invalid schema",idempotencyKey:"old",generation:1,attempts:1,priority:1,createdAt:x.at,updatedAt:time(40),finishedAt:time(40)});
  const options={physicalScopeSha256:physical,route:pin.targetScoringRouteFingerprint,physicalRoute:target,runtimeCommit:pin.runtimeCommit,rawTrust:JSON.stringify({schemaVersion:"paired-reassessment-trust-v1",pins:[pin]}),events,readJob:vi.fn(async()=>job),nowMs:at+50};
  return {...x,request,physical,pin,options,old,events,job,withPin:(next:PairedReassessmentPin)=>({...options,rawTrust:JSON.stringify({schemaVersion:"paired-reassessment-trust-v1",pins:[next]})})};
}

describe("explicit qualified evaluator reassessment",()=>{
  it("retains the original physical lock when no server pin exists",async()=>{
    const x=fixture();expect(await resolvePairedAttemptIdentity(x.request,{...x.options,rawTrust:undefined})).toEqual({physicalScopeSha256:x.physical,scopeSha256:x.physical});expect(x.options.readJob).not.toHaveBeenCalled();
  });
  it("uses the actual effective judging scope and target-only bindings during preflight",()=>{
    const x=fixture();x.project.experimentPolicy.judgeComparison="paired-two-order-v1";
    x.project.acceptanceRubric.push({...x.project.acceptanceRubric[0]!,id:"unissued-deterministic",judgeType:"structural"});
    const snapshot=x.candidate.artifactSnapshots[0]!,source=x.project.sourceArtifacts[0]!;
    x.project.sourceArtifacts.push({...source,id:"reference-only",role:"reference"});
    x.candidate.artifactSnapshots.push({...snapshot,id:"reference-snapshot",sourceArtifactId:"reference-only",frozenArtifact:{...snapshot.frozenArtifact!,sourceArtifactId:"reference-only"}});
    x.project.candidates=[x.candidate];x.project.selectedCandidateIds=[x.candidate.id];x.project.baselineRun.runs=x.originalRuns;
    x.project.experimentRun.executionCheckpoints=[{candidateId:x.candidate.id,buildInputFingerprint:"1".repeat(64),artifactFingerprint:"2".repeat(64),execution:{inputFingerprint:"3".repeat(64),evidenceFingerprint:"4".repeat(64),observedAt:Date.parse(x.at),runs:x.candidateRuns}}];
    const scope=serverExperimentJudgeScope(x.project,x.project.evalSuite,x.candidateRuns),actual=serverPairedJudgeRequest(x.project,x.candidate,x.project.evalSuite,scope.effectiveCriteria,x.candidateRuns,x.originalRuns,"visible"),preflight=serverPairedCandidateAssessmentRequests(x.project)[0]!;
    expect(pairedJudgePhysicalScopeSha256(preflight)).toBe(pairedJudgePhysicalScopeSha256(actual));
    expect(preflight.criteria.some(c=>c.id==="unissued-deterministic")).toBe(false);expect(preflight.context.bindings.some(b=>b.sourceArtifactId==="reference-only")).toBe(false);
    x.project.experimentRun.executionCheckpoints=[];expect(serverPairedCandidateAssessmentRequests(x.project)).toEqual([]);
  });
  it("admits only the exact completed-invalid prior attempt and different qualified evaluator",async()=>{
    const x=fixture(),identity=await resolvePairedAttemptIdentity(x.request,x.options);expect(identity.physicalScopeSha256).toBe(x.physical);expect(identity.scopeSha256).not.toBe(x.physical);expect(identity.admissionSha256).toMatch(/^[a-f0-9]{64}$/);
  });
  it("cannot mint another target budget by changing calibration, authorization, expiry or Job",async()=>{
    const x=fixture(),one=await resolvePairedAttemptIdentity(x.request,x.options),two=await resolvePairedAttemptIdentity(x.request,x.withPin({...x.pin,authorizationSha256:"4".repeat(64),qualificationOutcomeSha256:"5".repeat(64),expiresAt:new Date(x.options.nowMs+2000).toISOString()}));
    expect(two.scopeSha256).toBe(one.scopeSha256);expect(two.admissionSha256).not.toBe(one.admissionSha256);
    const events=new Map(x.events.map(e=>[e.id,e])),ports={scope:{missionId:x.project.id,jobId:"new-control-job",phase:"experiment"},now:()=>new Date(x.options.nowMs).toISOString(),list:async()=>[...events.values()],append:async(e:EvolutionEvent)=>{if(!events.has(e.id))events.set(e.id,e);}};
    const old=JSON.stringify(events.get(x.old.id));await claimPairedJudgeAttempt(x.request,ports,one);
    await expect(claimPairedJudgeAttempt(x.request,{...ports,scope:{...ports.scope,jobId:"yet-another-job"}},two)).rejects.toThrow("already started");expect(JSON.stringify(events.get(x.old.id))).toBe(old);
  });
  it.each(["missing-result","transport-error","length","wrong-route","duplicate-result"])("denies %s instead of inferring an unsent or valid result",async kind=>{
    const x=fixture(),events=structuredClone(x.events),observed=events[2]!.payload.record as {observation:{outcome:string;completion:{finishReason:string};request:{route:{model:string}}}};
    if(kind==="missing-result")events.splice(2,1);if(kind==="transport-error")observed.observation.outcome="transport-error";if(kind==="length")observed.observation.completion.finishReason="length";if(kind==="wrong-route")observed.observation.request.route.model="foreign";if(kind==="duplicate-result")events.push({...events[2]!,id:"duplicate-result"});
    await expect(resolvePairedAttemptIdentity(x.request,{...x.options,events})).rejects.toThrow();
  });
  it("denies partial or complete legacy orders and an incomplete event page",async()=>{
    const x=fixture();for(const events of [[...x.events,{...x.old,id:"evt-paired-order-completed-"+x.physical+"-0"}],Array(1000).fill(x.old)])await expect(resolvePairedAttemptIdentity(x.request,{...x.options,events})).rejects.toThrow();
  });
  it("denies expired/wrong-code/wrong-route pins and altered failure provenance",async()=>{
    const x=fixture();for(const options of [{...x.options,nowMs:Date.parse(x.pin.expiresAt)},{...x.options,runtimeCommit:"b".repeat(40)},{...x.options,route:"0".repeat(64)},x.withPin({...x.pin,priorFailurePayloadSha256:"0".repeat(64)}),{...x.options,readJob:async()=>({...x.job,status:"running" as const})}])await expect(resolvePairedAttemptIdentity(x.request,options)).rejects.toThrow();
  });
  it("rejects a same-model replacement or duplicate target registration",async()=>{
    const x=fixture();await expect(resolvePairedAttemptIdentity(x.request,x.withPin({...x.pin,targetPhysicalRoute:{...x.pin.targetPhysicalRoute,model:x.pin.priorPhysicalRoute.model}}))).rejects.toThrow();
    await expect(resolvePairedAttemptIdentity(x.request,{...x.options,rawTrust:JSON.stringify({schemaVersion:"paired-reassessment-trust-v1",pins:[x.pin,x.pin]})})).rejects.toThrow();
  });
  it("rechecks expiry after slow qualification I/O and before any new claim append",async()=>{
    const x=fixture();vi.useFakeTimers();
    try{
      vi.setSystemTime(x.options.nowMs);
      await expect(resolvePairedAttemptIdentity(x.request,{...x.options,nowMs:undefined,readJob:async()=>{vi.setSystemTime(Date.parse(x.pin.expiresAt)+1);return x.job;}})).rejects.toThrow();
      const identity=await resolvePairedAttemptIdentity(x.request,x.options),append=vi.fn(async()=>{});
      await expect(claimPairedJudgeAttempt(x.request,{scope:{missionId:x.project.id,jobId:"new-job",phase:"experiment"},list:async()=>x.events,append,now:()=>new Date(Date.parse(x.pin.expiresAt)+1).toISOString()},identity)).rejects.toThrow("expired before claim");
      expect(append).not.toHaveBeenCalled();
    }finally{vi.useRealTimers();}
  });
  it("recovers a consumed complete pair after expiry without an active pin; zero/one order or foreign owner stays blocked",async()=>{
    const x=fixture(),identity=await resolvePairedAttemptIdentity(x.request,x.options),jobId="new-control-job";
    const claim=createEvolutionEvent({id:"evt-paired-judge-claim-"+identity.scopeSha256,missionId:x.project.id,jobId,type:"ActionPlanned",source:"server-paired-evidence-judge",at:new Date(x.options.nowMs).toISOString(),payload:{scopeSha256:identity.scopeSha256,physicalScopeSha256:x.physical,inputFingerprint:x.request.context.inputFingerprint,admissionSha256:identity.admissionSha256,reassessment:identity.admission}});
    const orders=[0,1].map(order=>({...claim,id:"evt-paired-order-completed-"+identity.scopeSha256+"-"+order}));
    const input={physicalScopeSha256:x.physical,route:x.options.route,missionId:x.project.id,jobId,inputFingerprint:x.request.context.inputFingerprint,events:[...x.events,claim,...orders]};
    await expect(resolvePairedAttemptIdentity(x.request,{...x.options,nowMs:Date.parse(x.pin.expiresAt)+1})).rejects.toThrow();
    expect(recoverConsumedPairedIdentity(input)?.scopeSha256).toBe(identity.scopeSha256);
    for(const events of [[...x.events,claim],[...x.events,claim,orders[0]!]])expect(()=>recoverConsumedPairedIdentity({...input,events})).toThrow();
    expect(()=>recoverConsumedPairedIdentity({...input,jobId:"foreign-job"})).toThrow();
  });
});
