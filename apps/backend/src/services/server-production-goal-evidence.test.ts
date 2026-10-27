// @vitest-environment node
import {beforeEach,expect,it,vi} from "vitest";
import {acceptedPackageFixture,businessBenefitFixture} from "@evolution/testkit";
import {productionGoalReadiness} from "@evolution/core";
import {OutcomeMetricSampleSchema} from "@evolution/contracts";
import {refreshServerProductionGoalEvidence} from "./server-production-goal-evidence";
import {assertClientMissionMutationSafe} from "./mission-mutation-policy";

const state=vi.hoisted(()=>({rows:[] as unknown[],fail:false,business:false}));
vi.mock("./outcome-sample-store",()=>({readOutcomeSamples:async()=>{if(state.fail)throw Error("offline");return state.rows;}}));
vi.mock("./outcome-telemetry-source",()=>({getOutcomeTelemetryConfigState:()=>({sources:[{id:"trusted",sampling:{kind:"independent-task"},
  metrics:state.business?[
    {metricKey:"accepted",segment:"all",metricKind:"business",direction:"higher",unit:"ratio"},
    {metricKey:"elapsed",segment:"all",metricKind:"latency",direction:"lower",unit:"ms"},
    {metricKey:"cost",segment:"all",metricKind:"cost",direction:"lower",unit:"USD"},
  ]:[{metricKey:"conversion",segment:"all"}]}],configured:true,ready:true,errors:[]})}));
beforeEach(()=>{state.rows=[];state.fail=false;state.business=false;});
function fixture(){
  const p=acceptedPackageFixture(false).project;
  p.metrics=[{key:"conversion",label:"conversion",value:10,target:20,direction:"higher",unit:"%"}];
  p.releaseTarget={provider:"vercel",mode:"preview-promote",status:"connected",label:"test",healthPath:"/"};
  p.release={...p.release,status:"promoted",candidateId:"C",deploymentId:"new",stableDeploymentId:"old",evidenceMode:"live",environment:"production",observedAt:new Date().toISOString()};
  for(const arm of ["stable","candidate"] as const)for(let i=0;i<30;i++)state.rows.push(OutcomeMetricSampleSchema.parse({
    id:arm+i,workspaceId:"test",missionId:p.id,candidateId:"C",deploymentId:arm==="stable"?"old":"new",arm,
    metricKey:"conversion",metricKind:"business",direction:"higher",unit:"%",value:arm==="stable"?10:30,
    source:"outcome-telemetry:trusted",observedAt:new Date().toISOString(),observation:{schemaVersion:"outcome-observation-v1",kind:"independent-task",taskId:arm+i},
  }));
  return p;
}
it("derives deployment-bound goal evidence from independently identified warehouse records",async()=>{
  const p=fixture();const updated=await refreshServerProductionGoalEvidence(p);
  expect(productionGoalReadiness(updated).improved).toBe(true);
  expect(updated.release.goalEvidence?.analysis?.sampleCount).toBe(60);
  expect(()=>assertClientMissionMutationSafe(p,updated)).toThrow(/goalEvidence/);
});
it.each([false,true])("keeps business thresholds in server-owned goal evidence (%s mean-only)",async meanOnly=>{
  const x=businessBenefitFixture(meanOnly);state.business=true;state.rows=x.samples;
  const updated=await refreshServerProductionGoalEvidence(x.project);
  expect(updated.release.goalEvidence?.analysis?.businessBenefit?.status).toBe(meanOnly?"failed":"thresholds-met");
  expect(productionGoalReadiness(updated).improved).toBe(!meanOnly);
  expect(()=>assertClientMissionMutationSafe(x.project,updated)).toThrow(/goalEvidence/);
});
it.each(["health-only","wrong-deployment","legacy-aggregate"])("does not let %s samples satisfy improvement",async scenario=>{
  const p=fixture();
  state.rows=state.rows.map(row=>({...row as object,...(scenario==="health-only"?{source:"vercel-release-health"}:scenario==="legacy-aggregate"?{observation:undefined}:{deploymentId:"another-release"})}));
  const updated=await refreshServerProductionGoalEvidence(p);
  expect(updated.release.goalEvidence?.analysis?.verdict).toBe("insufficient");
  expect(productionGoalReadiness(updated).ready).toBe(false);
});
it("persists a transparent unavailable receipt without scores when reads fail",async()=>{
  const p=fixture();state.fail=true;
  const updated=await refreshServerProductionGoalEvidence(p);
  expect(updated.release.goalEvidence?.error).toBeTruthy();
  expect(updated.release.goalEvidence?.analysis).toBeUndefined();
  expect(productionGoalReadiness(updated).ready).toBe(false);
});
