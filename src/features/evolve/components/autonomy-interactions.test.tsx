import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
vi.mock("@/components/ui/button", () => ({ Button: (props: import("react").ButtonHTMLAttributes<HTMLButtonElement>) => <button {...props}/> }));
vi.mock("@/components/ui/badge", () => ({ Badge: (props: import("react").HTMLAttributes<HTMLSpanElement>) => <span {...props}/> }));
vi.mock("@/components/ui/card", () => ({
  Card: (props: import("react").HTMLAttributes<HTMLDivElement>) => <div {...props}/> ,
  CardContent: (props: import("react").HTMLAttributes<HTMLDivElement>) => <div {...props}/> ,
  CardHeader: (props: import("react").HTMLAttributes<HTMLDivElement>) => <div {...props}/> ,
  CardTitle: (props: import("react").HTMLAttributes<HTMLDivElement>) => <div {...props}/> ,
}));
import { demoProject } from "../data/mock-project";
import type { EvolveProject } from "../schemas";
import type { ProjectRuntime } from "../runtime/use-project-runtime";
import { AutonomousEvolutionPanel } from "./autonomous-evolution-panel";
import { EvolutionCampaignCenter } from "./evolution-campaign-center";
import { AttentionRequestPanel } from "./attention-request-panel";
import { autonomousAttention } from "../runtime/autonomous-evolution";

function readyProject(patch: Partial<EvolveProject> = {}): EvolveProject {
  return {
    ...demoProject,
    inputUnderstanding: {
      status: "ready",
      intentRestatement: "优化当前成果",
      implicitRequirements: [],
      assumptions: [],
      acceptanceFocus: [],
      confidence: 0.9,
      clarifications: [],
    },
    inputClarifications: [],
    ...patch,
  } as EvolveProject;
}

function runtimeFor(project: EvolveProject, patch: Record<string, unknown> = {}) {
  return {
    project,
    stage: project.stage,
    status: { busy: false },
    setStage: vi.fn(),
    runAutoPilot: vi.fn(),
    resumeAutonomousEvolution: vi.fn(),
    pauseCampaign: vi.fn(),
    updateCampaign: vi.fn(),
    runCampaignRound: vi.fn(),
    runCampaign: vi.fn(),
    scheduleCampaign: vi.fn(),
    materializeOutputs: vi.fn(),
    prepareChampionRelease: vi.fn(),
    resetCampaign: vi.fn(),
    ...patch,
  } as unknown as ProjectRuntime;
}

describe("autonomous interaction routing", () => {
  it("处理这个问题 focuses the unified attention panel instead of setting the same stage again", async () => {
    const project = readyProject({
      campaign: { ...demoProject.campaign, status: "paused", stopReason: "已达到设定的最大进化轮数 5" },
    });
    const runtime = runtimeFor(project);
    const target = document.createElement("div");
    target.id = "evolve-attention-request";
    const scrollIntoView = vi.fn();
    Object.defineProperty(target, "scrollIntoView", { value: scrollIntoView, configurable: true });
    document.body.append(target);
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    await act(async () => root.render(<AutonomousEvolutionPanel runtime={runtime} onOpenSource={vi.fn()} onOpenOutputs={vi.fn()} onOpenAdvanced={vi.fn()} onOpenRuntime={vi.fn()} />));
    const button = [...host.querySelectorAll("button")].find((item) => item.textContent?.includes("处理这个问题"));
    expect(button).toBeTruthy();
    await act(async () => button!.click());
    expect(scrollIntoView).toHaveBeenCalledTimes(1);
    expect(runtime.setStage).not.toHaveBeenCalled();
    await act(async () => root.unmount());
    host.remove(); target.remove();
  });

  it("局部证据问题打开运行详情，不误导为 AI 连接故障", async () => {
    const criterion = { ...demoProject.acceptanceRubric[0]!, id: "LOCAL", title: "完整流程", validationMethod: "semantic-judge" as const };
    const testCase = { ...demoProject.hiddenEvalSuite[0]!, id: "H-LOCAL", criterionIds: [criterion.id] };
    const project = readyProject({
      acceptanceRubric: [criterion],
      hiddenEvalSuite: [testCase],
      validationRun: {
        ...demoProject.validationRun,
        status: "completed",
        runs: [{ testCaseId: testCase.id, output: "retrieved context", latencyMs: 0, cost: 0, verificationStatus: "partial", trace: [{ id: "excerpt", stage: "semantic-evidence", summary: "只取得相关片段", status: "warning", detail: "workflow.html:45000" }] }],
        evaluation: { ...demoProject.baselineRun.result!, unverifiedCriterionIds: [criterion.id], criterionScores: [{ criterionId: criterion.id, score: 0, pass: false, verificationStatus: "partial", evidence: [], gaps: ["片段不足"], testCaseIds: [testCase.id] }] },
      },
      campaign: { ...demoProject.campaign, status: "paused", stopReason: "本地评审自动重试已耗尽[judge-contract-v3]" },
    });
    const attention = autonomousAttention(project);
    expect(attention?.request?.diagnosticCode).toBe("local-evidence-incomplete");
    const onOpenRuntime = vi.fn();
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    const revalidateAndContinue = vi.fn().mockResolvedValue(false);
    const runtime = runtimeFor(project, { revalidateAndContinue });
    await act(async () => root.render(<><AutonomousEvolutionPanel runtime={runtime} onOpenSource={vi.fn()} onOpenOutputs={vi.fn()} onOpenAdvanced={vi.fn()} onOpenRuntime={onOpenRuntime} /><AttentionRequestPanel runtime={runtime} attention={attention!} onOpenSource={vi.fn()} onOpenAdvanced={vi.fn()} onOpenRuntime={onOpenRuntime} /></>));
    expect(host.textContent).toContain("本地证据未覆盖完整成果");
    expect(host.textContent).toContain("workflow.html:45000");
    expect(host.textContent).not.toContain("AI 评审服务需要恢复");
    const topButton = [...host.querySelectorAll("button")].find((item) => item.textContent?.includes("查看证据详情"));
    expect(topButton).toBeTruthy();
    await act(async () => topButton!.click());
    expect(onOpenRuntime).toHaveBeenCalledTimes(1);
    const detailButton = [...host.querySelectorAll("button")].find((item) => item.textContent?.includes("查看技术运行记录"));
    await act(async () => detailButton!.click());
    expect(onOpenRuntime).toHaveBeenCalledTimes(2);
    const retryButton = [...host.querySelectorAll("button")].find((item) => item.textContent?.includes("证据补齐后重新验收"));
    await act(async () => { retryButton!.click(); await Promise.resolve(); });
    expect(revalidateAndContinue).toHaveBeenCalledTimes(1);
    expect(host.querySelector('[role="alert"]')?.textContent).toContain("仍未取得完整证据");
    await act(async () => root.unmount());
    host.remove();
  });

  it("paused campaign uses the explicit resume action instead of starting AutoPilot against stale pause state", async () => {
    const project = readyProject({
      campaign: { ...demoProject.campaign, status: "paused", stopReason: "用户暂停（断点已保存，可继续）" },
    });
    const resume = vi.fn();
    const runAutoPilot = vi.fn();
    const runtime = runtimeFor(project, { resumeAutonomousEvolution: resume, runAutoPilot });
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    await act(async () => root.render(<EvolutionCampaignCenter runtime={runtime} onOpenAttention={vi.fn()} />));
    const button = [...host.querySelectorAll("button")].find((item) => item.textContent?.includes("应用当前设置并继续"));
    expect(button).toBeTruthy();
    await act(async () => button!.click());
    expect(resume).toHaveBeenCalledTimes(1);
    expect(runAutoPilot).not.toHaveBeenCalled();
    await act(async () => root.unmount());
    host.remove();
  });

  it("shows a model recovery action for a failed Baseline Judge instead of budget controls", async () => {
    const project = readyProject({
      stage: "target",
      campaign: { ...demoProject.campaign, status: "paused", stopReason: "Baseline 评审未完成，已保留断点：模型连接断开" },
    });
    const attention = autonomousAttention(project);
    expect(attention?.kind).toBe("model");
    const resume = vi.fn().mockResolvedValue(false);
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    await act(async () => root.render(<AttentionRequestPanel runtime={runtimeFor(project, { resumeAutonomousEvolution: resume })} attention={attention!} onOpenSource={vi.fn()} onOpenAdvanced={vi.fn()} onOpenRuntime={vi.fn()} />));
    expect(host.textContent).toContain("Baseline 评审未完成");
    expect(host.textContent).toContain("真实评审调用未完成");
    expect(host.textContent).not.toContain("调整轮数、预算");
    expect(host.querySelector('a[href="#/settings"]')?.textContent).toContain("AI 模型与连接");
    const button = [...host.querySelectorAll("button")].find((item) => item.textContent?.includes("配置完成，重新测量基线"));
    expect(button).toBeTruthy();
    await act(async () => {
      button!.click();
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
    expect(resume).toHaveBeenCalledTimes(1);
    await act(async () => root.unmount());
    host.remove();
  });
  it("shows a visible reason when retry cannot pass the current boundary", async () => {
    const project = readyProject({
      campaign: { ...demoProject.campaign, status: "paused", stopReason: "已达到设定的最大进化轮数 5" },
    });
    const attention = autonomousAttention(project);
    expect(attention?.request?.type).toBe("limit");
    const resume = vi.fn().mockResolvedValue(false);
    const runtime = runtimeFor(project, { resumeAutonomousEvolution: resume });
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    await act(async () => root.render(<AttentionRequestPanel runtime={runtime} attention={attention!} onOpenSource={vi.fn()} onOpenAdvanced={vi.fn()} onOpenRuntime={vi.fn()} />));
    const button = [...host.querySelectorAll("button")].find((item) => item.textContent?.includes("按当前设置重试"));
    expect(button).toBeTruthy();
    await act(async () => {
      button!.click();
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
    expect(resume).toHaveBeenCalledTimes(1);
    expect(host.querySelector('[role="alert"]')?.textContent).toContain("调整高级边界");
    await act(async () => root.unmount());
    host.remove();
  });
});
