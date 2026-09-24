

import { useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  ArrowUp,
  Bot,
  CheckCircle2,
  FileCode2,
  FileImage,
  FileSpreadsheet,
  FileText,
  Loader2,
  Paperclip,
  Plus,
  Sparkles,
  X,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input, Textarea } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { IntakeAiResult } from "../ai/schemas";
import type { ArtifactRole, EvolveProject, ProjectAiProfile, SourceArtifact } from "../schemas";
import { defaultProjectAiProfile } from "../ai/project-profile";
import { ingestSources, runIntakeFromArtifacts } from "../runtime/api";
import { deleteArtifactBlob, getArtifactBlob, putArtifactBlob } from "../runtime/artifact-blob-store";
import {
  cancelServerParseJob,
  listServerParseJobs,
  parseJobMetadata,
  parseServerFile,
  ServerParseUnavailableError,
  startServerParseFile,
  waitForServerParseJob,
} from "../runtime/server-source-client";
import { saveLocalProject } from "../runtime/local-store";
import { getTemplate, recordTemplateUse } from "../runtime/template-store";
import { assessFileReadiness } from "../sources/extract";
import { normalizeAcceptanceRubric, rubricValidation } from "../runtime/acceptance-rubric";
import { compileSemanticEvolution } from "../runtime/semantic-evolution";

type PendingFile = {
  id: string;
  file: File;
  role: ArtifactRole;
  status: "queued" | "parsing" | "ready" | "error";
  artifactId?: string;
  serverJobId?: string;
  error?: string;
};
type ChatLine = { id: string; role: "user" | "assistant"; content: string; files?: string[] };

const departments = ["策略部", "客户部", "AI部", "技术部", "管理部", "其他"];
const objectTypes = [
  ["auto", "AI 自动识别"], ["agent", "Agent"], ["system", "AI 系统"], ["prompt", "Prompt"],
  ["workflow", "Workflow"], ["document", "文档"], ["presentation", "PPT/演示文稿"], ["spreadsheet", "表格"], ["codebase", "代码工程"], ["knowledge", "知识库 / Memory"], ["tool", "Tool"], ["template", "内容模板"],
] as const;
const roleLabels: Record<ArtifactRole, string> = { target: "进化对象", reference: "参考材料", eval: "测试样本" };
const PARSE_SESSION_KEY="evolve-studio:composer-parse-session:v1";

function composerParseSessionId(){
  if(typeof window==="undefined")return `composer-${Date.now()}`;
  const existing=window.sessionStorage.getItem(PARSE_SESSION_KEY);
  if(existing)return existing;
  const created=`composer-${crypto.randomUUID()}`;
  window.sessionStorage.setItem(PARSE_SESSION_KEY,created);
  return created;
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function FileGlyph({ file }: { file: File }) {
  if (file.type.startsWith("image/")) return <FileImage className="size-4" />;
  if (/csv|excel|spreadsheet|sheet/.test(file.type) || /\.(csv|xls|xlsx)$/i.test(file.name)) return <FileSpreadsheet className="size-4" />;
  if (/\.(ts|tsx|js|jsx|py|go|rs|java|sql|html|css|json|yaml|yml)$/i.test(file.name)) return <FileCode2 className="size-4" />;
  return <FileText className="size-4" />;
}

function ArtifactGlyph({ artifact }: { artifact: SourceArtifact }) {
  if (artifact.mimeType.startsWith("image/")) return <FileImage className="size-4" />;
  if (/csv|excel|spreadsheet|sheet/.test(artifact.mimeType) || /\.(csv|xls|xlsx)$/i.test(artifact.name)) return <FileSpreadsheet className="size-4" />;
  if (/\.(ts|tsx|js|jsx|py|go|rs|java|sql|html|css|json|yaml|yml)$/i.test(artifact.name)) return <FileCode2 className="size-4" />;
  return <FileText className="size-4" />;
}

const examples = [
  "把这份操作手册改得更容易上手，补充异常处理，保留审批权限和业务规则",
  "优化这份提示词，让回答更简洁、重要结论有依据，保留输出字段和格式",
  "检查这份表格的数据与公式，说明发现的问题，保留原始数据和工作表结构",
];

type SkillSeed = { title?: string; summary?: string; method?: string[]; trigger?: string[]; limit?: string; effect?: string };
/** 经验中心「应用到新进化项目」会落一个技能种子；首渲染消费并转成初始命令与首条对话，避免在 effect 里 setState。 */
function readSkillSeed(): { command: string; greeting: ChatLine } | null {
  try {
    const raw = window.localStorage.getItem("evolve-studio:skill-seed:v1");
    if (!raw) return null;
    const seed = JSON.parse(raw) as SkillSeed;
    const method = (seed.method ?? []).map((item, index) => `${index + 1}. ${item}`).join("\n");
    return {
      command: `请基于已验证技能「${seed.title ?? "未命名 Skill"}」进化我接下来上传的对象。\n\n已验证方法：\n${method || seed.summary || "请结合技能经验执行"}\n\n适用条件：${(seed.trigger ?? []).join("、") || "请根据新对象判断"}\n已知限制：${seed.limit || "无"}\n历史效果：${seed.effect || "已验证"}\n\n请先读取我上传的新对象，再判断这个 Skill 是否适用；不适用时不要强行套用。`,
      greeting: { id: `skill-${Date.now()}`, role: "assistant", content: `已加载组织经验「${seed.title ?? "Skill"}」。请上传新的进化对象，我会先验证适用性，再决定是否复用。` },
    };
  } catch {
    // Ignore malformed seed and keep normal intake.
    return null;
  }
}

export function EvolutionComposer({ compact = false }: { compact?: boolean }) {
  const navigate = useNavigate();
  const fileRef = useRef<HTMLInputElement>(null);
  const replaceRef = useRef<HTMLInputElement>(null);
  const parseSessionIdRef=useRef(composerParseSessionId());
  const autoCreatePendingRef = useRef(false);
  const parseJobsRef = useRef(new Map<string, Promise<SourceArtifact | undefined>>());
  const artifactsRef = useRef<SourceArtifact[]>([]);
  const intakeRef = useRef<IntakeAiResult | undefined>(undefined);
  const messagesRef = useRef<ChatLine[]>([]);
  const busyRef = useRef(false);
  const intakeEpochRef = useRef(0);
  const progressiveRevisionRef = useRef(0);
  const progressiveTimerRef = useRef<number | undefined>(undefined);
  const progressivePendingRef = useRef(false);
  const [files, setFiles] = useState<PendingFile[]>([]);
  const [seed] = useState(readSkillSeed);
  // 模板中心联动：带 ?template= 进入时按模板预填部门、对象类型与进化目标，创建项目后回写使用统计。
  const [searchParams] = useSearchParams();
  const [seedTemplate] = useState(() => {
    const id = searchParams.get("template");
    return id ? getTemplate(id) : undefined;
  });
  const [templateDismissed, setTemplateDismissed] = useState(false);
  const appliedTemplate = seedTemplate && !templateDismissed ? seedTemplate : undefined;
  const [command, setCommand] = useState(seed?.command ?? seedTemplate?.goal ?? "");
  const [pastedText, setPastedText] = useState("");
  const [showPaste, setShowPaste] = useState(false);
  const [department] = useState(seedTemplate && departments.includes(seedTemplate.department) ? seedTemplate.department : "策略部");
  const [objectType] = useState<(typeof objectTypes)[number][0]>(
    objectTypes.some((item) => item[0] === seedTemplate?.objectType) ? seedTemplate!.objectType as (typeof objectTypes)[number][0] : "auto");
  const [aiProfile] = useState<ProjectAiProfile>(defaultProjectAiProfile);
  const [busy, setBusy] = useState(false);
  const [contextRefreshing, setContextRefreshing] = useState(false);
  const [error, setError] = useState<string>();
  const [intake, setIntake] = useState<IntakeAiResult>();
  const [nameDraft, setNameDraft] = useState("");
  const [nameTouched, setNameTouched] = useState(false);
  /** AI 理解刷新时，用户没手动改过名就同步自动提炼的项目名（渲染期调整，避免 effect 级联）。 */
  const [syncedIntake, setSyncedIntake] = useState(intake);
  if (syncedIntake !== intake) {
    setSyncedIntake(intake);
    if (intake && !nameTouched) setNameDraft(intake.projectName);
  }
  const [artifacts, setArtifacts] = useState<SourceArtifact[]>([]);
  const [provider, setProvider] = useState<{ provider: string; live: boolean; model: string }>();
  const [messages, setMessages] = useState<ChatLine[]>(seed ? [seed.greeting] : []);
  const [dragging, setDragging] = useState(false);
  const [replacingId, setReplacingId] = useState<string>();

  useEffect(() => {
    // 种子已在首渲染消费，这里只清理存储，避免下次进入重复套用。
    if (seed) window.localStorage.removeItem("evolve-studio:skill-seed:v1");
  }, [seed]);

  useEffect(() => { artifactsRef.current = artifacts; }, [artifacts]);
  useEffect(() => { intakeRef.current = intake; }, [intake]);
  useEffect(() => { messagesRef.current = messages; }, [messages]);
  useEffect(() => { busyRef.current = busy; }, [busy]);

  const replaceArtifactState = (next: SourceArtifact[]) => {
    artifactsRef.current = next;
    setArtifacts(next);
    return next;
  };

  const mergeArtifactState = (artifact: SourceArtifact) => {
    const byId = new Map(artifactsRef.current.map((entry) => [entry.id, entry]));
    byId.set(artifact.id, artifact);
    return replaceArtifactState([...byId.values()]);
  };

  const setIntakeState = (next: IntakeAiResult) => {
    intakeRef.current = next;
    setIntake(next);
  };

  const scheduleProgressiveIntake = (preferredArtifacts?: SourceArtifact[]) => {
    const previous = intakeRef.current;
    if (!previous) return;
    if (busyRef.current) {
      progressivePendingRef.current = true;
      return;
    }
    if (progressiveTimerRef.current) window.clearTimeout(progressiveTimerRef.current);
    progressivePendingRef.current = false;
    setContextRefreshing(true);
    const revision = ++progressiveRevisionRef.current;
    const epoch = intakeEpochRef.current;
    progressiveTimerRef.current = window.setTimeout(() => {
      const sourceArtifacts = preferredArtifacts && preferredArtifacts.length >= artifactsRef.current.length
        ? preferredArtifacts
        : artifactsRef.current;
      const latestUserCommand = [...messagesRef.current].reverse().find((message) => message.role === "user")?.content;
      void runIntakeFromArtifacts({
        command: latestUserCommand || previous.evolutionIntent || "继续理解新增材料",
        artifacts: sourceArtifacts,
        department,
        requestedObjectType: objectType,
        aiProfile,
        conversation: {
          messages: messagesRef.current.map((message) => ({ role: message.role, content: message.content })),
          previousIntake: intakeRef.current,
          progressive: true,
        },
      }).then((result) => {
        if (revision !== progressiveRevisionRef.current || epoch !== intakeEpochRef.current) return;
        const enrichedById = new Map(result.artifacts.map((artifact) => [artifact.id, artifact]));
        const nextArtifacts = artifactsRef.current.map((artifact) => enrichedById.get(artifact.id) ?? artifact);
        replaceArtifactState(nextArtifacts);
        setIntakeState(result.intake);
        setProvider(result.provider);
      }).catch((cause) => {
        if (revision !== progressiveRevisionRef.current || epoch !== intakeEpochRef.current) return;
        autoCreatePendingRef.current = false;
        setError(`新增材料已读取，但后台更新理解暂时失败：${cause instanceof Error ? cause.message : String(cause)}`);
      }).finally(() => {
        if (revision === progressiveRevisionRef.current && epoch === intakeEpochRef.current) setContextRefreshing(false);
      });
    }, 650);
  };

  const hasSource = files.length > 0 || pastedText.trim().length > 0 || artifacts.length > 0;
  const canSend = command.trim().length > 0 || pastedText.trim().length > 0 || files.length > 0 || (!intake && artifacts.length > 0);

  const startBackgroundParse = (item: PendingFile) => {
    setFiles((current) => current.map((entry) => entry.id === item.id ? { ...entry, status: "parsing", error: undefined } : entry));
    const job = (async () => {
      try {
        let parsed: SourceArtifact | undefined;
        let serverJobId=item.serverJobId;
        const artifactId=item.artifactId??`artifact-${crypto.randomUUID()}`;
        if(serverJobId){
          parsed=await waitForServerParseJob(serverJobId);
        }else{
          try{
            const started=await startServerParseFile(item.file,item.role,artifactId,parseSessionIdRef.current);
            serverJobId=started.jobId;
            setFiles((current)=>current.map((entry)=>entry.id===item.id
              ?{...entry,status:"parsing",serverJobId,artifactId}
              :entry));
            parsed=await waitForServerParseJob(serverJobId);
          }catch(cause){
            if(!(cause instanceof ServerParseUnavailableError))throw cause;
            [parsed]=await ingestSources({files:[item.file],role:item.role});
          }
        }
        if (!parsed) throw new Error("未能读取文件");
        const nextArtifacts = mergeArtifactState(parsed);
        setFiles((current) => current.map((entry) => entry.id === item.id
          ? { ...entry, status: "ready", artifactId: parsed!.id, serverJobId, error: undefined }
          : entry));
        if (intakeRef.current) scheduleProgressiveIntake(nextArtifacts);
        return parsed;
      } catch (cause) {
        const message = cause instanceof Error ? cause.message : "后台解析失败";
        setFiles((entries) => entries.map((entry) => entry.id === item.id ? { ...entry, status: "error", error: message } : entry));
        return undefined;
      }
    })();
    parseJobsRef.current.set(item.id, job);
    void job.finally(() => {
      if (parseJobsRef.current.get(item.id) === job) parseJobsRef.current.delete(item.id);
    });
    return job;
  };

  const queueFileForParsing = (item: PendingFile) => {
    void startBackgroundParse(item);
  };

  const addFiles = (incoming: FileList | File[]) => {
    const list = Array.from(incoming).slice(0, Math.max(0, 12 - files.length));
    const existing = new Set([
      ...files.map((item) => `${item.file.name}:${item.file.size}`),
      ...artifactsRef.current.map((artifact) => `${artifact.name}:${artifact.size}`),
    ]);
    let hasTarget = files.some((item) => item.role === "target") || artifactsRef.current.some((artifact) => artifact.role === "target");
    const additions: PendingFile[] = [];
    for (const file of list) {
      if (existing.has(`${file.name}:${file.size}`)) continue;
      const role: ArtifactRole = hasTarget ? "reference" : "target";
      hasTarget = true;
      const item: PendingFile = { id: `pending-${crypto.randomUUID()}`, file, role, status: "queued" };
      additions.push(item);
      existing.add(`${file.name}:${file.size}`);
    }
    if (!additions.length) return;
    setFiles((current) => [...current, ...additions].slice(0, 12));
    additions.forEach(queueFileForParsing);
  };

  const retryPendingFile = (item: PendingFile) => {
    if (item.status !== "error") return;
    void startBackgroundParse({ ...item, status: "queued", serverJobId: undefined, error: undefined });
  };

  const removePendingFile = (item: PendingFile) => {
    parseJobsRef.current.delete(item.id);
    setFiles((current) => current.filter((entry) => entry.id !== item.id));
    if (item.artifactId) {
      const next = artifactsRef.current.filter((artifact) => artifact.id !== item.artifactId);
      replaceArtifactState(next);
      if (intakeRef.current) scheduleProgressiveIntake(next);
    }
    if(item.serverJobId)void cancelServerParseJob(item.serverJobId,true).catch(()=>undefined);
    else if(item.artifactId)void deleteArtifactBlob(item.artifactId).catch(()=>undefined);
  };

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const persisted = await listServerParseJobs(parseSessionIdRef.current);
      const recoveredFiles: PendingFile[] = [];
      const recoveredArtifacts: SourceArtifact[] = [];
      const resume: PendingFile[] = [];
      for (const record of persisted) {
        const metadata=parseJobMetadata(record.job);
        const blob=metadata.artifactId?await getArtifactBlob(metadata.artifactId).catch(()=>undefined):undefined;
        if(!blob&&record.job.status!=="completed")continue;
        const file = new File([blob??new Blob()], metadata.name, { type: metadata.mimeType, lastModified: metadata.lastModified });
        const ready = record.job.status === "completed" && Boolean(record.artifact);
        const status: PendingFile["status"] = ready ? "ready"
          : (record.resultIssue||record.job.status === "failed"||record.job.status === "cancelled") ? "error" : "parsing";
        const item: PendingFile = {
          id: `pending-${record.job.id}`,
          file,
          role: metadata.role,
          status,
          artifactId: metadata.artifactId,
          serverJobId:record.job.id,
          error: record.resultIssue??record.job.error??(record.job.status==="cancelled"?"Parse 已取消":undefined),
        };
        recoveredFiles.push(item);
        if (record.artifact) recoveredArtifacts.push(record.artifact);
        if (!ready && !record.resultIssue && record.job.status !== "failed" && record.job.status !== "cancelled") resume.push(item);
      }
      if (cancelled) return;
      if (recoveredFiles.length) setFiles(recoveredFiles);
      if (recoveredArtifacts.length) replaceArtifactState(recoveredArtifacts);
      resume.forEach(startBackgroundParse);
    })().catch((cause) => {
      if (!cancelled && !(cause instanceof ServerParseUnavailableError)) {
        setError(`恢复 Server Parse 任务失败：${cause instanceof Error ? cause.message : String(cause)}`);
      }
    });
    return () => {
      cancelled = true;
      if (progressiveTimerRef.current) window.clearTimeout(progressiveTimerRef.current);
    };
    // Recovery intentionally runs once; durable server jobs keep parsing across refreshes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const removeArtifact = (id: string) => {
    const gone = artifactsRef.current.find((item) => item.id === id);
    const next = artifactsRef.current.filter((item) => item.id !== id);
    replaceArtifactState(next);
    const pending = files.find((item) => item.artifactId === id);
    if (pending) {
      setFiles((current) => current.filter((item) => item.id !== pending.id));
      if(pending.serverJobId)void cancelServerParseJob(pending.serverJobId,true).catch(()=>undefined);
      else void deleteArtifactBlob(id).catch(()=>undefined);
    } else {
      void deleteArtifactBlob(id).catch(() => undefined);
    }
    if (intakeRef.current) scheduleProgressiveIntake(next);
    if (gone) setMessages((current) => [...current, { id: `a-${Date.now()}`, role: "assistant", content: `已移除解析异常的附件「${gone.name}」。${gone.role === "target" ? "它是进化对象，请重新上传正确格式的文件后再继续。" : "如还需要它，可重新上传。"}` }]);
  };

  const replaceArtifact = async (artifactId: string, file: File) => {
    const old = artifactsRef.current.find((item) => item.id === artifactId);
    if (!old) return;
    const epoch = ++intakeEpochRef.current;
    ++progressiveRevisionRef.current;
    if (progressiveTimerRef.current) window.clearTimeout(progressiveTimerRef.current);
    setContextRefreshing(false);
    busyRef.current = true;
    setBusy(true);
    setError(undefined);
    try {
      let replacement:SourceArtifact;
      try{
        replacement=await parseServerFile({
          file,
          role:old.role,
          artifactId:old.id,
          sessionId:parseSessionIdRef.current,
        });
      }catch(cause){
        if(!(cause instanceof ServerParseUnavailableError))throw cause;
        const [fresh]=await ingestSources({files:[file],role:old.role});
        if(!fresh)throw new Error("未能读取新文件",{cause});
        await putArtifactBlob(old.id,file);
        if(fresh.id!==old.id)await deleteArtifactBlob(fresh.id).catch(()=>undefined);
        replacement={...fresh,id:old.id,role:old.role,textExcerpt:fresh.textExcerpt||`[附件] ${file.name}`};
      }
      const next = artifactsRef.current.map((item) => (item.id === artifactId ? replacement : item));
      replaceArtifactState(next);
      let summary = `附件已替换为「${file.name}」，${replacement.parseStatus === "binary" ? "但新文件仍未解析成功，可再检查格式或改为文字粘贴。" : "内容读取成功。"}`;
      if (intakeRef.current) {
        const result = await runIntakeFromArtifacts({
          command: `（系统说明）用户已重新上传替换文件「${file.name}」，请基于新内容更新对当前状态的理解；未在文件中出现的内容不要编造。`,
          artifacts: next,
          requestedObjectType: objectType,
          department,
          aiProfile,
          conversation: {
            messages: messagesRef.current.map((message) => ({ role: message.role, content: message.content })),
            previousIntake: intakeRef.current,
          },
        });
        if (epoch !== intakeEpochRef.current) return;
        replaceArtifactState(result.artifacts);
        setIntakeState(result.intake);
        setProvider(result.provider);
        summary = `附件已替换为「${file.name}」，我重新读取了内容：${replacement.parseStatus === "binary" ? "新文件仍未解析成功，建议另存为标准格式后重试。" : result.intake.currentStateSummary}`;
      }
      setMessages((current) => {
        const updated = [...current, { id: `a-${Date.now()}`, role: "assistant" as const, content: summary }];
        messagesRef.current = updated;
        return updated;
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "替换附件失败");
    } finally {
      busyRef.current = false;
      if (intakeRef.current && progressivePendingRef.current) scheduleProgressiveIntake();
      setReplacingId(undefined);
      setBusy(false);
    }
  };

  const send = async () => {
    if (!canSend) return;
    const epoch = ++intakeEpochRef.current;
    ++progressiveRevisionRef.current;
    progressivePendingRef.current = false;
    if (progressiveTimerRef.current) window.clearTimeout(progressiveTimerRef.current);
    setContextRefreshing(false);
    busyRef.current = true;
    setBusy(true);
    setError(undefined);
    const userText = command.trim() || "请分析我上传的材料，自动理解当前内容并建立进化目标。";
    const nextMessage: ChatLine = { id: `u-${Date.now()}`, role: "user", content: userText, files: files.map((x) => x.file.name) };
    setMessages((current) => {
      const next = [...current, nextMessage];
      messagesRef.current = next;
      return next;
    });
    let intakeArtifactIds = new Set<string>();
    try {
      let mergedArtifacts = [...artifactsRef.current];

      // Do not block the conversation on every attachment. If nothing is ready yet, wait only
      // for the first parser result; remaining files continue in the persistent background queue.
      if (!mergedArtifacts.length && parseJobsRef.current.size) {
        const first = await Promise.race([...parseJobsRef.current.values()].map((job) => job.catch(() => undefined)));
        if (first) mergedArtifacts = [first];
      }

      if (pastedText.trim()) {
        const [pastedArtifact] = await ingestSources({
          text: pastedText,
          role: mergedArtifacts.some((artifact) => artifact.role === "target") ? "reference" : "target",
        });
        if (pastedArtifact) mergedArtifacts = [...mergedArtifacts, pastedArtifact];
      }
      if (mergedArtifacts.length) replaceArtifactState(mergedArtifacts);
      intakeArtifactIds = new Set(mergedArtifacts.map((artifact) => artifact.id));

      const hadIntake = Boolean(intakeRef.current);
      const result = await runIntakeFromArtifacts({
        command: userText,
        artifacts: mergedArtifacts,
        department,
        requestedObjectType: objectType,
        aiProfile,
        pastedText,
        conversation: {
          messages: messagesRef.current.map((message) => ({ role: message.role, content: message.content })),
          previousIntake: intakeRef.current,
        },
      });
      if (epoch !== intakeEpochRef.current) return;
      if (!hadIntake) autoCreatePendingRef.current = true;

      // A parser may have finished while AI was thinking. Enrich only the artifacts present in
      // this Intake response and keep any newer arrivals intact for the progressive refresh.
      const enrichedById = new Map(result.artifacts.map((artifact) => [artifact.id, artifact]));
      const latest = artifactsRef.current;
      const nextArtifacts = latest.map((artifact) => enrichedById.get(artifact.id) ?? artifact);
      replaceArtifactState(nextArtifacts);
      setIntakeState(result.intake);
      setProvider(result.provider);
      setMessages((current) => {
        const next = [...current, { id: `a-${Date.now()}`, role: "assistant" as const, content: result.intake.currentStateSummary }];
        messagesRef.current = next;
        return next;
      });
      setCommand("");
      setPastedText("");
      setFiles((current) => current.filter((item) => item.status === "queued" || item.status === "parsing" || item.status === "error"));
    } catch (e) {
      autoCreatePendingRef.current = false;
      setError(e instanceof Error ? e.message : "AI 无法分析当前输入");
    } finally {
      busyRef.current = false;
      const hasNewerArtifacts = artifactsRef.current.some((artifact) => !intakeArtifactIds.has(artifact.id));
      if (intakeRef.current && (progressivePendingRef.current || hasNewerArtifacts)) scheduleProgressiveIntake();
      setBusy(false);
    }
  };

  const createProject = () => {
    if (!intake) return;
    const evolutionCommand = messages.filter((m) => m.role === "user").map((m) => m.content).join("\n\n");
    const semanticCompiled = compileSemanticEvolution({ artifacts, command: evolutionCommand || intake.evolutionIntent, aiSemanticObject: intake.semanticObject, aiWorkflowStages: intake.semanticWorkflowStages });
    const semanticIds = new Set(semanticCompiled.semanticEvolution.acceptanceRubric.map((item) => item.id));
    const combinedRubric = [...semanticCompiled.semanticEvolution.acceptanceRubric, ...intake.acceptanceRubric.filter((item) => !semanticIds.has(item.id))];
    const intakeRubric = normalizeAcceptanceRubric(combinedRubric, { protectedItems: intake.protectedItems, sourceArtifacts: artifacts, semanticEvolution: semanticCompiled.semanticEvolution });
    const intakeRubricCheck = rubricValidation(intakeRubric);
    const id = `project-${Date.now()}`;
    const project: EvolveProject = {
      id,
      name: nameDraft.trim() || intake.projectName,
      objectType: intake.detectedObjectType,
      department,
      aiProfile,
      templateId: appliedTemplate?.id,
      version: "V1",
      stage: "target",
      goal: intake.goal,
      evolutionCommand,
      commandHistory: messages.map((m) => ({ id: m.id, role: m.role, content: m.content, artifactIds: artifacts.map((a) => a.id), createdAt: new Date().toISOString() })),
      sourceArtifacts: artifacts,
      artifactGraph: semanticCompiled.artifactGraph,
      semanticEvolution: { ...semanticCompiled.semanticEvolution, acceptanceRubric: intakeRubric, warnings: [...semanticCompiled.semanticEvolution.warnings, ...intake.semanticWarnings] },
      sourceUnderstanding: {
        currentStateSummary: intake.currentStateSummary,
        evolutionIntent: intake.evolutionIntent,
        detectedObjectType: intake.detectedObjectType,
        artifactSummaries: intake.artifactSummaries,
        acceptanceCriteria: intake.acceptanceCriteria,
        followUpQuestions: intake.followUpQuestions,
      },
      appliedPatches: [],
      searchAppliedPatches: [],
      inputClarifications: [],
      problemStatement: intake.currentStateSummary,
      desiredOutcome: intake.evolutionIntent,
      protectedItems: intake.protectedItems,
      editableItems: intake.editableItems,
      metrics: intake.metrics.map((m) => ({ key: m.key, label: m.label, value: 0, unit: m.unit, target: m.target, direction: m.direction, description: m.why })),
      acceptanceRubric: intakeRubric,
      acceptanceRubricState: { status: intakeRubricCheck.ready ? "ready" : "invalid", summary: intakeRubricCheck.ready ? `已按“${semanticCompiled.semanticEvolution.semanticObject.label}”业务对象编译项目专属验收标准；自主进化会在无人工例外时直接继续。` : "项目专属验收标准仍需修正后才能开始自主进化。", version: 1, compiledAt: new Date().toISOString(), weightTotal: intakeRubricCheck.weightTotal, uncoveredCriterionIds: [], warnings: intakeRubricCheck.warnings },
      artifactAcceptance: { id: `artifact-acceptance-${id}`, status: "idle", overallScore: 0, coverageScore: 0, integrityScore: 0, pairwiseScore: 0, hardGatePass: false, results: [], attempts: 0, maxRepairAttempts: 3, summary: "等待生成项目专属验收 Rubric" },
      evalSuite: [], hiddenEvalSuite: [],
      gates: [
        { id: "target-ready", status: intakeRubricCheck.ready ? "ready" : "blocked", note: intakeRubricCheck.ready ? "Goal + Project-specific Acceptance Rubric 已生成；无人工例外时由自主进化自动批准" : "Acceptance Rubric 未 Ready，禁止进入自主进化" },
        { id: "experiment-ready", status: "pending" },
        { id: "artifact-ready", status: "pending", note: "最终 Candidate Artifact 必须通过逐条验收与完整性检查" },
        { id: "release-ready", status: "pending" },
      ],
      problems: [], candidates: [], selectedCandidateIds: [],
      experimentPolicy: { mode: "adaptive", finalistCount: 2, screeningCaseCount: 2, batchSize: 5, buildConcurrency: 3, batchArtifactRuntime: true },
      baselineRun: { id: `baseline-${id}`, status: "idle", suiteName: "Core Validation Suite", totalCases: 0, runs: [] },
      experimentRun: { id: `experiment-${id}`, status: "idle", candidateResults: [] },
      validationRun: { id: `validation-${id}`, status: "idle", checks: [], runs: [], baselineRuns: [] },
      supplementalValidationEvidence: [],      release: { status: "idle", trafficPercent: 0, kpis: [], evidenceMode: "none", history: [] },
      lessons: [], nextQueue: [],
      campaign: {
        status: "idle", executionMode: "auto-rounds", currentRound: 0, candidateCount: 5, parentStrategy: "champion-elites", exploreRatio: 0.35, eliteCount: 3, autoApproveOfflineExperiment: true,
        stopCriteria: { maxRounds: 5, patienceRounds: 2, minImprovement: 0.5, stopOnSafetyFailure: true, stopWhenMetricTargetsMet: true, stopWhenAcceptanceMet: true },
        schedule: { mode: "manual", enabled: false, intervalMinutes: 60, daysOfWeek: [], hour: 9, minute: 0, timezone: "local" },
        noImprovementRounds: 0, estimatedCost: 0,
      },
      roundHistory: [], evolutionArchive: [], outputArtifacts: [],
      versions: [], adviceLedger: [],
      targetConnection: {
        adapter: artifacts.length ? "artifact" : "mock",
        connectionId: `artifact-runtime-${id}`,
        status: "connected",
        label: artifacts.length ? "AI Artifact Runtime" : "Demo Target Adapter",
      },
      updatedAt: new Date().toISOString(),
    };
    saveLocalProject(project);
    if(typeof window!=="undefined")window.sessionStorage.removeItem(PARSE_SESSION_KEY);
    if (appliedTemplate) recordTemplateUse(appliedTemplate.id);
    navigate(`/projects/${id}?autostart=1`);
  };

  useEffect(() => {
    const parsingActive = files.some((item) => item.status === "queued" || item.status === "parsing");
    const parsingError = files.some((item) => item.status === "error");
    if (!autoCreatePendingRef.current || busy || contextRefreshing || parsingActive || parsingError || !intake) return;
    autoCreatePendingRef.current = false;
    createProject();
    // Wait for all persistent parse jobs and the final progressive Intake revision before autostart.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [busy, contextRefreshing, files, intake, artifacts.length, messages.length]);

  return <div className={cn("mx-auto w-full", compact ? "max-w-none" : "max-w-6xl")}>
    {!compact && <div className="mb-6 text-center">
      <div className="mx-auto grid size-11 place-items-center rounded-2xl bg-gradient-to-br from-indigo-600 to-violet-600 text-white shadow-lg shadow-indigo-100"><Sparkles className="size-5" /></div>
      <h1 className="mt-4 text-3xl font-bold tracking-tight text-slate-950">你想让什么变得更好？</h1>
      <p className="mx-auto mt-2 max-w-2xl text-sm leading-6 text-slate-500">上传 Agent、Prompt、Workflow、报告模板、代码、文档或测试样本，再直接告诉 AI 你希望怎么进化。</p>
    </div>}

    <Card className={cn("overflow-hidden border-slate-200/80", compact && "soft-shadow")}>
      <CardContent className={cn("p-0", compact ? "" : "min-h-[560px]")}>
        <div className="bg-indigo-50/60 px-5 py-4">
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-2 text-sm font-semibold text-slate-800"><Bot className="size-4 text-indigo-600" />开始一次进化</div>
            <Badge className="border-indigo-100 bg-indigo-50 text-indigo-700">AI 先读输入，再开始进化</Badge>
            {provider && <Badge className={provider.live ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-amber-200 bg-amber-50 text-amber-700"}>{provider.live ? `${provider.model} Live` : "Demo AI"}</Badge>}
          </div>
          <p className="mt-1 text-sm text-slate-600">上传当前成果，用一句话说明希望改善什么。先核对系统理解，再自动改进和验证。</p>
          {appliedTemplate && (
            <div className="mt-2 flex items-center justify-between gap-2 rounded-xl border border-indigo-100 bg-indigo-50/60 px-3 py-2 text-xs text-indigo-700">
              <span>正在使用模板「{appliedTemplate.name}」：部门、对象类型与进化目标已预填，创建前都可修改。</span>
              <button type="button" className="shrink-0 text-indigo-400 transition hover:text-indigo-700" onClick={() => setTemplateDismissed(true)}>不用模板</button>
            </div>
          )}
        </div>

        {/* 聊天区随视口高度自适应：减去页头、卡片头、输入栏与底部薄栏的大致高度 */}
        <div className={cn("space-y-4 overflow-y-auto px-5 py-4", compact ? (messages.length || intake ? "max-h-[min(52vh,620px)] min-h-[180px]" : "") : "max-h-[620px]")}>
          {messages.length === 0 && !intake && <div>
            <div className="text-base font-semibold text-slate-800">把当前版本直接交给 Studio</div>
            <p className="mt-1 text-xs leading-5 text-slate-500">上传一个 Prompt，或一起上传当前系统、参考样例与测试数据。也可以从下面的要求开始。</p>
            <div className="mt-3 grid gap-2 sm:grid-cols-3">{examples.map((example) => <button key={example} onClick={() => setCommand(example)} className="focus-ring rounded-xl bg-slate-100/80 p-3 text-left text-xs leading-5 text-slate-600 transition hover:bg-indigo-50 hover:text-indigo-700">{example}</button>)}</div>
          </div>}

          {messages.map((message) => <div key={message.id} className={cn("flex gap-2.5", message.role === "user" ? "justify-end" : "justify-start")}>
            {message.role === "assistant" && <div className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-full bg-gradient-to-br from-indigo-600 to-violet-600 text-white"><Bot className="size-3.5" /></div>}
            <div className={cn("max-w-[78%] rounded-2xl px-4 py-3 text-sm leading-6", message.role === "user" ? "rounded-br-md bg-indigo-600 text-white" : "rounded-bl-md border bg-white text-slate-700 shadow-sm")}>
              <div className="whitespace-pre-wrap">{message.content}</div>
              {message.files && message.files.length > 0 && <div className={cn("mt-2 flex flex-wrap gap-1", message.role === "user" ? "" : "opacity-80")}>{message.files.map((name) => <span key={name} className={cn("rounded-lg px-2 py-0.5 text-[10px]", message.role === "user" ? "bg-white/15" : "border bg-slate-50 text-slate-500")}>{name}</span>)}</div>}
            </div>
          </div>)}

          {busy && <div className="flex gap-2.5">
            <div className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-full bg-gradient-to-br from-indigo-600 to-violet-600 text-white"><Bot className="size-3.5" /></div>
            <div className="flex items-center gap-2 rounded-2xl rounded-bl-md border bg-white px-4 py-3 text-sm text-slate-500 shadow-sm"><Loader2 className="size-4 animate-spin text-indigo-600" />AI 正在读取输入、理解当前版本并建立 Evolve Contract…</div>
          </div>}

          {intake && !busy && <div className="rounded-2xl border border-indigo-100 bg-gradient-to-br from-indigo-50/60 via-white to-sky-50/40 p-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between"><div><div className="flex items-center gap-2 text-sm font-semibold text-slate-900"><CheckCircle2 className="size-4 text-emerald-600" />AI 已理解本次进化输入{contextRefreshing && <span className="ml-1 inline-flex items-center gap-1 text-[10px] font-medium text-indigo-500"><Loader2 className="size-3 animate-spin" />正在吸收新增材料</span>}</div><p className="mt-1 text-xs text-slate-500">识别为 {intake.detectedObjectType} · {artifacts.length} 个输入对象</p></div><Button onClick={createProject}><Sparkles className="size-4" />创建并开始进化</Button></div>
            <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center">
              <label htmlFor="project-name" className="shrink-0 text-xs font-semibold text-slate-600">项目名称</label>
              <Input id="project-name" value={nameDraft} onChange={(e) => { setNameTouched(true); setNameDraft(e.target.value); }} placeholder={intake.projectName} className="sm:max-w-sm" />
              <span className="text-[10px] text-slate-400">已从内容关键信息自动提炼，创建前可修改</span>
            </div>
            <div className="mt-4 grid gap-3 lg:grid-cols-2">
              <div className="rounded-xl border bg-white p-3"><div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">当前状态</div><p className="mt-1 text-sm leading-6 text-slate-700">{intake.currentStateSummary}</p></div>
              <div className="rounded-xl border bg-white p-3"><div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">本轮目标</div><p className="mt-1 text-sm leading-6 text-slate-700">{intake.goal}</p></div>
            </div>
            <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">{intake.metrics.map((m) => <div key={m.key} className="rounded-xl border bg-white p-3"><div className="text-[10px] text-slate-400">{m.label}</div><div className="mt-1 text-sm font-bold text-slate-900">{m.direction === "lower" ? "≤" : "≥"} {m.unit === "%" ? `${m.target}%` : `${m.target} ${m.unit}`}</div><div className="mt-1 text-[10px] text-slate-400">{m.why}</div></div>)}</div>
            <div className="mt-4 rounded-2xl border border-sky-100 bg-white p-4">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between"><div><div className="text-xs font-bold text-sky-700">业务对象识别 · 不是按文件扩展名套流程</div><p className="mt-1 text-[11px] leading-5 text-slate-500">系统先展开容器和成果组成，再结合内容、文件关系、部门和你的命令判断“这套东西在业务上是什么”，再编译本项目流程。</p></div><Badge className={intake.semanticObject.confidence < 0.68 ? "border-amber-200 bg-amber-50 text-amber-700" : "border-emerald-200 bg-emerald-50 text-emerald-700"}>{intake.semanticObject.label} · {Math.round(intake.semanticObject.confidence*100)}%</Badge></div>
              <p className="mt-3 text-sm leading-6 text-slate-700">{intake.semanticObject.description}</p>
              <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{intake.semanticWorkflowStages.map((stage,index)=><div key={stage.id} className="rounded-xl border bg-slate-50 p-3"><div className="text-[10px] font-bold text-slate-400">{index+1}</div><div className="mt-1 text-xs font-semibold text-slate-800">{stage.label}</div><div className="mt-1 text-[10px] leading-4 text-slate-500">{stage.flow}</div></div>)}</div>
              {intake.semanticObject.crossArtifactRequirements.length>0&&<div className="mt-3 rounded-xl border border-indigo-100 bg-indigo-50/50 p-3 text-[10px] leading-4 text-indigo-800"><b>跨成果联合要求：</b>{intake.semanticObject.crossArtifactRequirements.join(" · ")}</div>}
              {intake.semanticWarnings.length>0&&<div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-[10px] leading-4 text-amber-800">{intake.semanticWarnings.join(" · ")}</div>}
            </div>
            <div className="mt-4 rounded-2xl border border-indigo-100 bg-white p-4">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between"><div><div className="text-xs font-bold text-indigo-700">Project-specific Acceptance Rubric · 将作为真正评分函数</div><p className="mt-1 text-[11px] leading-5 text-slate-500">这些标准由你刚才的原始要求直接编译；创建项目后必须先确认 Rubric，Eval Suite 会逐条绑定 criterionIds，Winner 和最终 Artifact 都按同一 Rubric 验收。</p></div><Badge className="border-indigo-200 bg-indigo-50 text-indigo-700">{intake.acceptanceRubric.length} criteria</Badge></div>
              <div className="mt-3 grid gap-2 lg:grid-cols-2">{intake.acceptanceRubric.slice(0, 8).map((criterion) => <div key={criterion.id} className="rounded-xl border bg-slate-50 p-3"><div className="flex flex-wrap items-center gap-1.5"><span className="text-xs font-semibold text-slate-800">{criterion.title}</span>{criterion.hardGate && <Badge className="border-rose-200 bg-rose-50 text-rose-700">Hard Gate</Badge>}<Badge>{criterion.weight}%</Badge></div><p className="mt-1 text-[11px] leading-5 text-slate-500">{criterion.requirement}</p><div className="mt-2 text-[10px] text-slate-400">最低 {criterion.minScore} · {criterion.judgeType} · 证据：{criterion.evidenceExpected.slice(0,2).join(" / ")}</div></div>)}</div>
              {intake.acceptanceRubric.length > 8 && <div className="mt-2 text-[10px] text-slate-400">其余 {intake.acceptanceRubric.length - 8} 条将在项目 Target 页面完整展示并可编辑。</div>}
            </div>
            {artifacts.length > 0 && <div className="mt-4 space-y-2"><div className="text-xs font-semibold text-slate-600">AI 读到的输入</div>{artifacts.map((artifact) => { const flagged = artifact.parseStatus === "binary" || artifact.parseStatus === "error" || artifact.warnings.some((warning) => /(解析失败|未能|无法|未解析|损坏|未找到|声明为|启发式|老版)/.test(warning)); return <div key={artifact.id} className={cn("flex items-start gap-3 rounded-xl border p-3", flagged ? "border-rose-200 bg-rose-50/60" : "bg-white")}><div className={cn("grid size-8 shrink-0 place-items-center rounded-lg", flagged ? "bg-rose-100 text-rose-600" : "bg-slate-50 text-slate-500")}><ArtifactGlyph artifact={artifact} /></div><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><div className={cn("truncate text-xs font-semibold", flagged ? "text-rose-800" : "text-slate-700")}>{artifact.name}</div><Badge className={flagged ? "border-rose-200 bg-rose-100 text-rose-700" : undefined}>{flagged ? "解析异常" : roleLabels[artifact.role]}</Badge>{flagged && <Badge className="border-slate-200 bg-white text-slate-500">{roleLabels[artifact.role]}</Badge>}</div><p className="mt-1 line-clamp-2 text-[11px] leading-5 text-slate-400">{artifact.summary || artifact.textExcerpt || (flagged ? "内容未能解析，AI 无法读取此文件正文。" : "已接收附件")}</p>{flagged && artifact.warnings.length > 0 && <div className="mt-1 space-y-0.5">{artifact.warnings.slice(0, 2).map((warning, index) => <p key={index} className="line-clamp-2 text-[10px] leading-4 text-rose-600">{warning}</p>)}</div>}{flagged && <div className="mt-1.5 flex gap-2"><button disabled={busy} onClick={() => { setReplacingId(artifact.id); replaceRef.current?.click(); }} className="rounded-lg border border-rose-300 bg-white px-2 py-1 text-[10px] font-semibold text-rose-600 transition hover:bg-rose-50 disabled:opacity-50">重新上传替换</button><button disabled={busy} onClick={() => removeArtifact(artifact.id)} className="rounded-lg px-2 py-1 text-[10px] text-slate-400 transition hover:text-rose-500 disabled:opacity-50">移除该附件</button></div>}</div></div>; })}</div>}
            {intake.followUpQuestions.length > 0 && <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-3"><div className="text-xs font-semibold text-amber-800">AI 还建议确认</div><ul className="mt-1 list-disc space-y-1 pl-4 text-xs text-amber-700">{intake.followUpQuestions.map((q) => <li key={q}>{q}</li>)}</ul></div>}
          </div>}
        </div>

        <div className={cn("bg-white px-5 pb-4 pt-1", dragging && "bg-indigo-50/70")} onDragOver={(e) => { e.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={(e) => { e.preventDefault(); setDragging(false); addFiles(e.dataTransfer.files); }}>
          {error && <div className="mb-3 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">{error}</div>}
          {files.length > 0 && <div className="mb-3 flex flex-wrap gap-2">{files.map((item) => { const readiness = assessFileReadiness(item.file.name, item.file.type); const failed = item.status === "error"; const active = item.status === "queued" || item.status === "parsing"; return <div key={item.id} className={cn("group flex max-w-full items-center gap-2 rounded-xl border px-2.5 py-2", failed || readiness.level === "blocked" ? "border-rose-200 bg-rose-50" : readiness.level === "caution" ? "border-amber-200 bg-amber-50" : item.status === "ready" ? "border-emerald-200 bg-emerald-50/50" : "bg-slate-50")}><div className={cn(failed || readiness.level === "blocked" ? "text-rose-500" : readiness.level === "caution" ? "text-amber-500" : item.status === "ready" ? "text-emerald-600" : "text-slate-500")}>{active ? <Loader2 className="size-4 animate-spin" /> : <FileGlyph file={item.file} />}</div><div className="min-w-0"><div className={cn("max-w-52 truncate text-[11px] font-semibold", failed ? "text-rose-700" : "text-slate-700")}>{item.file.name}</div><div className={cn("text-[9px]", failed ? "text-rose-500" : item.status === "ready" ? "text-emerald-600" : readiness.level === "caution" ? "text-amber-600" : "text-slate-400")}>{failed ? item.error : item.status === "ready" ? "已读取 · 后台解析完成" : active ? "正在后台读取并建立索引…" : readiness.level === "ok" ? formatBytes(item.file.size) : `${formatBytes(item.file.size)} · ${readiness.note}`}</div></div><Badge className={item.status === "ready" ? "border-emerald-200 bg-white text-emerald-700" : active ? "border-indigo-100 bg-white text-indigo-600" : undefined}>{item.status === "ready" ? "已读取" : active ? "解析中" : failed ? "异常" : roleLabels[item.role]}</Badge>{failed && <button onClick={() => retryPendingFile(item)} className="rounded-lg border border-rose-200 bg-white px-2 py-1 text-[9px] font-semibold text-rose-600 hover:bg-rose-50">重试</button>}<button onClick={() => removePendingFile(item)} className="grid size-6 place-items-center rounded-lg text-slate-400 hover:bg-white hover:text-rose-500"><X className="size-3" /></button></div>; })}</div>}
          {showPaste && <div className="mb-3 rounded-xl border bg-slate-50 p-3"><div className="mb-2 flex items-center justify-between"><div className="text-xs font-semibold text-slate-600">粘贴需要进化或参考的原始内容</div><button onClick={() => { setShowPaste(false); setPastedText(""); }} className="text-xs text-slate-400">关闭</button></div><Textarea value={pastedText} onChange={(e) => setPastedText(e.target.value)} className="min-h-32 bg-white font-mono text-xs" placeholder="例如：当前 System Prompt、Workflow JSON、报告模板、代码片段……" /></div>}
          <div className="composer-input rounded-xl bg-slate-100/80 p-2 focus-within:bg-slate-50 focus-within:ring-2 focus-within:ring-indigo-200">
            <Textarea value={command} onChange={(e) => setCommand(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void send(); } }} className="min-h-20 resize-none border-0 px-2 py-2 shadow-none outline-none focus:ring-0" placeholder={intake ? "继续补充要求，例如：保持现有格式，不允许改数据库结构……" : "告诉 AI 你要怎么进化。例如：把这个 Agent 的结论证据完整率提高到 90%，同时不要增加明显成本……"} />
            <div className="flex flex-wrap items-center gap-2 px-1 pt-2">
              <input ref={fileRef} type="file" multiple className="hidden" onChange={(e) => { if (e.target.files) addFiles(e.target.files); e.currentTarget.value = ""; }} accept=".txt,.md,.mdx,.json,.yaml,.yml,.csv,.tsv,.pdf,.doc,.docx,.rtf,.odt,.ppt,.pptx,.xls,.xlsx,.zip,.html,.xml,.js,.jsx,.ts,.tsx,.py,.go,.rs,.java,.sql,.css,image/*" />
              <input ref={replaceRef} type="file" className="hidden" onChange={(e) => { const picked = e.target.files?.[0]; if (picked && replacingId) void replaceArtifact(replacingId, picked); e.currentTarget.value = ""; }} />
              <Button variant="ghost" size="sm" onClick={() => fileRef.current?.click()}><Paperclip className="size-4" />上传附件</Button>
              <Button variant="ghost" size="sm" onClick={() => setShowPaste((x) => !x)}><Plus className="size-4" />粘贴内容</Button>
              <div className="flex items-center gap-2 sm:ml-auto">
                <span className="hidden text-[10px] text-slate-400 sm:inline">文件会自动读取；发送仅用于告诉 AI 你希望怎么处理</span>
                <button aria-label="发送进化要求" disabled={!canSend || busy} onClick={() => void send()} className="grid size-9 place-items-center rounded-xl bg-slate-900 text-white transition enabled:hover:bg-indigo-600 disabled:cursor-not-allowed disabled:bg-slate-200"><ArrowUp className="size-4" /></button>
              </div>
            </div>
          </div>
          <div className="mt-2 flex flex-wrap items-center justify-between gap-1 text-[10px] text-slate-500"><span>支持拖拽 · 最多 12 个文件 · 单文件 25MB · 上传后立即后台解析</span><span>{files.some((item) => item.status === "parsing" || item.status === "queued") ? "正在读取…" : files.length ? "文件已读取，可直接发送要求" : hasSource ? "材料已进入上下文" : "无需配置解析器"}</span></div>
        </div>
      </CardContent>
    </Card>
  </div>;
}
