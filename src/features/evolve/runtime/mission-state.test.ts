import {it,expect,vi} from "vitest";
import {pairedJudgeFixture} from "@evolution/testkit";
import {EvolutionJobSchema} from "@evolution/contracts";
import {deriveMissionState} from "./mission-state";
vi.mock("./mission-review-store",()=>({isMissionUserAccepted:()=>false}));
vi.mock("./autonomous-orchestrator",()=>({deriveAttentionRequest:()=>undefined,deriveAutonomousDecision:()=>({action:"wait",reason:"pending",stage:"experiment"})}));
const project=()=>{const p=pairedJudgeFixture().project;p.campaign.status="running";p.updatedAt="2026-10-30T02:11:11Z";return p;};
it("shows interrupted cached-running Missions as resumable rather than autonomously active",()=>{
 expect(deriveMissionState(project(),{interrupted:true})).toMatchObject({state:"paused",label:"等待恢复"});
});
it("shows cached running state as unverified and preserves a genuinely owned local run",()=>{
 expect(deriveMissionState(project())).toMatchObject({state:"waiting",label:"运行状态待核对"});
 expect(deriveMissionState(project(),{running:true})).toMatchObject({state:"running"});
});
it("reflects a terminal Job without changing the Mission or frozen file state",()=>{
 const p=project(),before=JSON.stringify(p),job=EvolutionJobSchema.parse({schemaVersion:"job-v1",id:"control",missionId:p.id,
  type:"campaign",status:"cancelled",label:"Control",idempotencyKey:`workflow-control:${p.id}:old`,generation:1,attempts:1,priority:70,
  createdAt:"2026-10-30T02:08:04Z",updatedAt:"2026-10-30T02:30:36Z"});
 expect(deriveMissionState(p,{running:true,startedAt:"2026-10-30T02:08:21Z",jobs:[job]})).toMatchObject({state:"paused",label:"本次运行已取消"});
 expect(JSON.stringify(p)).toBe(before);
});
