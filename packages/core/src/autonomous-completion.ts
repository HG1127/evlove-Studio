import type {EvolveProject} from "@evolution/contracts";
import {projectHasOnlineReleaseTarget} from "./release-target";
import {projectHasStableHealthyProductionOutcome} from "./release-outcome";

/** Final state transition after package + learning/queue (and live release decision when applicable). */
export function completeAutonomousMission(project:EvolveProject,args:{at:string;reason:string}):EvolveProject{
  const online=projectHasOnlineReleaseTarget(project);
  if(online&&!projectHasStableHealthyProductionOutcome(project,{now:Date.parse(args.at)})){
    throw new Error("Production Outcome 尚未形成新鲜且稳定的连续健康证据，不能完成线上自主闭环");
  }
  return {
    ...project,
    stage:"learning",
    campaign:{
      ...project.campaign,
      status:"completed",
      completedAt:args.at,
      stopReason:args.reason,
      checkpoint:undefined,
      schedule:{...project.campaign.schedule,enabled:false,nextRunAt:undefined},
    },
    gates:project.gates.map((gate)=>gate.id==="release-ready"&&!online
      ?{...gate,status:"approved" as const,approvedAt:args.at,note:"离线成果已通过完整验收并打包；生产发布路径不适用"}
      :gate),
    updatedAt:args.at,
  };
}
