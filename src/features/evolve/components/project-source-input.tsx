

import { useRef, useState } from "react";
import { Bot, ChevronDown, Loader2, MessageSquareText, Paperclip, Plus, RotateCcw, Send, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/input";
import { CommandAiResultSchema, TargetAiResultSchema } from "../ai/schemas";
import { runAi, runIntake } from "../runtime/api";
import type { ArtifactKind, ArtifactRole } from "../schemas";
import type { ProjectRuntime } from "../runtime/use-project-runtime";
import { resetDownstream } from "../runtime/downstream";
import { CommandScopeNote } from "./stage-panels";
import { artifactProfile } from "../runtime/artifact-compatibility";
import { describeArtifact } from "../runtime/artifact-strategy";
import { compileSemanticEvolution } from "../runtime/semantic-evolution";
import { normalizeAcceptanceRubric, rubricValidation } from "../runtime/acceptance-rubric";

const now = () => new Date().toISOString();
const preservationLabel: Record<string,string> = { "same-package": "原文件包回写", "same-format-rebuild": "原格式重建", "same-text-format": "原文本格式", "external-required": "需要外部渲染器" };
const fidelityLabel: Record<string,string> = { full: "完整保真", high: "高保真", medium: "中等保真", limited: "受限" };
type Pending = { id: string; file: File; role: ArtifactRole };

const artifactKindOptions: Array<{value:ArtifactKind;label:string}> = [
  {value:"presentation",label:"演示文稿/PPT"},{value:"codebase",label:"代码工程"},{value:"spreadsheet",label:"表格/工作簿"},{value:"workflow",label:"工作流"},{value:"prompt",label:"提示词/指令"},{value:"document",label:"文档"},{value:"knowledge",label:"知识库/语料"},{value:"image",label:"图片/视觉"},{value:"media",label:"音视频"},{value:"generic",label:"通用成果物"},
];


export function ProjectSourceInput({ runtime }: { runtime: ProjectRuntime }) {
  const [open, setOpen] = useState(true);
  const [files, setFiles] = useState<Pending[]>([]);
  const [command, setCommand] = useState("");
  const [pastedText, setPastedText] = useState("");
  const [showPaste, setShowPaste] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [assistantReply, setAssistantReply] = useState<string>();
  const inputRef = useRef<HTMLInputElement>(null);
  const p = runtime.project;

  const add = (list: FileList) => setFiles((current) => {
    const next = [...current];
    for (const [index, file] of Array.from(list).entries()) {
      if (next.some((x) => x.file.name === file.name && x.file.size === file.size)) continue;
      next.push({ id: `${Date.now()}-${index}`, file, role: next.some((x) => x.role === "target") ? "reference" : "target" });
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
          const sourceArtifacts = [...current.sourceArtifacts, ...result.artifacts];
          const evolutionCommand = [current.evolutionCommand, userMessage].filter(Boolean).join("\n\n补充要求：");
          const compiled = compileSemanticEvolution({ artifacts: sourceArtifacts, command: evolutionCommand, aiSemanticObject: result.intake.semanticObject, aiWorkflowStages: result.intake.semanticWorkflowStages });
          const semanticIds = new Set(compiled.semanticEvolution.acceptanceRubric.map((item)=>item.id));
          const combined = [...compiled.semanticEvolution.acceptanceRubric, ...result.intake.acceptanceRubric.filter((item)=>!semanticIds.has(item.id))];
          const acceptanceRubric = normalizeAcceptanceRubric(combined, { protectedItems: result.intake.protectedItems, sourceArtifacts, semanticEvolution: compiled.semanticEvolution });
          const check = rubricValidation(acceptanceRubric);
          return {
            ...resetDownstream(current, {invalidateUnderstanding:true}),
            name: result.intake.projectName || current.name, objectType: result.intake.detectedObjectType, goal: result.intake.goal, evolutionCommand,
            commandHistory: [...current.commandHistory, { id: `cmd-u-${Date.now()}`, role: "user", content: userMessage, artifactIds: attachedIds, createdAt: now() }, { id: `cmd-a-${Date.now()+1}`, role: "assistant", content: reply, artifactIds: result.artifacts.map((a) => a.id), createdAt: now() }],
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
      if (shouldAutoRun) window.setTimeout(() => void runtime.runAutoPilot(), 0);
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
      {p.semanticEvolution&&<div className="mb-4 rounded-2xl border border-indigo-100 bg-gradient-to-br from-indigo-50/80 via-white to-sky-50/60 p-4"><div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between"><div><div className="text-[10px] font-bold uppercase tracking-wider text-indigo-500">业务对象理解 · 先理解“这套东西是什么”，再决定怎么进化</div><div className="mt-1 flex flex-wrap items-center gap-2"><h4 className="text-sm font-bold text-slate-900">{p.semanticEvolution.semanticObject.label}</h4><Badge className={p.semanticEvolution.semanticObject.confidence>=.75?"border-emerald-200 bg-emerald-50 text-emerald-700":p.semanticEvolution.semanticObject.confidence>=.6?"border-amber-200 bg-amber-50 text-amber-700":"border-rose-200 bg-rose-50 text-rose-700"}>置信度 {Math.round(p.semanticEvolution.semanticObject.confidence*100)}%</Badge><Badge>{p.semanticEvolution.semanticObject.domain}</Badge></div><p className="mt-1 max-w-3xl text-[11px] leading-5 text-slate-500">{p.semanticEvolution.semanticObject.description}</p></div><div className="rounded-xl border bg-white px-3 py-2 text-[10px] text-slate-500"><b className="text-slate-700">目标结果</b><br/>{p.semanticEvolution.semanticObject.primaryOutcome}</div></div><div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{p.semanticEvolution.workflowStages.map((stage,index)=><div key={stage.id} className="rounded-xl border bg-white p-2.5"><div className="text-[9px] font-bold text-indigo-500">{index+1}. {stage.label}</div><div className="mt-1 text-[10px] leading-4 text-slate-600">{stage.flow}</div></div>)}</div>{p.semanticEvolution.semanticObject.crossArtifactRequirements.length>0&&<div className="mt-3 rounded-xl border border-sky-100 bg-sky-50/70 p-3 text-[10px] leading-4 text-sky-800"><b>联合验收：</b>{p.semanticEvolution.semanticObject.crossArtifactRequirements.join(" · ")}</div>}<div className="mt-3 text-[10px] leading-4 text-slate-400">ZIP / 文件夹只被视为容器。若识别结果不准确，直接在下方命令框说明“这套成果实际是什么、用于什么场景”，发送后系统会重新编译业务对象、流程与验收标准。</div></div>}
      {p.sourceArtifacts.filter((artifact)=>artifact.role==="target").length>0&&<div className="mb-4"><div className="mb-2 text-[10px] font-bold uppercase tracking-wider text-slate-400">要修改的成果 · 可读取和交付的范围</div><div className="grid gap-2 md:grid-cols-2">{p.sourceArtifacts.filter((artifact)=>artifact.role==="target").map((artifact)=>{const profile=artifactProfile(artifact);const descriptor=artifact.artifactDescriptor;return <div key={artifact.id} className="rounded-xl border bg-white p-3"><div className="flex items-start justify-between gap-2"><div className="min-w-0"><div className="truncate text-xs font-semibold text-slate-800">{artifact.name}</div><div className="mt-1 text-[10px] text-slate-400">{profile.label} · {profile.buildStrategy}</div></div><div className="flex shrink-0 items-center gap-1"><Badge>{descriptor?.subtype||artifact.artifactKind}</Badge><select aria-label={`修正 ${artifact.name} 的成果物类型`} className="h-6 rounded-lg border bg-white px-1.5 text-[9px] text-slate-500" value={artifact.artifactKind} onChange={(e)=>correctArtifactKind(artifact.id,e.target.value as ArtifactKind)}>{artifactKindOptions.map((item)=><option key={item.value} value={item.value}>{item.label}</option>)}</select></div></div>{descriptor&&<div className="mt-2 grid grid-cols-2 gap-1.5 text-[9px]"><div className="rounded-lg bg-emerald-50 px-2 py-1.5 text-emerald-700"><b>格式保留：</b>{preservationLabel[descriptor.preservationMode]??descriptor.preservationMode}</div><div className="rounded-lg bg-sky-50 px-2 py-1.5 text-sky-700"><b>保真：</b>{fidelityLabel[descriptor.fidelity]??descriptor.fidelity}</div></div>}<div className="mt-2 flex flex-wrap gap-1">{profile.evaluationFocus.slice(0,4).map((focus)=><span key={focus} className="rounded-md bg-slate-50 px-1.5 py-0.5 text-[9px] text-slate-500">{focus}</span>)}</div>{(descriptor?.requiredValidations?.length??0)>0&&<div className="mt-2 text-[9px] leading-4 text-slate-500"><b>专属验收：</b>{descriptor?.requiredValidations?.slice(0,3).join(" · ")}</div>}{(descriptor?.limitations?.length??0)>0&&<div className="mt-2 rounded-lg bg-amber-50 px-2 py-1.5 text-[9px] leading-4 text-amber-700">{descriptor?.limitations?.[0]}</div>}{artifact.warnings.length>0&&<div className="mt-2 text-[9px] leading-4 text-amber-600">{artifact.warnings[0]}</div>}</div>})}</div><p className="mt-2 text-[10px] leading-4 text-slate-400">请核对文件类型。格式决定当前能修改和验证哪些内容；业务目标在「理解材料与目标」中确认。无法验证的内容会明确标记，不会作为通过项。</p></div>}
      {recent.length > 0 && <div className="mb-4 max-h-56 space-y-2.5 overflow-auto rounded-2xl border bg-white/80 p-4">
        {recent.map((m) => <div key={m.id} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}><div className={`max-w-[86%] rounded-2xl px-3.5 py-2.5 text-xs leading-5 ${m.role === "user" ? "rounded-br-md bg-indigo-600 text-white" : "rounded-bl-md border bg-white text-slate-600 shadow-sm"}`}>{m.role === "assistant" && <Bot className="mr-1 inline size-3 text-indigo-500" />}<span className="whitespace-pre-wrap">{m.content}</span></div></div>)}
      </div>}
      {assistantReply && <div className="mb-3 rounded-xl border border-indigo-100 bg-indigo-50 px-3 py-2 text-xs text-indigo-700"><Bot className="mr-1 inline size-3" />{assistantReply}</div>}
      {error && <div className="mb-3 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">{error}</div>}
      {files.length > 0 && <div className="mb-3 flex flex-wrap gap-2">{files.map((item) => <div key={item.id} className="flex items-center gap-2 rounded-xl border bg-white px-2 py-1.5 text-[11px]"><span className="max-w-40 truncate">{item.file.name}</span><select className="h-6 rounded border px-1 text-[10px]" value={item.role} onChange={(e) => setFiles((current) => current.map((x) => x.id === item.id ? { ...x, role: e.target.value as ArtifactRole } : x))}><option value="target">进化对象</option><option value="reference">参考材料</option><option value="eval">测试样本</option></select><button onClick={() => setFiles((current) => current.filter((x) => x.id !== item.id))}><X className="size-3 text-slate-400" /></button></div>)}</div>}
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
