import type {EvolveProject} from "@evolution/contracts";

const SERVER_RELEASE_FIELDS=[
  "status","candidateId","trafficPercent","healthy","kpis","evidenceMode","observationStatus",
  "stableDeploymentId","deploymentId","artifactHash","artifactHashes","environment","observedAt",
  "sampleSize","windowMinutes","recovery","observations","history",
] as const satisfies ReadonlyArray<keyof EvolveProject["release"]>;

function json(value:unknown){return JSON.stringify(value??null);}

export function assertClientControlOwnerMutationSafe(current:EvolveProject|undefined,next:EvolveProject){
  if(json(current?.campaign.serverControlOwner)!==json(next.campaign.serverControlOwner)){
    throw new Error("后台控制预留只能通过专用 Workflow API 修改");
  }
}

export function assertClientMissionMutationSafe(current:EvolveProject,next:EvolveProject){
  assertClientControlOwnerMutationSafe(current,next);
  const currentGate=current.gates.find((gate)=>gate.id==="release-ready");
  const nextGate=next.gates.find((gate)=>gate.id==="release-ready");
  if(json(currentGate)!==json(nextGate)){
    throw new Error("Release Ready Gate 只能通过专用 Release Approval API 修改");
  }
  for(const field of SERVER_RELEASE_FIELDS){
    if(json(current.release[field])!==json(next.release[field])){
      throw new Error(`Release production fact "${field}" is server-owned and cannot be changed through generic Mission PUT`);
    }
  }
}
