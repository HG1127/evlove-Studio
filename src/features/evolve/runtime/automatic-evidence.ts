import { getAiProviderStatus, runEvolveAi } from "../ai/service";
import { VisualJudgeAiResultSchema } from "../ai/schemas";
import type { EvolveProject } from "../schemas";
import { TestCaseSchema } from "../schemas";
import { httpTargetAdapter } from "../target/http-adapter";
import {hasAmbiguousAutoProxyHtmlTarget} from "@evolution/core";
import { getArtifactBlob } from "./artifact-blob-store";
import {
  beginEvidenceJob,
  ensureEvidenceJob,
  evidenceJobOutcome,
  finishEvidenceJob,
  listEvidenceJobs,
  retryEvidenceJob,
  type EvidenceJobKind,
} from "./evidence-job-store";
import { sha256, textDigest } from "./frozen-artifact";
import {
  connectedTargetConnection,
  getRunnerGatewayConfig,
  isRunnerDetachedByUser,
  isRunnerGatewayReady,
  testRunnerGateway,
} from "./target-runner-config";
import { addVisualEvidence, getVisualEvidence, hydrateVisualEvidence, saveVisualJudge } from "./visual-evidence";

export type AutomaticEvidenceResult = {
  status: "completed" | "partial" | "skipped";
  summary: string;
  connection?: EvolveProject["targetConnection"];
};

const automaticEvidenceResults = new Map<string, AutomaticEvidenceResult>();
const automaticEvidenceRuns = new Map<string, Promise<AutomaticEvidenceResult>>();

function sourceFingerprint(project: EvolveProject) {
  return project.sourceArtifacts.map((item) => `${item.id}:${item.createdAt}:${item.size}:${item.parseStatus}`).join("|");
}

function executableTestFingerprint(project: EvolveProject) {
  return project.evalSuite
    .filter((test) => test.executionMode === "external-runner" && (test.browserSteps?.length ?? 0) > 0)
    .map((test) => `${test.id}:${JSON.stringify(test.browserSteps)}`)
    .join("|");
}

/** Background evidence restarts only when source material or executable validation contract changes. */
export function automaticEvidenceKey(project: EvolveProject) {
  return `${project.id}:${sourceFingerprint(project)}:tests:${executableTestFingerprint(project)}`;
}

export function getCachedAutomaticEvidence(project: EvolveProject) {
  return automaticEvidenceResults.get(automaticEvidenceKey(project));
}

export function clearAutomaticEvidenceCache(project: EvolveProject) {
  automaticEvidenceResults.delete(automaticEvidenceKey(project));
}

async function runJob<T>(args: {
  project: EvolveProject;
  kind: EvidenceJobKind;
  scope: string;
  label: string;
  fingerprint: string;
  force?: boolean;
  task: () => Promise<{ value: T; outcome: Parameters<typeof finishEvidenceJob>[2] }>;
}): Promise<{ value?: T; status: string; summary?: string }> {
  let job = await ensureEvidenceJob({
    projectId: args.project.id,
    kind: args.kind,
    scope: args.scope,
    label: args.label,
    fingerprint: args.fingerprint,
  });
  if (args.force && job.status !== "running") job = await retryEvidenceJob(job.id) ?? job;
  if (!args.force && ["ready", "partial", "unavailable"].includes(job.status)) {
    return { status: job.status, summary: job.summary };
  }
  const running = await beginEvidenceJob(job.id);
  if (!running) return { status: "failed", summary: "后台证据任务不存在" };
  try {
    const completed = await args.task();
    const accepted = await finishEvidenceJob(running.id, running.generation, completed.outcome);
    if (!accepted) return { status: "stale", summary: "较新的证据任务已接管本次结果" };
    return { value: completed.value, status: completed.outcome.status, summary: completed.outcome.summary };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await finishEvidenceJob(running.id, running.generation, { status: "failed", summary: message, error: message });
    return { status: "failed", summary: message };
  }
}

async function registerUploadedImages(project: EvolveProject) {
  let existing = getVisualEvidence(project.id);
  let added = 0;
  let skipped = 0;
  for (const artifact of project.sourceArtifacts.filter((item) => item.mimeType.startsWith("image/"))) {
    if (existing.items.some((item) => item.sourceArtifactId === artifact.id)) continue;
    if (existing.items.length >= 8) { skipped += 1; continue; }
    const blob = await getArtifactBlob(artifact.id);
    if (!blob) { skipped += 1; continue; }
    try {
      const hash = await sha256(await blob.arrayBuffer());
      added += await addVisualEvidence(project.id, [new File([blob], artifact.name, { type: artifact.mimeType })], {
        artifactHash: hash,
        sourceArtifactId: artifact.id,
        origin: "upload",
      });
      existing = getVisualEvidence(project.id);
    } catch {
      skipped += 1;
    }
  }
  return { added, skipped };
}

/** Runner discovery is metadata, not permission to replace an uploaded Target. */
export function canAutoAdoptDiscoveredRunner(project:EvolveProject):boolean{
  return project.targetConnection.adapter!=="http"
    &&!project.sourceArtifacts.some(source=>source.role==="target");
}

async function discoverRunner(project: EvolveProject, force = false) {
  if (isRunnerDetachedByUser(project.id)) return { effective: project, connection: undefined, summary: "项目已主动关闭后台 Runner" };
  const config = getRunnerGatewayConfig();
  if (!isRunnerGatewayReady(config)) return { effective: project, connection: undefined, summary: "后台 Runner 尚未启用" };
  let testedOk = project.targetConnection.adapter === "http";
  const result = await runJob({
    project,
    kind: "runner-discovery",
    scope: "default",
    label: "后台执行器探测",
    fingerprint: `${config.enabled}:${config.runUrl}:${config.timeoutMs}`,
    force,
    task: async () => {
      const tested = await testRunnerGateway(config);
      testedOk = tested.ok;
      return {
        value: tested,
        outcome: {
          status: tested.ok ? "ready" : "unavailable",
          summary: tested.message,
          error: tested.ok ? undefined : tested.message,
        },
      };
    },
  });
  if (result.value) testedOk = result.value.ok;
  else if (result.status === "ready") testedOk = true;
  if (!testedOk) return { effective: project, connection: undefined, summary: result.summary ?? "后台 Runner 暂不可用" };
  const sourceOwned=project.sourceArtifacts.some(source=>source.role==="target");
  const connection = canAutoAdoptDiscoveredRunner(project) ? connectedTargetConnection(config, project.id) : undefined;
  return {
    effective: connection ? { ...project, targetConnection: connection } : project,
    connection,
    summary: sourceOwned ? "Server Target Proxy 已探测，但当前上传文件仍是原 Target；连接代理不会自动改写 Artifact 绑定。" : result.summary ?? "后台 Runner 已就绪",
  };
}

async function runBuildEvidence(project: EvolveProject, force = false) {
  const source = project.sourceArtifacts.find((item) => item.role === "target" && item.extension === "zip");
  if (!source) return undefined;
  const fingerprint = `${source.id}:${source.createdAt}:${source.size}`;
  return runJob({
    project,
    kind: "build",
    scope: source.id,
    label: "工程 Build / Test",
    fingerprint,
    force,
    task: async () => {
      const testCase = TestCaseSchema.parse({
        id: "automatic-build",
        title: "后台工程 Build / Test",
        input: project.goal,
        expected: ["源码包在受控隔离环境完成配置的 Build / Test"],
        executionMode: "external-runner",
        evidenceScope: "implementation",
      });
      const result = await httpTargetAdapter.run({ project, testCase });
      return { value: result, outcome: evidenceJobOutcome(result) };
    },
  });
}

async function runHtmlSmoke(project: EvolveProject, force = false) {
  const source = project.sourceArtifacts.find((item) => item.role === "target" && /^(html|htm)$/i.test(item.extension));
  if (!source?.textContent) return undefined;
  const artifactHash = await textDigest(source.textContent);
  const result = await runJob({
    project,
    kind: "browser-smoke",
    scope: source.id,
    label: "真实浏览器 Smoke",
    fingerprint: artifactHash,
    force,
    task: async () => {
      const testCase = TestCaseSchema.parse({
        id: "automatic-browser-evidence",
        title: "后台浏览器验证",
        input: project.goal,
        expected: ["页面可打开", "无脚本错误", "桌面与手机视口无横向溢出"],
        executionMode: "external-runner",
        evidenceScope: "product-behavior",
        browserSteps: [],
      });
      const run = await httpTargetAdapter.run({ project, testCase });
      const screenshots = run.screenshots ?? [];
      const files = await Promise.all(screenshots.map(async (shot) => new File(
        [await (await fetch(shot.dataUrl)).blob()],
        `自动验证-${shot.name}`,
        { type: "image/png" },
      )));
      if (files.length) await addVisualEvidence(project.id, files, {
        artifactHash,
        sourceArtifactId: source.id,
        origin: "browser-auto",
      });
      return { value: run, outcome: evidenceJobOutcome(run) };
    },
  });

  const screenshotJob = await ensureEvidenceJob({
    projectId: project.id,
    kind: "screenshot",
    scope: source.id,
    label: "双视口截图",
    fingerprint: artifactHash,
  });
  if (force && screenshotJob.status !== "running") await retryEvidenceJob(screenshotJob.id);
  const screenshotRun = await beginEvidenceJob(screenshotJob.id);
  if (screenshotRun) {
    const count = getVisualEvidence(project.id).items.filter((item) => item.origin === "browser-auto" && item.artifactHash === artifactHash).length;
    await finishEvidenceJob(screenshotRun.id, screenshotRun.generation, {
      status: count ? "ready" : result?.status === "failed" ? "failed" : "unavailable",
      summary: count ? `已保存 ${count} 张真实浏览器截图（桌面 / 手机视口）` : "浏览器未返回可保存截图",
      artifactHash,
    });
  }
  return result;
}

async function runExecutableE2E(project: EvolveProject, force = false) {
  const source = project.sourceArtifacts.find((item) => item.role === "target" && /^(html|htm)$/i.test(item.extension));
  if (!source?.textContent) return [];
  const artifactHash = await textDigest(source.textContent);
  const cases = project.evalSuite
    .filter((test) => test.executionMode === "external-runner" && (test.browserSteps?.length ?? 0) > 0)
    .slice(0, 6);
  const results = [];
  for (const testCase of cases) {
    const fingerprint = `${artifactHash}:${testCase.id}:${JSON.stringify(testCase.browserSteps)}`;
    results.push(await runJob({
      project,
      kind: "e2e",
      scope: testCase.id,
      label: `真实交互 · ${testCase.title}`,
      fingerprint,
      force,
      task: async () => {
        const run = await httpTargetAdapter.run({ project, testCase });
        return { value: run, outcome: evidenceJobOutcome(run) };
      },
    }));
  }
  return results;
}

async function judgeCurrentVisualEvidence(project: EvolveProject, force = false) {
  const evidence = getVisualEvidence(project.id);
  if (!evidence.items.length) return undefined;
  const visualStatus = getAiProviderStatus("visual-judge");
  const fingerprint = evidence.items.map((item) => `${item.id}:${item.artifactHash ?? ""}`).join("|");
  return runJob({
    project,
    kind: "visual-judge",
    scope: "current",
    label: "Visual Judge",
    fingerprint: `${fingerprint}:${visualStatus.model}:${visualStatus.live}`,
    force,
    task: async () => {
      if (!visualStatus.live) return {
        value: false,
        outcome: {
          status: "unavailable",
          summary: "真实浏览器截图已就绪；未连接支持视觉输入的真实模型，因此不伪造 UI/UX 评分。",
        },
      };
      const report = VisualJudgeAiResultSchema.parse(await runEvolveAi("visual-judge", {
        aiProfile: project.aiProfile,
        goal: project.goal,
        protectedItems: project.protectedItems,
        acceptanceRubric: project.acceptanceRubric,
        screenshotVersions: evidence.items.map((item) => ({
          id: item.id,
          artifactHash: item.artifactHash,
          candidateId: item.candidateId,
        })),
        projectName: project.name,
        screenshotCount: evidence.items.length,
        note: "后台自动采集的截图证据。只依据截图可见内容评审；不同文件版本不可合并为同一版本证据。",
      }, { imageDataUrls: evidence.items.map((item) => item.dataUrl) }));
      await saveVisualJudge(project.id, {
        report,
        engine: visualStatus.model,
        screenshotIds: evidence.items.map((item) => item.id),
        artifactHashes: evidence.items.flatMap((item) => item.artifactHash ? [item.artifactHash] : []),
        judgedAt: new Date().toISOString(),
      });
      return {
        value: true,
        outcome: {
          status: "ready",
          summary: `Visual Judge 已完成：可用 ${report.scores.usability} / 美观 ${report.scores.aesthetics} / 响应 ${report.scores.responsiveness} / 交互 ${report.scores.interaction}`,
        },
      };
    },
  });
}

/** Background Evidence Runtime: upload evidence → Runner discovery → Build/Browser/E2E → screenshots → Visual Judge. */
async function runAutomaticEvidence(project: EvolveProject, force = false): Promise<AutomaticEvidenceResult> {
  const messages: string[] = [];
  await hydrateVisualEvidence(project.id);
  const images = await registerUploadedImages(project);
  if (images.added) messages.push(`已自动登记 ${images.added} 张图片证据`);
  if (images.skipped) messages.push(`${images.skipped} 张图片暂未进入证据池`);

  const discovered = await discoverRunner(project, force);
  const effective = discovered.effective;
  const connection = discovered.connection;
  messages.push(discovered.summary);

  if (effective.targetConnection.adapter === "http" && !hasAmbiguousAutoProxyHtmlTarget(effective)) {
    const build = await runBuildEvidence(effective, force);
    if (build?.summary) messages.push(`工程验证：${build.summary}`);

    const smoke = await runHtmlSmoke(effective, force);
    if (smoke?.summary) messages.push(`浏览器验证：${smoke.summary}`);

    const e2e = await runExecutableE2E(effective, force);
    const verified = e2e.filter((item) => item.status === "ready").length;
    const partial = e2e.filter((item) => item.status === "partial").length;
    if (e2e.length) messages.push(`真实交互：${verified} 项已验证${partial ? `，${partial} 项部分验证` : ""}`);
  }

  const judged = await judgeCurrentVisualEvidence(effective, force);
  if (judged?.summary) messages.push(judged.summary);

  const jobs = await listEvidenceJobs(project.id);
  const active = jobs.some((job) => job.status === "queued" || job.status === "running");
  const degraded = jobs.some((job) => ["partial", "unavailable", "failed"].includes(job.status));
  const hasEvidence = jobs.some((job) => ["ready", "partial"].includes(job.status)) || getVisualEvidence(project.id).items.length > 0;
  return {
    status: active || degraded ? "partial" : hasEvidence || connection ? "completed" : "skipped",
    summary: messages.filter(Boolean).join("；") || "当前材料无需额外运行或视觉证据。",
    connection,
  };
}

/** Deduplicate current-run work; persisted Evidence Jobs provide refresh recovery and stale-result protection. */
export async function ensureAutomaticEvidence(project: EvolveProject, options?: { force?: boolean }): Promise<AutomaticEvidenceResult> {
  const key = automaticEvidenceKey(project);
  if (options?.force) automaticEvidenceResults.delete(key);
  const cached = automaticEvidenceResults.get(key);
  if (cached && !options?.force) return cached;
  const running = automaticEvidenceRuns.get(key);
  if (running && !options?.force) return running;

  const task = runAutomaticEvidence(project, Boolean(options?.force))
    .then((result) => {
      automaticEvidenceResults.set(key, result);
      return result;
    })
    .finally(() => {
      automaticEvidenceRuns.delete(key);
    });
  automaticEvidenceRuns.set(key, task);
  return task;
}

