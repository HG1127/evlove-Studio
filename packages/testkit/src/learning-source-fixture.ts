import type {EvolveProject} from "@evolution/contracts";
import {withMeasuredProductionGoal} from "./production-goal-fixture";

/** Synthetic source identities and statistics; never real production/transfer evidence. */
export function syntheticLearningProject():EvolveProject{
  const observedAt="2026-09-20T15:00:00.000Z";
  return withMeasuredProductionGoal({
    id:"mission-learning",
    releaseTarget:{provider:"vercel",mode:"preview-promote",status:"connected",label:"Vercel"},
    targetConnection:{adapter:"artifact",connectionId:"artifact",status:"connected",label:"Artifact"},
    release:{
      status:"promoted",candidateId:"C1",deploymentId:"dpl-c1",stableDeploymentId:"dpl-stable",
      trafficPercent:100,healthy:true,kpis:[],evidenceMode:"live",observationStatus:"healthy",
      environment:"production",observedAt,history:[],
      observations:[
        {id:"h1",at:"2026-09-20T14:59:00.000Z",source:"release-action",action:"promote",candidateId:"C1",deploymentId:"dpl-c1",evidenceMode:"live",environment:"production",healthy:true,observationStatus:"healthy",reason:"synthetic promote"},
        {id:"h2",at:observedAt,source:"reconcile",action:"reconcile",candidateId:"C1",deploymentId:"dpl-c1",evidenceMode:"live",environment:"production",healthy:true,observationStatus:"healthy",reason:"synthetic refresh"},
      ],
    },
    candidates:[{id:"C1",artifactSnapshots:[{id:"snap-c1",sourceArtifactId:"source-c1",contentHash:"hash-c1"}]}],
    searchChampion:{candidate:{id:"C1"}},
    experimentRun:{winnerId:"C1"},
    validationRun:{id:"validation-c1",candidateId:"C1"},
    lessons:[],nextQueue:[],
  } as unknown as EvolveProject);
}
