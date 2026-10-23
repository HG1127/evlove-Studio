import {Activity,AlertTriangle,CheckCircle2,RefreshCcw} from "lucide-react";
import {Button} from "@/components/ui/button";
import type {ServerMissionControlState} from "../runtime/use-server-mission-control";

/**
 * This is the durable backend report, not a projection of the browser's
 * local Project. Keep it visible before "Start/Continue" so a stale local
 * "等待启动" cannot hide an existing Workflow.
 */
export function ServerMissionStatusCard({
  control,onOpenRuntime,
}:{
  control:ServerMissionControlState;onOpenRuntime:()=>void;
}){
  const {inspection,error,checking,blocked,refresh}=control;
  const success=inspection?.state==="ready"||inspection?.state==="completed";
  const detail=checking?"正在通过已登录会话核对 Mission、Job 与 Workflow…"
    :error?"后端状态无法核实："+error
    :inspection?.reason??"尚未取得后端工作流凭证，禁止重复启动。";
  const title=checking?"正在核对后端真实任务"
    :error?"后端运行状态未确认"
    :inspection?.state==="ready"?"后端确认可以启动"
    :inspection?.state==="completed"?"后端成果已经验收完成"
    :inspection?.state==="active"?"已有后端进化任务"
    :"后端断点需要检查";
  return <section id="server-mission-durable-status" aria-label="真实后端运行状态"
    className={`rounded-xl border p-4 ${success?"border-emerald-200 bg-emerald-50/50":"border-amber-200 bg-amber-50/60"}`}>
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex items-center gap-2 text-sm font-semibold">
        {success?<CheckCircle2 className="size-4 text-emerald-600"/>:
          checking?<RefreshCcw className="size-4 animate-spin text-amber-600"/>:
          <AlertTriangle className="size-4 text-amber-600"/>}
        <span>{title}</span>
      </div>
      <div className="flex gap-2">
        <Button size="sm" variant="secondary" onClick={refresh} aria-label={checking?"取消当前读取并重新查询后端状态":"刷新后端状态"}>
          <RefreshCcw className={`size-3.5 ${checking?"animate-spin":""}`}/>{checking?"重新查询":"刷新后端状态"}
        </Button>
        <Button size="sm" variant="secondary" onClick={onOpenRuntime}>
          <Activity className="size-3.5"/>技术运行记录
        </Button>
      </div>
    </div>
    <p className="mt-2 text-xs leading-5 text-slate-700">{detail}</p>
    {inspection&&<div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-[11px] text-slate-600">
      <span>后端版本：rev {inspection.revision}</span>
      <span>Mission 阶段：{inspection.stage}</span>
      <span>Campaign：{inspection.campaignStatus}</span>
      <span>候选数量：{inspection.candidateCount}</span>
      <span>已验收主文件：{inspection.acceptedOutputs}</span>
      {inspection.checkpoint&&<span>最近检查点：{inspection.checkpoint}</span>}
      {inspection.latestJob&&<span>Job：{inspection.latestJob.status}</span>}
      {inspection.workflowStatus&&<span>Workflow：{inspection.workflowStatus}</span>}
    </div>}
    {inspection?.latestJob&&<details className="mt-2 text-[11px] text-slate-600">
      <summary className="cursor-pointer font-semibold">查看已有 Job 与 Workflow 身份</summary>
      <p className="mt-2 break-all">Job：{inspection.latestJob.id}</p>
      {inspection.runId&&<p className="break-all">Run：{inspection.runId}</p>}
      {inspection.latestJob.error&&<p className="mt-1 text-rose-700">最近错误：{inspection.latestJob.error}</p>}
    </details>}
    {blocked&&<p className="mt-2 text-xs font-medium text-amber-950">
      为防止重复启动，已暂时禁用此页面的自主进化按钮。请先核验既有 Run 与断点。
    </p>}
  </section>;
}
