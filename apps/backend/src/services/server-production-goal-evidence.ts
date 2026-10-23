import {ProductionGoalEvidenceSchema,type EvolveProject} from "@evolution/contracts";
import {applyProductionLearningGovernance,productionGoalFingerprint} from "@evolution/core";
import {analyzeMissionOutcome} from "./outcome-analytics";

/** Read warehouse data after telemetry persistence. A failure records no fabricated scores. */
export async function refreshServerProductionGoalEvidence(project:EvolveProject):Promise<EvolveProject>{
  const {candidateId,deploymentId,stableDeploymentId}=project.release;
  if(project.release.status!=="promoted"||!candidateId||!deploymentId||!stableDeploymentId)return project;
  const binding={schemaVersion:"production-goal-v1" as const,missionId:project.id,candidateId,deploymentId,stableDeploymentId,
    goalFingerprint:productionGoalFingerprint(project)};
  let proof;
  try{
    const analysis=await analyzeMissionOutcome({missionId:project.id,candidateId,deploymentId,stableDeploymentId,telemetryOnly:true});
    proof=ProductionGoalEvidenceSchema.parse({...binding,checkedAt:analysis.checkedAt,analysis});
  }catch{
    proof=ProductionGoalEvidenceSchema.parse({...binding,checkedAt:new Date().toISOString(),error:"真实目标收益统计读取失败；保留未验证状态，请刷新 Outcome。"});
  }
  const at=new Date().toISOString();
  return applyProductionLearningGovernance({...project,release:{...project.release,goalEvidence:proof}},{at,now:Date.parse(at)});
}
