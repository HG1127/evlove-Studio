import {OUTCOME_MEASUREMENT_POLICY,ProductionGoalEvidenceSchema,type EvolveProject} from "@evolution/contracts";
import {fastHash} from "./stable-hash";
import {projectHasOnlineReleaseTarget} from "./release-target";
import {PRODUCTION_OUTCOME_FRESHNESS_MS,PRODUCTION_OUTCOME_MAX_FUTURE_SKEW_MS} from "./release-outcome";
import {businessBenefitEvidenceMatches} from "./business-benefit";

export function productionGoalFingerprint(project:EvolveProject){
  return fastHash(JSON.stringify(["production-goal-v2",OUTCOME_MEASUREMENT_POLICY,project.id,project.goal,project.evolutionCommand,
    project.metrics?.map(({key,target,direction,unit})=>({key,target,direction,unit})),project.acceptanceRubric,
    project.release.candidateId,project.release.deploymentId,project.release.stableDeploymentId,project.release.artifactHashes,
    ...(project.businessBenefitPolicy?[{businessBenefitPolicy:project.businessBenefitPolicy}]:[])]));
}

/** Completion may record a rollback, but only measured goal improvement can authorize a Skill. */
export function productionGoalReadiness(project:EvolveProject,now=Date.now()){
  const pending=(reason:string)=>({ready:false,improved:false,reason});
  if(!projectHasOnlineReleaseTarget(project))return {ready:true,improved:false,reason:"离线验收不产生 Production Skill。"};
  if(project.release.status==="rolled-back")return {ready:true,improved:false,reason:"本轮已回滚，只能记录失败经验；未证明真实改进。"};
  if(project.release.status!=="promoted")return pending("尚未完成真实 Production 发布。");
  const parsed=ProductionGoalEvidenceSchema.safeParse(project.release.goalEvidence);
  if(!parsed.success)return pending("缺少与当前发布绑定的目标收益证据。");
  const proof=parsed.data;
  if(proof.missionId!==project.id||proof.candidateId!==project.release.candidateId
    ||proof.deploymentId!==project.release.deploymentId||proof.stableDeploymentId!==project.release.stableDeploymentId
    ||proof.deploymentId===proof.stableDeploymentId||proof.goalFingerprint!==productionGoalFingerprint(project)){
    return pending("目标收益证据与当前 Mission / Candidate / Deployment / 目标契约不一致。");
  }
  const at=Date.parse(proof.checkedAt);
  if(!Number.isFinite(now)||!Number.isFinite(at)||at>now+PRODUCTION_OUTCOME_MAX_FUTURE_SKEW_MS||now-at>PRODUCTION_OUTCOME_FRESHNESS_MS){
    return pending("目标收益观测已过期或时间无效，需要重新分析。");
  }
  const analysis=proof.analysis;
  if(proof.error||!analysis)return pending(proof.error||"目标收益统计尚未完成。");
  if(analysis.missionId!==project.id||analysis.candidateId!==proof.candidateId||analysis.checkedAt!==proof.checkedAt){
    return pending("目标收益分析身份或时间绑定不一致。");
  }
  if(project.businessBenefitPolicy){
    const benefit=analysis.businessBenefit;
    if(!benefit||benefit.checkedAt!==proof.checkedAt||!businessBenefitEvidenceMatches(project.businessBenefitPolicy,benefit))
      return pending("缺少与当前业务任务契约绑定的完整验收率、中位耗时和成功任务成本证据。");
  }
  if(analysis.verdict!=="healthy"||analysis.regressions.length)return pending("目标收益样本不足、发生回归或存在漂移，不能宣告进化成功。");
  if(analysis.measurementPolicy!==OUTCOME_MEASUREMENT_POLICY||analysis.observationConflictCount!==0
    ||!Number.isInteger(analysis.independentSampleCount)||analysis.independentSampleCount!<Math.max(5,analysis.minimumSamplesPerArm)*2){
    return pending("目标收益缺少足量、无冲突的独立任务观测，汇总轮询不能升级为真实进化或 Verified Skill。");
  }
  const goals=project.metrics?.filter(metric=>metric.target!==undefined&&Number.isFinite(metric.target))??[];
  if(!goals.length||new Set(goals.map(goal=>goal.key)).size!==goals.length)return pending("需要唯一、可观测且有目标值的业务指标契约。");
  let improved=false;
  for(const goal of goals){
    const rows=analysis.metrics.filter(metric=>metric.metricKey===goal.key);
    if(!rows.length||new Set(rows.map(row=>row.segment)).size!==rows.length)return pending(`目标 ${goal.key} 缺少唯一分段对照证据。`);
    for(const row of rows){
      const count=Math.max(5,analysis.minimumSamplesPerArm);
      if(row.direction!==goal.direction||row.unit!==goal.unit||row.evidenceStatus!=="estimated"
        ||row.stable.count<count||row.candidate.count<count||!Number.isFinite(row.candidate.mean)){
        return pending(`目标 ${goal.key} 的单位、方向或样本量不足。`);
      }
      if(goal.direction==="higher"?row.candidate.mean!<goal.target!:row.candidate.mean!>goal.target!){
        return pending(`目标 ${goal.key} 尚未达到约定目标值。`);
      }
      improved ||= row.significance==="significant-improvement"&&row.favorable===true
        &&row.pValueApprox!==undefined&&row.pValueApprox<0.05
        &&(goal.direction==="higher"?row.candidate.mean!>row.stable.mean!:row.candidate.mean!<row.stable.mean!);
    }
  }
  if(!improved)return pending("目标已达标但尚无显著改善证据，不能升级为 Verified Skill 或宣告真实进化成功。");
  return {ready:true,improved:true,reason:project.businessBenefitPolicy
    ?"当前发布的计划任务数值门槛与配置目标已达标；真实任务来源、账单和因果收益仍需独立核验。"
    :"当前发布具备同部署对照、足量样本、目标达标与改善证据。"};
}
