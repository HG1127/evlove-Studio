import {useEffect,useState} from "react";
import {Link} from "react-router-dom";
import {readServerAiConnection} from "../ai/server-connection-client";
import {productionRuntimeMode} from "../runtime/production-runtime";

type Role="generation"|"judge";
type SavedRole={
  state:"loading"|"saved"|"not-configured"|"storage-unavailable"|"unverified";
  label?:string;
  model?:string;
  revision?:number;
};
type SavedRoles=Record<Role,SavedRole>;
const loading:SavedRoles={generation:{state:"loading"},judge:{state:"loading"}};

function fromResponse(result:PromiseSettledResult<Awaited<ReturnType<typeof readServerAiConnection>>>):SavedRole{
  if(result.status==="rejected")return {state:"unverified"};
  const data=result.value;
  if(!data.storageConfigured)return {state:"storage-unavailable"};
  if(!data.configured)return {state:"not-configured"};
  if(!data.connection||data.revision===undefined)return {state:"unverified"};
  return {state:"saved",label:data.connection.label,model:data.connection.model,revision:data.revision};
}
function roleText(role:SavedRole){
  switch(role.state){
    case "loading":return "正在只读回查后端配置…";
    case "storage-unavailable":return "后端加密存储状态不可用；不能据此判断浏览器路由";
    case "not-configured":return "后端没有已保存的此角色配置";
    case "unverified":return "后端配置读取或回执未确认；不能推断模型不可用";
    case "saved":return `已保存 · ${role.label} · ${role.model}（版本 ${role.revision}；真实调用未验证）`;
  }
}

/** Displays configured Vault roles, NOT the model identity of a historical
 * experiment. The only requests are read-only GETs; no probe, PUT or model call.
 */
export function ExperimentModelProvenance(){
  const mode=productionRuntimeMode();
  const [roles,setRoles]=useState<SavedRoles>(loading);
  useEffect(()=>{
    if(mode!=="http")return;
    let active=true;
    void Promise.allSettled([readServerAiConnection("generation"),readServerAiConnection("judge")])
      .then(([generation,judge])=>{
        if(active)setRoles({generation:fromResponse(generation),judge:fromResponse(judge)});
      });
    return()=>{active=false;};
  },[mode]);
  return <div role="note" aria-label="实验模型来源说明" className="rounded-xl border border-indigo-100 bg-indigo-50/40 p-4 text-xs leading-6 text-slate-700">
    <div className="font-semibold text-slate-800">模型身份分层：已保存配置 ≠ 实际运行证据</div>
    {mode==="http"?<div className="mt-2 grid gap-1 sm:grid-cols-2">
      <div>后端 Vault 生成：<span className="font-medium">{roleText(roles.generation)}</span></div>
      <div>后端 Vault 独立 Judge：<span className="font-medium">{roleText(roles.judge)}</span></div>
    </div>:<p className="mt-2">当前为浏览器本地原型；不代表后端 Vault 已保存、已调用或已完成验证。</p>}
    <p className="mt-2 text-slate-600">浏览器本地 BYOK 路由与后端 Vault 是不同配置来源；已保存的模型不等于已连通或已执行。这里显示的配置不应代替历史实验的 Run / Trace / Judge 身份回执；没有实际实验时不展示虚构的生成或评测模型。</p>
    <Link to="/settings" className="font-semibold text-indigo-700 underline underline-offset-2">查看模型连接和独立验收配置</Link>
  </div>;
}
