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
    await act(async () => root.render(<AutonomousEvolutionPanel runtime={runtime} onOpenSource={vi.fn()} onOpenOutputs={vi.fn()} onOpenAdvanced={vi.fn()} />));
    const button = [...host.querySelectorAll("button")].find((item) => item.textContent?.includes("处理这个问题"));
    expect(button).toBeTruthy();
    await act(async () => button!.click());
    expect(scrollIntoView).toHaveBeenCalledTimes(1);
    expect(runtime.setStage).not.toHaveBeenCalled();
    await act(async () => root.unmount());
    host.remove(); target.remove();
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
    await act(async () => root.render(<AttentionRequestPanel runtime={runtimeFor(project, { resumeAutonomousEvolution: resume })} attention={attention!} onOpenSource={vi.fn()} onOpenAdvanced={vi.fn()} />));
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
    await act(async () => root.render(<AttentionRequestPanel runtime={runtime} attention={attention!} onOpenSource={vi.fn()} onOpenAdvanced={vi.fn()} />));
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
