import type {EvolutionEvent,EvolutionJob,EvolveProject,ProductionRuntimePorts} from "@evolution/contracts";

export type EvolutionExecutionContext={
  mission:EvolveProject;
  job?:EvolutionJob;
  checkpoint?:EvolveProject["campaign"]["checkpoint"];
  recentEvents:EvolutionEvent[];
  metadata:{createdAt:string;source:"backend-execution-context"};
};

export async function buildExecutionContext(
  runtime:ProductionRuntimePorts,
  missionId:string,
  jobId?:string,
):Promise<EvolutionExecutionContext>{
  const mission=await runtime.missions.get(missionId);
  if(!mission)throw new Error(`Mission not found: ${missionId}`);

  const job=jobId?await runtime.jobs.get(jobId):undefined;
  const recentEvents=await runtime.events.list(missionId,50);

  return {
    mission,
    job,
    checkpoint:mission.campaign.checkpoint,
    recentEvents,
    metadata:{
      createdAt:new Date().toISOString(),
      source:"backend-execution-context",
    },
  };
}
