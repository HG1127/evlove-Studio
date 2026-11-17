import {EvolutionWorkflowStartResponseSchema,MissionEnvelopeSchema} from "@evolution/contracts";
import {P3X_BLOB_ID,P3X_MISSION_ID} from "./p3x-source-binding";

const ORIGINAL_SHA="192abea39d167d9c0f4310fc603905905de5fa44106685fc7d6ea3d2931da8dc";
export const P3X_SINGLE_RUN_KEY="p3x-synthetic-html-one-generation-20261117-v1";
const MAX_QUOTA_AGE_MS=30_000;

async function jsonApi(path:string,init:RequestInit={}):Promise<unknown>{
  const result=await fetch("/api/evolution"+path,{
    credentials:"same-origin",cache:"no-store",signal:AbortSignal.timeout(init.method==="POST"?120_000:15_000),
    ...init,
  });
  let data:unknown;
  try{data=await result.json();}catch{throw Error("Lab API 响应不可解析，停止后续执行。");}
  if(!result.ok){
    const d=data&&typeof data==="object"?data as {data?:{code?:string};statusMessage?:string}:undefined;
    const code=typeof d?.data?.code==="string"?d.data.code.slice(0,90):"";
    throw Error("Lab 审批或执行门禁未通过（HTTP "+result.status+(code?", "+code:"")+"）；不得自动重试。");
  }
  return data;
}
type QuotaRow={model?:string;quota?:{
  intervalRemainingPercent?:number;weeklyRemainingPercent?:number;
  intervalStatus?:number;weeklyStatus?:number;observedAt?:string;
}};
function quotaSafe(q:QuotaRow|undefined,model:string){
  if(q?.model!==model)return false;
  const x=q.quota;
  const at=Date.parse(x?.observedAt??"");
  return Boolean(x&&x.intervalRemainingPercent!==undefined&&x.weeklyRemainingPercent!==undefined
    &&x.intervalRemainingPercent>=50&&x.weeklyRemainingPercent>=50
    &&x.intervalStatus===1&&x.weeklyStatus===1
    &&Number.isFinite(at)&&Math.abs(Date.now()-at)<=MAX_QUOTA_AGE_MS);
}

/** One-click, operator-initiated P3-X start with no background retries.
 * The backend remains authoritative for approval, real Sandbox preflight,
 * Control Job, immutable budget reservation, and every physical model call.
 */
export async function startAuthorizedP3XSmoke(){
  const integrity=await jsonApi("/lab-job-integrity") as {mode?:string;status?:string;issues?:unknown[]};
  if(integrity.mode!=="read-only"||integrity.status!=="clear"
    ||!Array.isArray(integrity.issues)||integrity.issues.length!==0){
    throw Error("Lab 全局 Job 完整性未通过，真实烟测未启动。");
  }
  const mission=MissionEnvelopeSchema.parse(await jsonApi("/missions/"+P3X_MISSION_ID));
  const src=mission.payload.sourceArtifacts[0];
  if(mission.missionId!==P3X_MISSION_ID||mission.revision<2||mission.payload.campaign.status!=="idle"
    ||mission.payload.candidates.length!==0||mission.payload.sourceArtifacts.length!==1
    ||src?.id!=="source-task-board"||src?.storageRef!==P3X_BLOB_ID
    ||src.mutationGovernance?.parentSha256!==ORIGINAL_SHA){
    throw Error("冻结原版、Revision 或 Mission 运行状态异常，停止启动。");
  }
  const ready=await jsonApi("/lab-three-generation-readiness") as {
    mode?:string;status?:string;blockers?:string[];missionReady?:boolean;
    approvedMissionConfigured?:boolean;
  };
  if(ready.mode!=="read-only"||ready.status!=="preflight-clear"
    ||ready.missionReady!==true||ready.approvedMissionConfigured!==true
    ||!Array.isArray(ready.blockers)||ready.blockers.length!==0){
    const code=(ready.blockers||[]).filter(x=>typeof x==="string").slice(0,4).join(",");
    throw Error("P3-X 服务端执行许可或 Lab 门禁未通过"+(code?"："+code:"")+"，没有启动模型。");
  }
  const quota=await jsonApi("/minimax-subscription-quota") as {
    provider?:string;status?:string;checkedAt?:string;
    roles?:{generation?:QuotaRow;judge?:QuotaRow};
  };
  if(quota.provider!=="minimax-m-plan"||quota.status!=="verified"
    ||!quotaSafe(quota.roles?.generation,"MiniMax-M3")
    ||!quotaSafe(quota.roles?.judge,"MiniMax-M3.1-Flash")){
    throw Error("生成/Judge 实时额度、模型身份或回执新鲜度不满足门槛；停止启动。");
  }
  const receipt=EvolutionWorkflowStartResponseSchema.parse(await jsonApi("/start",{
    method:"POST",headers:{"Content-Type":"application/json"},
    body:JSON.stringify({
      missionId:P3X_MISSION_ID,idempotencyKey:P3X_SINGLE_RUN_KEY,
      labExperimentApproval:"explicit-synthetic-lab-v1",
    }),
  }));
  if(receipt.missionId!==P3X_MISSION_ID||receipt.reused===true){
    throw Error("后台返回了意外的历史 Workflow 回执，请核对控制 Job，不得重试。");
  }
  return receipt;
}
