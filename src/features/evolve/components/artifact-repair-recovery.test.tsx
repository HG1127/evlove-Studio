import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { demoProject } from "../data/mock-project";
import { CandidateSchema, EvolveProjectSchema } from "../schemas";
import type { ProjectRuntime } from "../runtime/use-project-runtime";
import { autonomousAttention } from "../runtime/autonomous-evolution";
import { AttentionRequestPanel } from "./attention-request-panel";
import { AutonomousEvolutionPanel } from "./autonomous-evolution-panel";
vi.mock("@/components/ui/button", () => ({ Button: (props: import("react").ButtonHTMLAttributes<HTMLButtonElement>) => <button {...props}/> }));
vi.mock("./stage-panels", () => ({ PendingEvidencePanel: () => <div>缺截图就上传截图</div> }));

it("routes the screenshot's repair timeout to model recovery and reports a failed retry visibly", async () => {
  const project = EvolveProjectSchema.parse(structuredClone(demoProject));
  project.inputUnderstanding = { status: "ready", intentRestatement: "完善流程", implicitRequirements: [], assumptions: [], acceptanceFocus: [], confidence: 0.9, clarifications: [] };
  project.inputClarifications = [];
  const candidate = CandidateSchema.parse({ id: "current", name: "当前成果", change: "修复" });
  project.candidates = [candidate];
  project.experimentRun = { ...project.experimentRun, winnerId: candidate.id };
  project.artifactAcceptance = { ...project.artifactAcceptance, status: "failed", candidateId: candidate.id,
    error: "repair-artifact生成未完成：MiniMax：模型在 120 秒内未返回完整结果", summary: "已保留本轮 Hidden Validation 证据；自动修复第 1 次未完成：模型超时" };
  project.campaign = { ...project.campaign, status: "paused", stopReason: project.artifactAcceptance.summary };
  const attention = autonomousAttention(project)!;
  expect(attention.kind).toBe("model");
  const retry = vi.fn().mockResolvedValue(false);
  const runtime = { project, stage: "validation", status: { busy: false }, revalidateAndContinue: retry } as unknown as ProjectRuntime;
  const callbacks = { onOpenSource: vi.fn(), onOpenAdvanced: vi.fn(), onOpenRuntime: vi.fn() };
  const host = document.createElement("div"); document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () => root.render(<><AutonomousEvolutionPanel runtime={runtime} {...callbacks} onOpenOutputs={vi.fn()} /><AttentionRequestPanel runtime={runtime} attention={attention} {...callbacks} /></>));
    expect(host.textContent).toContain("AI 自动修复需要重试");
    expect(host.textContent).not.toContain("系统无法自行取得的验证");
    expect(host.textContent).not.toContain("缺截图就上传截图");
    expect(host.textContent).not.toContain("系统只缺真实验证");
    expect(host.querySelector('a[href="#/settings"]')?.textContent).toBe("AI 模型与连接");
    const button = [...host.querySelectorAll("button")].find((item) => item.textContent === "重试自动修复并继续")!;
    await act(async () => { button.click(); await Promise.resolve(); });
    expect(retry).toHaveBeenCalledTimes(1);
    expect(host.querySelector('[role="alert"]')?.textContent).toContain("自动修复或后续验收仍未完成");
    expect(button.disabled).toBe(false);
  } finally {
    await act(async () => root.unmount()); host.remove();
  }
});
