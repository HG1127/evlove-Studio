import type {EvolutionEvent,EvolutionJob,EvolveProject,ProductionRuntimePorts} from "@evolution/contracts";

export class ExecutionContextIdentityError extends Error{
  constructor(readonly kind:"mission"|"job"){
    super(kind==="mission"?"Mission not found":"Job not found for Mission");
    this.name="ExecutionContextIdentityError";
  }
}

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
  if(!mission||mission.id!==missionId)throw new ExecutionContextIdentityError("mission");

  const job=jobId?await runtime.jobs.get(jobId):undefined;
  if(jobId&&(!job||job.id!==jobId||job.missionId!==missionId)){
    throw new ExecutionContextIdentityError("job");
  }
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
