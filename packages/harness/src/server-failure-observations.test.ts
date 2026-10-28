// @vitest-environment node
import {describe,expect,it,vi} from "vitest";
import {FailureObservationSourcesSchema,VisibleFailureObservationsSchema} from "@evolution/contracts";
import {failureObservationFixture,learningContextHash} from "@evolution/testkit";
import {buildServerFailureObservations} from "./server-failure-observations";
import {serverExperimentBuildCheckpoint,serverExperimentExecutionCheckpoint,serverExperimentObservationBinding} from "./server-experiment-recovery";
const physical=learningContextHash("synthetic physical source binding");
async function fixture(){
  const x=failureObservationFixture(),ports={fingerprint:async(s:string)=>learningContextHash(s),readExecutionArtifactFingerprint:async()=>physical};
  const cp=await serverExperimentBuildCheckpoint(x.source,x.candidate,ports),binding=await serverExperimentObservationBinding(x.source,x.candidate,cp,ports);
  x.source.experimentRun.executionCheckpoints=[(await serverExperimentExecutionCheckpoint(x.source,x.candidate,cp,x.source.experimentRun.candidateResults[0]!.runs,Date.parse(x.at),ports,binding))!];
  x.current.failureObservationSources=[x.sourceRef()];
  const io={readSourceMission:vi.fn(async()=>structuredClone(x.source)),fingerprintText:ports.fingerprint,verifyFrozenSnapshot:vi.fn(async()=>true),readExecutionArtifactFingerprint:vi.fn(async()=>physical),bodyAuthorized:()=>true};
  return {...x,io};
}
describe("source-qualified retrospective Visible observations",()=>{
  it("preserves exact source/paired facts and useful body without final, Hidden, programs or raw state",async()=>{
    const x=await fixture(),before=structuredClone(x.source),out=await buildServerFailureObservations(x.current,x.io),wire=JSON.stringify(out);
    expect(out?.observations[0]).toMatchObject({grade:"measured-visible-failure",source:x.sourceRef(),failureCriterionIds:["GOAL"],comparisons:[{baselineScore:95,candidateScore:90,delta:-5}]});
    expect(wire).toContain("Original complete body");expect(wire).toContain("Current complete body");
    expect(wire).not.toMatch(/PRIVATE_.*SENTINEL|"(?:independentFinal|runs|patches|artifactSnapshots|verified-skill)"/);
    expect(x.source).toEqual(before);expect(x.io.readSourceMission).toHaveBeenCalledTimes(2);expect(out?.missionId).toBe(x.current.id);
    expect(()=>VisibleFailureObservationsSchema.parse({...out,independentFinal:x.source.validationRun.independentFinal})).toThrow();
  });
  it("does not read any source in the default no-reference path",async()=>{
    const x=await fixture();x.current.failureObservationSources=undefined;expect(await buildServerFailureObservations(x.current,x.io)).toBeUndefined();expect(x.io.readSourceMission).not.toHaveBeenCalled();
  });
  it.each(["wrong-record","wrong-mission","wrong-experiment","positive","demo","changed-snapshot","missing-checkpoint","changed-runs","missing-original","physical-mismatch","unreadable","future","moving-source"])("blocks %s without constructing model context",async kind=>{
    const x=await fixture();
    if(kind==="wrong-record")x.current.failureObservationSources![0]!.missionSha256="f".repeat(64);
    if(kind==="wrong-mission")x.source.id="foreign";
    if(kind==="wrong-experiment")x.current.failureObservationSources![0]!.experimentRunId="other";
    if(kind==="positive")x.source.experimentRun.candidateResults[0]!.evaluation.criterionScores![0]!.score=98;
    if(kind==="demo")x.source.experimentRun.candidateResults[0]!.evaluation.demoJudged=true;
    if(kind==="changed-snapshot")x.candidate.artifactSnapshots[0]!.content+="changed";
    if(kind==="missing-checkpoint")x.source.experimentRun.executionCheckpoints=[];
    if(kind==="changed-runs")x.source.experimentRun.candidateResults[0]!.runs[0]!.output="forged";
    if(kind==="missing-original")x.source.experimentRun.comparisonBaseline!.originalReferences=[];
    if(kind==="physical-mismatch")x.io.readExecutionArtifactFingerprint.mockResolvedValue("e".repeat(64));
    if(kind==="unreadable")x.io.verifyFrozenSnapshot.mockResolvedValue(false);
    if(kind==="future")x.source.experimentRun.executionCheckpoints![0]!.execution!.observedAt=Date.now()+100000;
    if(kind==="moving-source")x.io.readSourceMission.mockImplementationOnce(async()=>structuredClone(x.source)).mockImplementationOnce(async()=>({...structuredClone(x.source),goal:"changed"}));
    if(!["wrong-record","wrong-mission","wrong-experiment"].includes(kind))x.current.failureObservationSources=[x.sourceRef()];
    await expect(buildServerFailureObservations(x.current,x.io)).rejects.toThrow();
  });
  it("requires separate body consent, retaining numeric provenance when body is omitted",async()=>{
    const x=await fixture();x.io.bodyAuthorized=()=>false;const out=await buildServerFailureObservations(x.current,x.io);
    expect(out?.observations[0]).toMatchObject({originalText:[],candidateText:[],comparisons:[{delta:-5}]});
  });
  it("qualifies a closed scheduler checkpoint only through its explicit cryptographically bound historical round",async()=>{
    const x=await fixture();x.source.campaign.checkpoint=undefined;x.source.campaign.currentRound=1;x.current.failureObservationSources=[x.sourceRef()];
    expect((await buildServerFailureObservations(x.current,x.io))?.observations[0].source.round).toBe(1);
    x.current.failureObservationSources[0]!.round=2;await expect(buildServerFailureObservations(x.current,x.io)).rejects.toThrow("receipt");
  });
  it("rejects duplicate or mutable self references",async()=>{
    const x=await fixture();expect(()=>FailureObservationSourcesSchema.parse([x.sourceRef(),x.sourceRef()])).toThrow();
    x.current.id=x.source.id;await expect(buildServerFailureObservations(x.current,x.io)).rejects.toThrow("mutable");
  });
});
