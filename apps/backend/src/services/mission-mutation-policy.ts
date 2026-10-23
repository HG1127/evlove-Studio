import type {EvolveProject} from "@evolution/contracts";

const SERVER_RELEASE_FIELDS=[
  "status","candidateId","trafficPercent","healthy","kpis","evidenceMode","observationStatus",
  "stableDeploymentId","deploymentId","artifactHash","artifactHashes","environment","observedAt",
  "sampleSize","windowMinutes","recovery","observations","history","goalEvidence",
] as const satisfies ReadonlyArray<keyof EvolveProject["release"]>;

function json(value:unknown){return JSON.stringify(value??null);}

export function assertClientMissionMutationSafe(current:EvolveProject,next:EvolveProject){
  const reset=next.baselineRun;
  const emptyBaselineReset=Boolean(reset?.id&&reset.id!==current.baselineRun?.id&&reset.status==="idle"
    &&reset.runs.length===0&&!reset.result&&!reset.startedAt&&!reset.completedAt&&!reset.measurementFingerprint
    &&reset.originalReferences===undefined&&reset.referenceOnlyCriterionIds===undefined);
  if(json(current.baselineRun?.originalReferences)!==json(next.baselineRun?.originalReferences)
    ||json(current.baselineRun?.referenceOnlyCriterionIds)!==json(next.baselineRun?.referenceOnlyCriterionIds)){
    if(!emptyBaselineReset)throw new Error("原版字节参照及初次 Baseline 对照标记是 server-owned，只能随全新空白 Baseline 一并清除，不能通过通用 Mission PUT 签发或改写");
  }
  if(json(current.finalHoldout)!==json(next.finalHoldout))throw new Error("独立终验预留题集是 server-owned，不能通过通用 Mission PUT 改写");
  if(json(current.supersededFinalHoldouts)!==json(next.supersededFinalHoldouts))throw new Error("历史独立终验题集是 server-owned，不能通过通用 Mission PUT 改写");
  if(next.validationRun.independentFinal&&json(current.validationRun.independentFinal)!==json(next.validationRun.independentFinal))throw new Error("独立终验凭证是 server-owned，不能通过通用 Mission PUT 签发");
  for(const candidate of current.candidates){
    const updated=next.candidates.find(item=>item.id===candidate.id);
    if(candidate.finalHoldoutPaperHash&&updated&&candidate.finalHoldoutPaperHash!==updated.finalHoldoutPaperHash)throw new Error("候选的独立终验绑定是 server-owned，不能移除或替换");
  }
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
