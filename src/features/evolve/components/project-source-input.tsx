

import { useEffect, useRef, useState } from "react";
import { Bot, ChevronDown, GitBranch, Loader2, MessageSquareText, Network, Paperclip, Plus, RotateCcw, Send, Unplug, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input, Textarea } from "@/components/ui/input";
import { CommandAiResultSchema, TargetAiResultSchema } from "../ai/schemas";
import { runAi, runIntake } from "../runtime/api";
import {GitRepositoryBindingSchema} from "../schemas";
import type { ArtifactKind, ArtifactRole, ConnectorRegistryCapabilities, GitTargetCapabilities } from "../schemas";
import type { ProjectRuntime } from "../runtime/use-project-runtime";
import { resetDownstream } from "../runtime/downstream";
import { CommandScopeNote } from "./stage-panels";
import { artifactProfile } from "../runtime/artifact-compatibility";
import { describeArtifact } from "../runtime/artifact-strategy";
import { compileSemanticEvolution } from "../runtime/semantic-evolution";
import { normalizeAcceptanceRubric, rubricValidation } from "../runtime/acceptance-rubric";
import { getServerConnectorCapabilities, runServerConnectorAction } from "../runtime/server-connector-client";
import {
  bindConnectorTarget,
  connectorSupportsExperiment,
  connectorSupportsFullLifecycle,
  disconnectConnectorTarget,
} from "../runtime/connector-target-binding";
import {getServerGitTargetCapabilities,runServerGitTargetAction} from "../runtime/server-git-client";
import {bindGitTarget,disconnectGitTarget} from "../runtime/git-target-binding";

const now = () => new Date().toISOString();
const preservationLabel: Record<string,string> = { "same-package": "原文件包回写", "same-format-rebuild": "原格式重建", "same-text-format": "原文本格式", "external-required": "需要外部渲染器" };
const fidelityLabel: Record<string,string> = { full: "完整保真", high: "高保真", medium: "中等保真", limited: "受限" };
type Pending = { id: string; file: File; role: ArtifactRole };

const artifactKindOptions: Array<{value:ArtifactKind;label:string}> = [
  {value:"presentation",label:"演示文稿/PPT"},{value:"codebase",label:"代码工程"},{value:"spreadsheet",label:"表格/工作簿"},{value:"workflow",label:"工作流"},{value:"prompt",label:"提示词/指令"},{value:"document",label:"文档"},{value:"knowledge",label:"知识库/语料"},{value:"image",label:"图片/视觉"},{value:"media",label:"音视频"},{value:"generic",label:"通用成果物"},
];


export function ProjectSourceInput({ runtime, onAutoRunStart }: { runtime: ProjectRuntime; onAutoRunStart: () => void }) {
  const [open, setOpen] = useState(true);
  const [files, setFiles] = useState<Pending[]>([]);
  const [command, setCommand] = useState("");
  const [pastedText, setPastedText] = useState("");
  const [showPaste, setShowPaste] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [assistantReply, setAssistantReply] = useState<string>();
  const [connectorCaps,setConnectorCaps]=useState<ConnectorRegistryCapabilities>();
  const [connectorBusy,setConnectorBusy]=useState(false);
  const [connectorMessage,setConnectorMessage]=useState("");
  const [connectorId,setConnectorId]=useState(runtime.project.targetConnection.connector?.connectorId??"");
  const [connectorTargetId,setConnectorTargetId]=useState(runtime.project.targetConnection.connector?.targetId??"");
  const [connectorRelease,setConnectorRelease]=useState(runtime.project.releaseTarget?.provider==="connector");
  const initialConnectorIdRef=useRef(runtime.project.targetConnection.connector?.connectorId??"");
  const [gitCaps,setGitCaps]=useState<GitTargetCapabilities>();
  const [gitBusy,setGitBusy]=useState(false);
  const [gitMessage,setGitMessage]=useState("");
  const [gitOwner,setGitOwner]=useState(runtime.project.targetConnection.git?.owner??"");
  const [gitRepo,setGitRepo]=useState(runtime.project.targetConnection.git?.repo??"");
  const [gitBaseBranch,setGitBaseBranch]=useState(runtime.project.targetConnection.git?.baseBranch??"main");
  const [gitPathPrefix,setGitPathPrefix]=useState(runtime.project.targetConnection.git?.pathPrefix??"");
  const inputRef = useRef<HTMLInputElement>(null);
  const p = runtime.project;

  useEffect(()=>{
    let active=true;
    void getServerConnectorCapabilities().then((capabilities)=>{
      if(!active)return;
      setConnectorCaps(capabilities);
      const eligible=capabilities.connectors.filter(connectorSupportsExperiment);
      const currentId=initialConnectorIdRef.current;
      const currentEligible=eligible.find((item)=>item.id===currentId);
      const selected=currentEligible??eligible[0];
      if(selected&&(!currentId||!currentEligible)){
        setConnectorId(selected.id);
        setConnectorRelease(connectorSupportsFullLifecycle(selected));
      }else if(!selected&&currentId){
        setConnectorId("");
        setConnectorRelease(false);
      }
    }).catch((cause)=>{
      if(active)setConnectorMessage(cause instanceof Error?cause.message:String(cause));
    });
    return()=>{active=false;};
  },[]);

  useEffect(()=>{
    let active=true;
    void getServerGitTargetCapabilities().then((capabilities)=>{
      if(active)setGitCaps(capabilities);
    }).catch((cause)=>{
      if(active)setGitMessage(cause instanceof Error?cause.message:String(cause));
    });
    return()=>{active=false;};
  },[]);

  const selectedConnector=connectorCaps?.connectors.find((item)=>item.id===connectorId);
  const experimentConnectors=connectorCaps?.connectors.filter(connectorSupportsExperiment)??[];
  const directConnectorCount=connectorCaps?.connectors.filter((item)=>item.mutationMode==="direct").length??0;
  const selectedFullLifecycle=Boolean(selectedConnector&&connectorSupportsFullLifecycle(selectedConnector));
  const remotePrimaryTarget=p.targetConnection.adapter==="connector"||p.targetConnection.adapter==="git";

  const connectConnectorTarget=async()=>{
    if(!selectedConnector)throw new Error("请选择一个具备实验生命周期的 Connector");
    const targetId=connectorTargetId.trim();
    if(!targetId)throw new Error("请输入 Connector Target ID");
    setConnectorBusy(true);
    setConnectorMessage("");
    try{
      const snapshot=await runServerConnectorAction({
        connectorId:selectedConnector.id,
        operation:"snapshot",
        missionId:p.id,
        targetId,
        payload:{purpose:"connection-preflight"},
      });
      if(!snapshot.ok||!snapshot.versionRef)throw new Error("Connector Snapshot 预检没有返回 exact versionRef");
      const next=bindConnectorTarget({
        project:p,
        manifest:selectedConnector,
        targetId,
        useForRelease:connectorRelease&&selectedFullLifecycle,
      });
      runtime.commit(()=>next);
      runtime.setStage("target");
      setConnectorMessage(`已验证 ${selectedConnector.label} / ${targetId} @ ${snapshot.versionRef}；正式运行时 Server Workflow 会重新锁定并持久化 exact snapshot。`);
    }catch(cause){
      setConnectorMessage(cause instanceof Error?cause.message:String(cause));
    }finally{
      setConnectorBusy(false);
    }
  };

  const disconnectConnector=()=>{
    runtime.commit((current)=>disconnectConnectorTarget(current));
    runtime.setStage("target");
    setConnectorMessage("已断开 Connector Target；旧 Connector Source 与下游评测已失效。");
  };

  const connectGitTarget=async()=>{
    setGitBusy(true);
    setGitMessage("");
    try{
      if(!gitCaps?.configured||!gitCaps.allowlistConfigured){
        throw new Error("GitHub Target 尚未配置 Token + Repo allowlist");
      }
      const repository=GitRepositoryBindingSchema.parse({
        provider:"github",
        owner:gitOwner.trim(),
        repo:gitRepo.trim(),
        baseBranch:gitBaseBranch.trim()||"main",
        pathPrefix:gitPathPrefix.trim()||undefined,
      });
      const snapshot=await runServerGitTargetAction({action:"snapshot",repository,missionId:p.id});
      if(!snapshot.ok||!snapshot.commitSha||!snapshot.treeSha){
        throw new Error("Git Snapshot 预检没有返回 exact commit/tree SHA");
      }
      const next=bindGitTarget({project:p,repository});
      runtime.commit(()=>next);
      runtime.setStage("target");
      setGitMessage(`已验证 ${repository.owner}/${repository.repo}@${repository.baseBranch} · 当前 commit ${snapshot.commitSha.slice(0,12)}；正式运行时 Durable Workflow 会重新锁定并持久化执行时的 exact commit。`);
    }catch(cause){
      setGitMessage(cause instanceof Error?cause.message:String(cause));
    }finally{
      setGitBusy(false);
    }
  };

  const disconnectGit=()=>{
    runtime.commit((current)=>disconnectGitTarget(current));
    runtime.setStage("target");
    setGitMessage("已断开 Git Target；旧 Git Snapshot 与下游评测已失效。");
  };

  const add = (list: FileList) => setFiles((current) => {
    const next = [...current];
    for (const [index, file] of Array.from(list).entries()) {
      if (next.some((x) => x.file.name === file.name && x.file.size === file.size)) continue;
      const role:ArtifactRole=remotePrimaryTarget
        ?"reference"
        :next.some((x) => x.role === "target")?"reference":"target";
      next.push({ id: `${Date.now()}-${index}`, file, role });
    }
    return next.slice(0, 12);
  });

  const correctArtifactKind = (artifactId: string, artifactKind: ArtifactKind) => {
    runtime.commit((current) => {
      const sourceArtifacts = current.sourceArtifacts.map((artifact) => {
        if (artifact.id !== artifactId) return artifact;
        const next = { ...artifact, artifactKind };
        return { ...next, artifactDescriptor: describeArtifact(next) };
      });
      const compiled = compileSemanticEvolution({ artifacts: sourceArtifacts, command: current.evolutionCommand });
      const semanticIds = new Set(compiled.semanticEvolution.acceptanceRubric.map((item)=>item.id));
      const acceptanceRubric = normalizeAcceptanceRubric([...compiled.semanticEvolution.acceptanceRubric, ...current.acceptanceRubric.filter((item)=>!semanticIds.has(item.id))], { protectedItems: current.protectedItems, sourceArtifacts, semanticEvolution: compiled.semanticEvolution });
      const check = rubricValidation(acceptanceRubric);
      return { ...resetDownstream({ ...current, sourceArtifacts, artifactGraph: compiled.artifactGraph, semanticEvolution: { ...compiled.semanticEvolution, acceptanceRubric }, acceptanceRubric }, {invalidateUnderstanding:true}), sourceArtifacts, artifactGraph: compiled.artifactGraph, semanticEvolution: { ...compiled.semanticEvolution, acceptanceRubric }, acceptanceRubric, acceptanceRubricState: { ...current.acceptanceRubricState, status: check.ready ? "ready" : "invalid", summary: `已按“${compiled.semanticEvolution.semanticObject.label}”重新编译动态验收标准`, weightTotal: check.weightTotal, warnings: check.warnings, compiledAt: now(), version: current.acceptanceRubricState.version + 1 } };
    });
    runtime.setStage("target");
    setAssistantReply("已修正成果物类型并重新编译业务对象、流程与验收标准。旧评测与候选已失效，请重新确认目标。 ");
  };

  const refreshTargetFromCommand = async (updatedCommand: string) => TargetAiResultSchema.parse(await runAi("target", {
    name: p.name,
    objectType: p.objectType,
    department: p.department,
    evolutionCommand: updatedCommand,
    currentGoal: p.goal,
    sourceUnderstanding: p.sourceUnderstanding,
    aiProfile: p.aiProfile,
    sourceArtifacts: p.sourceArtifacts.map((a) => ({ id: a.id, name: a.name, role: a.role, summary: a.summary, artifactKind:a.artifactKind, textExcerpt: a.textExcerpt, openaiFileId: a.openaiFileId })),
  }));

  const submit = async () => {
    if (!command.trim() && files.length === 0 && !pastedText.trim()) return;
    setBusy(true); setError(undefined); setAssistantReply(undefined);
    const userMessage = command.trim() || "请把这些新材料纳入本轮进化，并重新理解目标与边界。";
    const attachedIds = files.map((x) => x.id);
    let shouldAutoRun = false;
    try {
      if (files.length > 0 || pastedText.trim()) {
        const form = new FormData();
        form.set("command", userMessage);
        form.set("pastedText", pastedText);
        form.set("department", p.department);
        form.set("requestedObjectType", p.objectType);
        form.set("aiProfile", JSON.stringify(p.aiProfile));
        form.set("roles", JSON.stringify(files.map((item) => item.role)));
        form.set("conversation", JSON.stringify({
          currentCommand: p.evolutionCommand,
          currentUnderstanding: p.sourceUnderstanding,
          history: p.commandHistory.slice(-8),
          existingArtifacts: p.sourceArtifacts.map((a) => ({ id: a.id, name: a.name, role: a.role, summary: a.summary })),
        }));
        files.forEach((item) => form.append("files", item.file, item.file.name));
        const result = await runIntake(form);
        const reply = result.intake.currentStateSummary;
        runtime.commit((current) => {
          const remoteTarget=current.targetConnection.adapter==="connector"||current.targetConnection.adapter==="git";
          const intakeArtifacts=remoteTarget
            ?result.artifacts.map((artifact)=>artifact.role==="target"?{...artifact,role:"reference" as const}:artifact)
            :result.artifacts;
          const sourceArtifacts = [...current.sourceArtifacts, ...intakeArtifacts];
          const evolutionCommand = [current.evolutionCommand, userMessage].filter(Boolean).join("\n\n补充要求：");
          const compiled = compileSemanticEvolution({ artifacts: sourceArtifacts, command: evolutionCommand, aiSemanticObject: result.intake.semanticObject, aiWorkflowStages: result.intake.semanticWorkflowStages });
          const semanticIds = new Set(compiled.semanticEvolution.acceptanceRubric.map((item)=>item.id));
          const combined = [...compiled.semanticEvolution.acceptanceRubric, ...result.intake.acceptanceRubric.filter((item)=>!semanticIds.has(item.id))];
          const acceptanceRubric = normalizeAcceptanceRubric(combined, { protectedItems: result.intake.protectedItems, sourceArtifacts, semanticEvolution: compiled.semanticEvolution });
          const check = rubricValidation(acceptanceRubric);
          return {
            ...resetDownstream(current, {invalidateUnderstanding:true}),
            name: result.intake.projectName || current.name, objectType: result.intake.detectedObjectType, goal: result.intake.goal, evolutionCommand,
            commandHistory: [...current.commandHistory, { id: `cmd-u-${Date.now()}`, role: "user", content: userMessage, artifactIds: attachedIds, createdAt: now() }, { id: `cmd-a-${Date.now()+1}`, role: "assistant", content: reply, artifactIds: intakeArtifacts.map((a) => a.id), createdAt: now() }],
            sourceArtifacts, artifactGraph: compiled.artifactGraph, semanticEvolution: { ...compiled.semanticEvolution, acceptanceRubric, warnings: [...compiled.semanticEvolution.warnings, ...result.intake.semanticWarnings] },
            sourceUnderstanding: { currentStateSummary: result.intake.currentStateSummary, evolutionIntent: result.intake.evolutionIntent, detectedObjectType: result.intake.detectedObjectType, artifactSummaries: [...(current.sourceUnderstanding?.artifactSummaries ?? []), ...result.intake.artifactSummaries], acceptanceCriteria: result.intake.acceptanceCriteria, followUpQuestions: result.intake.followUpQuestions },
            protectedItems: result.intake.protectedItems, editableItems: result.intake.editableItems, metrics: result.intake.metrics.map((m) => ({ key: m.key, label: m.label, value: 0, unit: m.unit, target: m.target, direction: m.direction, description: m.why })),
            acceptanceRubric, acceptanceRubricState: { ...current.acceptanceRubricState, status: check.ready ? "ready" : "invalid", summary: `已按“${compiled.semanticEvolution.semanticObject.label}”重新编译动态验收标准`, version: current.acceptanceRubricState.version + 1, compiledAt: now(), weightTotal: check.weightTotal, warnings: check.warnings },
          };
        });
        setAssistantReply(reply);
        runtime.setStage("target");
        shouldAutoRun = true;
      } else {
        const result = CommandAiResultSchema.parse(await runAi("command", {
          message: userMessage,
          currentCommand: p.evolutionCommand,
          stage: runtime.stage,
          project: { name: p.name, objectType: p.objectType, goal: p.goal, metrics: p.metrics, protectedItems: p.protectedItems, editableItems: p.editableItems },
          sourceUnderstanding: p.sourceUnderstanding,
          sourceArtifacts: p.sourceArtifacts.map((a) => ({ id: a.id, name: a.name, role: a.role, summary: a.summary, textExcerpt: a.textExcerpt, openaiFileId: a.openaiFileId })),
          history: p.commandHistory.slice(-8),
          aiProfile: p.aiProfile,
        }));
        const commandChanged = result.updatedCommand.trim() !== p.evolutionCommand.trim();
        let target = null;
        if (result.shouldRefreshTarget) target = await refreshTargetFromCommand(result.updatedCommand);
        runtime.commit((current) => {
          const shouldReset = result.shouldRefreshTarget || result.updatedCommand.trim() !== current.evolutionCommand.trim();
          const base = shouldReset ? resetDownstream(current, {invalidateUnderstanding:true}) : current;
          const compiled = shouldReset ? compileSemanticEvolution({ artifacts: current.sourceArtifacts, command: result.updatedCommand }) : undefined;
          const semanticIds = new Set(compiled?.semanticEvolution.acceptanceRubric.map((item)=>item.id) ?? []);
          const acceptanceRubric = compiled ? normalizeAcceptanceRubric([...compiled.semanticEvolution.acceptanceRubric, ...current.acceptanceRubric.filter((item)=>!semanticIds.has(item.id))], { protectedItems: current.protectedItems, sourceArtifacts: current.sourceArtifacts, semanticEvolution: compiled.semanticEvolution }) : current.acceptanceRubric;
          return {
            ...base,
            evolutionCommand: result.updatedCommand,
            ...(compiled ? { artifactGraph: compiled.artifactGraph, semanticEvolution: { ...compiled.semanticEvolution, acceptanceRubric }, acceptanceRubric, acceptanceRubricState: { ...current.acceptanceRubricState, status: rubricValidation(acceptanceRubric).ready ? "ready" : "invalid", summary: `已按“${compiled.semanticEvolution.semanticObject.label}”重新编译动态验收标准`, version: current.acceptanceRubricState.version + 1, compiledAt: now(), weightTotal: rubricValidation(acceptanceRubric).weightTotal, warnings: rubricValidation(acceptanceRubric).warnings } } : {}),
            commandHistory: [
              ...current.commandHistory,
              { id: `cmd-u-${Date.now()}`, role: "user", content: userMessage, artifactIds: [], createdAt: now() },
              { id: `cmd-a-${Date.now()+1}`, role: "assistant", content: result.answer, artifactIds: [], createdAt: now() },
            ],
            protectedItems: [...new Set([...(target?.protectedItems ?? current.protectedItems), ...result.protectedItemsAdd])],
            editableItems: [...new Set([...(target?.editableItems ?? current.editableItems), ...result.editableItemsAdd])],
            goal: target?.goal ?? current.goal,
            metrics: target ? target.metrics.map((m) => ({ key: m.key, label: m.label, value: 0, unit: m.unit, target: m.target, direction: m.direction, description: m.why })) : current.metrics,
          };
        });
        if (result.shouldRefreshTarget || commandChanged) runtime.setStage("target");
        shouldAutoRun = result.shouldRefreshTarget || commandChanged;
        setAssistantReply(result.answer);
      }
      setFiles([]); setCommand(""); setPastedText(""); setShowPaste(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "更新进化输入失败");
    } finally {
      setBusy(false);
      if (shouldAutoRun) window.setTimeout(() => {
        onAutoRunStart();
        void runtime.runAutoPilot();
      }, 0);
    }
  };

  const recent = p.commandHistory.slice(-4);
  return <div className="rounded-3xl border border-sky-100 bg-gradient-to-br from-sky-50/70 via-white to-indigo-50/50 p-5 soft-shadow sm:p-6">
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <div className="flex items-center gap-2 text-sm font-semibold text-slate-800"><MessageSquareText className="size-4 text-indigo-600" />材料与改进要求</div>
        <div className="mt-1 truncate text-xs text-slate-400">{p.sourceArtifacts.length} 份材料 · {p.evolutionCommand || "继续告诉 AI 你要进化什么、怎么进化"}</div>
      </div>
      <Button variant="secondary" size="sm" onClick={() => setOpen((value) => !value)}>{open ? "收起输入台" : "继续上传 / 下命令"}<ChevronDown className={`size-3 transition ${open ? "rotate-180" : ""}`} /></Button>
    </div>

    {open && <div className="mt-5 border-t border-sky-100 pt-5">
      <div className="mb-4 rounded-2xl border border-violet-100 bg-violet-50/50 p-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <div className="flex items-center gap-2 text-xs font-semibold text-violet-900"><Network className="size-3.5"/>外部系统 Connector Target</div>
            <p className="mt-1 max-w-3xl text-[11px] leading-5 text-violet-700/80">用于直接进化 Agent、Workflow、Memory、API、数据库或 SaaS 对象。连接前先做只读 Snapshot 预检；正式实验会由 Server Workflow 锁定 exact versionRef，再执行 Candidate Mutation 与验证。</p>
          </div>
          {p.targetConnection.adapter==="connector"&&<Badge className="w-fit border-emerald-200 bg-emerald-50 text-emerald-700">已连接 {p.targetConnection.connector?.connectorId}</Badge>}
        </div>
        {connectorCaps?.configured&&experimentConnectors.length>0?<div className="mt-3 grid gap-2 lg:grid-cols-[minmax(180px,.8fr)_minmax(220px,1.2fr)_auto]">
          <select className="h-9 rounded-xl border bg-white px-3 text-xs" value={connectorId} onChange={(event)=>{
            const nextId=event.target.value;
            setConnectorId(nextId);
            const manifest=connectorCaps.connectors.find((item)=>item.id===nextId);
            setConnectorRelease(Boolean(manifest&&connectorSupportsFullLifecycle(manifest)));
          }}>
            {experimentConnectors.map((item)=><option key={item.id} value={item.id}>{item.label} · {item.targetType} · staged-version</option>)}
          </select>
          <Input value={connectorTargetId} onChange={(event)=>setConnectorTargetId(event.target.value)} placeholder="Target ID，例如 workflow-42 / agent-prod / memory-main"/>
          <div className="flex gap-2">
            <Button size="sm" disabled={connectorBusy||!connectorId||!connectorTargetId.trim()} onClick={()=>void connectConnectorTarget()}>{connectorBusy?<Loader2 className="size-3.5 animate-spin"/>:<Network className="size-3.5"/>}{p.targetConnection.adapter==="connector"?"重新绑定":"验证并连接"}</Button>
            {p.targetConnection.adapter==="connector"&&<Button size="sm" variant="secondary" disabled={connectorBusy} onClick={disconnectConnector}><Unplug className="size-3.5"/>断开</Button>}
          </div>
          <label className="lg:col-span-3 flex items-start gap-2 rounded-xl border bg-white/80 px-3 py-2 text-[11px] leading-5 text-slate-600">
            <input type="checkbox" className="mt-1" checked={connectorRelease} disabled={!selectedFullLifecycle} onChange={(event)=>setConnectorRelease(event.target.checked)}/>
            <span><b>同时作为生产 Release Target</b> · {selectedFullLifecycle?"该 Connector 已声明 staged-version 隔离并具备 7/7 Lifecycle；默认使用保守的 Preview → Promote，不假设它支持真实百分比 Canary。":"当前 Connector 仅支持隔离实验闭环；缺少 Deploy / Observe / Rollback 时不会宣称可上线。"}</span>
          </label>
        </div>:<div className="mt-3 rounded-xl border border-dashed bg-white/70 p-3 text-[11px] leading-5 text-slate-500">{connectorCaps?.configured?`已注册 Connector，但暂无同时满足 staged-version 隔离 + Read / Snapshot / Mutate / Validate + credential 的实验 Connector。${directConnectorCount?` 当前有 ${directConnectorCount} 个 direct Connector 被安全阻止进入 Candidate 实验。`:""}`:"服务器尚未配置 EVOLUTION_CONNECTORS_JSON；当前仍可继续使用文件/ZIP Artifact Target。"}</div>}
        {connectorMessage&&<div className="mt-2 text-[11px] leading-5 text-violet-700">{connectorMessage}</div>}
        {connectorCaps?.configured&&experimentConnectors.length>0&&<div className="mt-2 text-[10px] leading-4 text-violet-600">Candidate 安全边界：只有服务端 Manifest 显式声明 <code>mutationMode=staged-version</code> 才允许实验；缺省或 <code>direct</code> 一律视为可能直写线上对象并 fail-closed。</div>}
      </div>
      <div className="mb-4 rounded-2xl border border-sky-100 bg-sky-50/50 p-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <div className="flex items-center gap-2 text-xs font-semibold text-sky-900"><GitBranch className="size-3.5"/>GitHub Repository Target</div>
            <p className="mt-1 max-w-3xl text-[11px] leading-5 text-sky-700/80">直接把 allowlist 内的 GitHub 仓库作为代码进化对象。先只读验证 Branch/Commit；正式运行时由 Durable Workflow 锁定 exact commit SHA、下载仓库快照并进入同一 Artifact Intelligence / Experiment / Holdout 链。</p>
          </div>
          {p.targetConnection.adapter==="git"&&<Badge className="w-fit border-emerald-200 bg-emerald-50 text-emerald-700">已连接 {p.targetConnection.git?.owner}/{p.targetConnection.git?.repo}</Badge>}
        </div>
        {gitCaps?.configured&&gitCaps.allowlistConfigured?<div className="mt-3 grid gap-2 md:grid-cols-2 xl:grid-cols-[1fr_1fr_.8fr_1.2fr_auto]">
          <Input value={gitOwner} onChange={(event)=>setGitOwner(event.target.value)} placeholder="Owner，例如 acme"/>
          <Input value={gitRepo} onChange={(event)=>setGitRepo(event.target.value)} placeholder="Repository，例如 web-app"/>
          <Input value={gitBaseBranch} onChange={(event)=>setGitBaseBranch(event.target.value)} placeholder="Base Branch，例如 main"/>
          <Input value={gitPathPrefix} onChange={(event)=>setGitPathPrefix(event.target.value)} placeholder="可选 Path Prefix，例如 packages/web"/>
          <div className="flex gap-2">
            <Button size="sm" disabled={gitBusy||!gitOwner.trim()||!gitRepo.trim()} onClick={()=>void connectGitTarget()}>{gitBusy?<Loader2 className="size-3.5 animate-spin"/>:<GitBranch className="size-3.5"/>}{p.targetConnection.adapter==="git"?"重新绑定":"验证并连接"}</Button>
            {p.targetConnection.adapter==="git"&&<Button size="sm" variant="secondary" disabled={gitBusy} onClick={disconnectGit}><Unplug className="size-3.5"/>断开</Button>}
          </div>
          <div className="md:col-span-2 xl:col-span-5 rounded-xl border bg-white/80 px-3 py-2 text-[11px] leading-5 text-slate-600"><b>服务端边界：</b>只允许 <code>EVOLUTION_GITHUB_REPO_ALLOWLIST</code> 内仓库；凭证不下发浏览器。Webhook {gitCaps.webhookConfigured?"已配置，可接收异步状态":"尚未配置，但不影响 exact snapshot / 实验读取"}。Git Target 与 Vercel Release Target 相互独立，可按需组合。</div>
        </div>:<div className="mt-3 rounded-xl border border-dashed bg-white/70 p-3 text-[11px] leading-5 text-slate-500">Git Target 代码已就绪，但服务器尚未完成 GitHub Token + Repo allowlist 配置。配置后这里会开放仓库连接，不会把 Token 暴露到浏览器。</div>}
        {gitMessage&&<div className="mt-2 text-[11px] leading-5 text-sky-700">{gitMessage}</div>}
      </div>
      {p.semanticEvolution&&<div className="mb-4 rounded-2xl border border-indigo-100 bg-gradient-to-br from-indigo-50/80 via-white to-sky-50/60 p-4"><div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between"><div><div className="text-[10px] font-bold uppercase tracking-wider text-indigo-500">业务对象理解 · 先理解“这套东西是什么”，再决定怎么进化</div><div className="mt-1 flex flex-wrap items-center gap-2"><h4 className="text-sm font-bold text-slate-900">{p.semanticEvolution.semanticObject.label}</h4><Badge className={p.semanticEvolution.semanticObject.confidence>=.75?"border-emerald-200 bg-emerald-50 text-emerald-700":p.semanticEvolution.semanticObject.confidence>=.6?"border-amber-200 bg-amber-50 text-amber-700":"border-rose-200 bg-rose-50 text-rose-700"}>置信度 {Math.round(p.semanticEvolution.semanticObject.confidence*100)}%</Badge><Badge>{p.semanticEvolution.semanticObject.domain}</Badge></div><p className="mt-1 max-w-3xl text-[11px] leading-5 text-slate-500">{p.semanticEvolution.semanticObject.description}</p></div><div className="rounded-xl border bg-white px-3 py-2 text-[10px] text-slate-500"><b className="text-slate-700">目标结果</b><br/>{p.semanticEvolution.semanticObject.primaryOutcome}</div></div><div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{p.semanticEvolution.workflowStages.map((stage,index)=><div key={stage.id} className="rounded-xl border bg-white p-2.5"><div className="text-[9px] font-bold text-indigo-500">{index+1}. {stage.label}</div><div className="mt-1 text-[10px] leading-4 text-slate-600">{stage.flow}</div></div>)}</div>{p.semanticEvolution.semanticObject.crossArtifactRequirements.length>0&&<div className="mt-3 rounded-xl border border-sky-100 bg-sky-50/70 p-3 text-[10px] leading-4 text-sky-800"><b>联合验收：</b>{p.semanticEvolution.semanticObject.crossArtifactRequirements.join(" · ")}</div>}<div className="mt-3 text-[10px] leading-4 text-slate-400">ZIP / 文件夹只被视为容器。若识别结果不准确，直接在下方命令框说明“这套成果实际是什么、用于什么场景”，发送后系统会重新编译业务对象、流程与验收标准。</div></div>}
      {p.sourceArtifacts.filter((artifact)=>artifact.role==="target").length>0&&<div className="mb-4"><div className="mb-2 text-[10px] font-bold uppercase tracking-wider text-slate-400">要修改的成果 · 可读取和交付的范围</div><div className="grid gap-2 md:grid-cols-2">{p.sourceArtifacts.filter((artifact)=>artifact.role==="target").map((artifact)=>{const profile=artifactProfile(artifact);const descriptor=artifact.artifactDescriptor;return <div key={artifact.id} className="rounded-xl border bg-white p-3"><div className="flex items-start justify-between gap-2"><div className="min-w-0"><div className="truncate text-xs font-semibold text-slate-800">{artifact.name}</div><div className="mt-1 text-[10px] text-slate-400">{profile.label} · {profile.buildStrategy}</div></div><div className="flex shrink-0 items-center gap-1"><Badge>{descriptor?.subtype||artifact.artifactKind}</Badge><select aria-label={`修正 ${artifact.name} 的成果物类型`} className="h-6 rounded-lg border bg-white px-1.5 text-[9px] text-slate-500" value={artifact.artifactKind} onChange={(e)=>correctArtifactKind(artifact.id,e.target.value as ArtifactKind)}>{artifactKindOptions.map((item)=><option key={item.value} value={item.value}>{item.label}</option>)}</select></div></div>{descriptor&&<div className="mt-2 grid grid-cols-2 gap-1.5 text-[9px]"><div className="rounded-lg bg-emerald-50 px-2 py-1.5 text-emerald-700"><b>格式保留：</b>{preservationLabel[descriptor.preservationMode]??descriptor.preservationMode}</div><div className="rounded-lg bg-sky-50 px-2 py-1.5 text-sky-700"><b>保真：</b>{fidelityLabel[descriptor.fidelity]??descriptor.fidelity}</div></div>}<div className="mt-2 flex flex-wrap gap-1">{profile.evaluationFocus.slice(0,4).map((focus)=><span key={focus} className="rounded-md bg-slate-50 px-1.5 py-0.5 text-[9px] text-slate-500">{focus}</span>)}</div>{(descriptor?.requiredValidations?.length??0)>0&&<div className="mt-2 text-[9px] leading-4 text-slate-500"><b>专属验收：</b>{descriptor?.requiredValidations?.slice(0,3).join(" · ")}</div>}{(descriptor?.limitations?.length??0)>0&&<div className="mt-2 rounded-lg bg-amber-50 px-2 py-1.5 text-[9px] leading-4 text-amber-700">{descriptor?.limitations?.[0]}</div>}{artifact.warnings.length>0&&<div className="mt-2 text-[9px] leading-4 text-amber-600">{artifact.warnings[0]}</div>}</div>})}</div><p className="mt-2 text-[10px] leading-4 text-slate-400">请核对文件类型。格式决定当前能修改和验证哪些内容；业务目标在「理解材料与目标」中确认。无法验证的内容会明确标记，不会作为通过项。</p></div>}
      {recent.length > 0 && <div className="mb-4 max-h-56 space-y-2.5 overflow-auto rounded-2xl border bg-white/80 p-4">
        {recent.map((m) => <div key={m.id} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}><div className={`max-w-[86%] rounded-2xl px-3.5 py-2.5 text-xs leading-5 ${m.role === "user" ? "rounded-br-md bg-indigo-600 text-white" : "rounded-bl-md border bg-white text-slate-600 shadow-sm"}`}>{m.role === "assistant" && <Bot className="mr-1 inline size-3 text-indigo-500" />}<span className="whitespace-pre-wrap">{m.content}</span></div></div>)}
      </div>}
      {assistantReply && <div className="mb-3 rounded-xl border border-indigo-100 bg-indigo-50 px-3 py-2 text-xs text-indigo-700"><Bot className="mr-1 inline size-3" />{assistantReply}</div>}
      {error && <div className="mb-3 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">{error}</div>}
      {files.length > 0 && <div className="mb-3 flex flex-wrap gap-2">{files.map((item) => <div key={item.id} className="flex items-center gap-2 rounded-xl border bg-white px-2 py-1.5 text-[11px]"><span className="max-w-40 truncate">{item.file.name}</span><select className="h-6 rounded border px-1 text-[10px]" value={item.role} onChange={(e) => setFiles((current) => current.map((x) => x.id === item.id ? { ...x, role: e.target.value as ArtifactRole } : x))}><option value="target" disabled={remotePrimaryTarget}>进化对象</option><option value="reference">参考材料</option><option value="eval">测试样本</option></select><button onClick={() => setFiles((current) => current.filter((x) => x.id !== item.id))}><X className="size-3 text-slate-400" /></button></div>)}</div>}
      {showPaste && <Textarea className="mb-2 min-h-28 bg-white font-mono text-xs" value={pastedText} onChange={(e) => setPastedText(e.target.value)} placeholder="也可以直接粘贴提示词、代码、工作流 JSON、报告模板或其他待进化内容…" />}
      <div className="rounded-2xl border bg-white p-3 shadow-sm">
        <Textarea className="min-h-20 resize-none border-0 bg-transparent shadow-none focus-visible:ring-0" value={command} onChange={(e) => setCommand(e.target.value)} placeholder="告诉 AI 这次要怎么进化。例如：保留输出字段不变，把证据引用和风险反证做得更严格；参考我上传的优秀样例。" />
        <div className="mt-1 flex flex-wrap items-center gap-2 border-t px-1 pt-2.5">
          <input ref={inputRef} type="file" multiple className="hidden" accept=".txt,.md,.mdx,.json,.yaml,.yml,.csv,.tsv,.pdf,.doc,.docx,.ppt,.pptx,.xls,.xlsx,.zip,.html,.xml,.js,.jsx,.ts,.tsx,.py,.go,.rs,.java,.sql,.css,.mp3,.wav,.ogg,.m4a,.mp4,.mov,.avi,.webm,image/*,audio/*,video/*" onChange={(e) => { if (e.target.files) add(e.target.files); e.currentTarget.value = ""; }} />
          <Button variant="ghost" size="sm" onClick={() => inputRef.current?.click()}><Paperclip className="size-4" />上传附件</Button>
          <Button variant="ghost" size="sm" onClick={() => setShowPaste((x) => !x)}><Plus className="size-4" />粘贴内容</Button>
          <div className="ml-auto flex gap-2"><Button variant="ghost" size="sm" onClick={() => { setFiles([]); setCommand(""); setPastedText(""); }}><RotateCcw className="size-3" />清空</Button><Button size="sm" disabled={busy || runtime.status.busy || (!command.trim() && files.length === 0 && !pastedText.trim())} onClick={() => void submit()}>{busy ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}{p.sourceArtifacts.some((artifact)=>artifact.role==="target") ? "更新并自动进化" : "开始自动进化"}</Button></div>
        </div>
      </div>
      <CommandScopeNote compact />
      <div className="mt-3 text-[11px] leading-5 text-slate-400">上传新的进化对象或修改关键要求后，系统会自动使旧目标、评测、候选和发布结论失效，并要求重新确认目标，避免拿旧结论验证新对象。</div>
    </div>}
  </div>;
}
