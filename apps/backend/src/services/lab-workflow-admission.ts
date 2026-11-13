import type {LabWorkflowPermit} from "@evolution/contracts";
import {inspectIsolatedLabRuntime} from "../isolated-lab-runtime";
import {getServerAiConnectionStatus,resolveServerAiConfigForRole} from "./server-ai-connection";
import {assertLabMiniMaxSubscriptionRoutes} from "./server-ai-lab-budget-dispatch";
import {assertMiniMaxSubscriptionQuotaSufficient,fetchMiniMaxSubscriptionQuota} from "./server-ai-minimax-subscription-quota";
import {assertLabMissionArmed,createLabWorkflowPermit,LabWorkflowAdmissionError} from "./lab-workflow-permit";

const deny=(code:string,message:string):never=>{throw new LabWorkflowAdmissionError(code,message);};
const normalize=(value:string)=>value.replace(/\/+$/,"");
const normalizeModel=(value:string)=>value.toLowerCase().replace(/[-_.]preview$/,"");

/** Governed route calls security.admin first; quota reads use existing Vault Subscription Keys only. */
export async function prepareLabWorkflowStart(args:{
  missionId:string;actorId:string;requestedAt:string;isExecutableHtml:boolean;
  approval:"explicit-synthetic-lab-v1"|undefined;scheduledFor?:string;
}):Promise<LabWorkflowPermit|undefined>{
  if(process.env.EVOLUTION_EXPERIMENT_MODE!=="isolated"){
    if(args.approval)return deny("LAB_APPROVAL_OUTSIDE_ISOLATION","隔离 Lab 审批不可用于其他环境。");
    return undefined;
  }
  if(args.approval!=="explicit-synthetic-lab-v1"||args.scheduledFor){
    return deny("LAB_EXPLICIT_APPROVAL_REQUIRED","隔离 Lab 只能以显式授权启动一次性合成任务，不允许后台排程。");
  }
  assertLabMissionArmed(args.missionId);
  if(!inspectIsolatedLabRuntime(process.env).ready){
    return deny("LAB_RUNTIME_NOT_ISOLATED","隔离 Lab 身份、数据库或凭据未通过独立校验。");
  }
  if(!args.isExecutableHtml){
    return deny("LAB_SYNTHETIC_HTML_REQUIRED","隔离 Lab 实验仅允许审批过的合成 HTML Mission。");
  }
  const [generationStatus,judgeStatus]=await Promise.all([
    getServerAiConnectionStatus("generation"),getServerAiConnectionStatus("judge"),
  ]);
  if(!generationStatus.configured||!judgeStatus.configured
    ||!generationStatus.connection||!judgeStatus.connection){
    return deny("LAB_INDEPENDENT_JUDGE_REQUIRED","Lab 尚未保存生成和独立 Judge 的模型角色。");
  }
  const gen=generationStatus.connection,judge=judgeStatus.connection;
  if(normalizeModel(gen.model)===normalizeModel(judge.model)&&normalize(gen.baseUrl)===normalize(judge.baseUrl)){
    return deny("LAB_GENERATOR_EQUALS_JUDGE","Lab 生成模型与 Judge 公共路由相同，禁止自我验收。");
  }
  const routes=[{model:gen.model,baseUrl:gen.baseUrl},{model:judge.model,baseUrl:judge.baseUrl}];
  assertLabMiniMaxSubscriptionRoutes(routes);
  const [generationConfig,judgeConfig]=await Promise.all([
    resolveServerAiConfigForRole("generation"),resolveServerAiConfigForRole("judge"),
  ]);
  if(!generationConfig||!judgeConfig){
    return deny("LAB_INDEPENDENT_JUDGE_REQUIRED","Lab 生成或 Judge 的服务端 Vault 连接无法解析。");
  }
  if(generationConfig.mode!=="openai-compatible"||judgeConfig.mode!=="openai-compatible"
    ||generationConfig.model!==gen.model||judgeConfig.model!==judge.model
    ||normalize(generationConfig.baseUrl)!==normalize(gen.baseUrl)
    ||normalize(judgeConfig.baseUrl)!==normalize(judge.baseUrl)){
    return deny("LAB_VAULT_ROUTE_CHANGED","审批期间模型路由发生变化，需重新检查生成和 Judge 的已保存连接。");
  }
  const [generationQuota,judgeQuota]=await Promise.all([
    fetchMiniMaxSubscriptionQuota(generationConfig),fetchMiniMaxSubscriptionQuota(judgeConfig),
  ]);
  assertMiniMaxSubscriptionQuotaSufficient(generationQuota);
  assertMiniMaxSubscriptionQuotaSufficient(judgeQuota);
  return createLabWorkflowPermit(args.missionId,args.actorId,args.requestedAt);
}