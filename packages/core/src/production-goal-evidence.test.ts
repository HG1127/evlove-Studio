import {expect,it} from "vitest";
import type {EvolveProject} from "@evolution/contracts";
import {withMeasuredProductionGoal} from "@evolution/testkit";
import {productionGoalReadiness} from "./production-goal-evidence";

const at="2026-10-23T00:00:00Z",now=Date.parse(at);
const base=()=>({id:"mission",goal:"conversion",metrics:[],releaseTarget:{provider:"vercel",status:"connected"},release:{status:"promoted",candidateId:"C",deploymentId:"new",stableDeploymentId:"old",observedAt:at}} as unknown as EvolveProject);
it("refuses to replace goal evidence with healthy release state",()=>expect(productionGoalReadiness(base(),now).ready).toBe(false));
it("accepts sufficient comparable goal improvements",()=>expect(productionGoalReadiness(withMeasuredProductionGoal(base()),now).improved).toBe(true));
it.each(["identity","goal","stale","insufficient","regression","no-improvement","unit","duplicate","unavailable","legacy-policy","task-conflict","unknown-independent-count"])("blocks %s evidence",scenario=>{
  const p=withMeasuredProductionGoal(base());const proof=p.release.goalEvidence!,analysis=proof.analysis!,row=analysis.metrics[0]!;
  if(scenario==="identity")p.release.deploymentId="other";
  if(scenario==="goal")p.goal="different contract";
  if(scenario==="stale")proof.checkedAt="2026-10-22T00:00:00Z";
  if(scenario==="insufficient")row.candidate.count=1;
  if(scenario==="regression")analysis.verdict="regression";
  if(scenario==="no-improvement")row.significance="not-significant";
  if(scenario==="unit")row.unit="seconds";
  if(scenario==="duplicate")analysis.metrics.push({...row});
  if(scenario==="unavailable")proof.error="warehouse unavailable";
  if(scenario==="legacy-policy")delete analysis.measurementPolicy;
  if(scenario==="task-conflict")analysis.observationConflictCount=1;
  if(scenario==="unknown-independent-count")delete analysis.independentSampleCount;
  expect(productionGoalReadiness(p,now).ready).toBe(false);
});
it("records rollback closure without granting improvement or Skill evidence",()=>{
  const p=base();p.release.status="rolled-back";
  expect(productionGoalReadiness(p,now)).toMatchObject({ready:true,improved:false});
});
