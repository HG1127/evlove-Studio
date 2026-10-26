import {OUTCOME_MEASUREMENT_POLICY,OutcomeAnalyticsResponseSchema,type EvolveProject} from "@evolution/contracts";
import {productionGoalFingerprint} from "@evolution/core";

/** Explicit synthetic statistics for contract tests; never used by production composition. */
export function withMeasuredProductionGoal(project:EvolveProject,at=project.release.observedAt??new Date().toISOString()):EvolveProject{
  const metrics=project.metrics?.filter(metric=>metric.target!==undefined)??[];
  const p={...project,id:project.id??"synthetic-mission",metrics:metrics.length?metrics:[{key:"conversion",label:"conversion",value:10,target:20,direction:"higher" as const,unit:"%"}],
    release:{...project.release,stableDeploymentId:project.release.stableDeploymentId??"synthetic-stable"}};
  const analysis=OutcomeAnalyticsResponseSchema.parse({missionId:p.id,candidateId:p.release.candidateId,checkedAt:at,sampleCount:60,minimumSamplesPerArm:30,
    measurementPolicy:OUTCOME_MEASUREMENT_POLICY,independentSampleCount:60,excludedSampleCount:0,droppedSampleCount:0,observationConflictCount:0,
    metrics:p.metrics.map(metric=>{
      const mean=metric.direction==="higher"?metric.target!+1:metric.target!-1;
      return {metricKey:metric.key,metricKind:"business",direction:metric.direction,unit:metric.unit,segment:"all",
        stable:{count:30,mean:metric.direction==="higher"?mean-10:mean+10},candidate:{count:30,mean},
        evidenceStatus:"estimated",significance:"significant-improvement",favorable:true,pValueApprox:0.001};
    }),drift:[],regressions:[],verdict:"healthy",message:"SYNTHETIC contract evidence"});
  return {...p,release:{...p.release,goalEvidence:{schemaVersion:"production-goal-v1",missionId:p.id,candidateId:p.release.candidateId!,
    deploymentId:p.release.deploymentId!,stableDeploymentId:p.release.stableDeploymentId,goalFingerprint:productionGoalFingerprint(p),checkedAt:at,analysis}}};
}
