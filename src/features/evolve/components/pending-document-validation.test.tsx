import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { demoProject } from "../data/mock-project";
import { AcceptanceCriterionSchema } from "../schemas";
import type { ProjectRuntime } from "../runtime/use-project-runtime";
import type { AutonomousAttention } from "../runtime/autonomous-evolution";
import { AttentionRequestPanel } from "./attention-request-panel";
// Prime the real lazy Stage panel before Vitest starts timing this interaction.
// This retains the actual component instead of replacing it with a mock.
import "./stage-panels";
vi.mock("@/components/ui/button", () => ({ Button: (props: import("react").ButtonHTMLAttributes<HTMLButtonElement>) => <button {...props}/> }));

it("shows a local review's actual gap and starts one fresh validation from the screenshot's stale evidence panel", async () => {
  const criterion = AcceptanceCriterionSchema.parse({ id: "USER-WORKFLOW-CLOSURE", title: "流程完整闭环", requirement: "SOP 写明检查与恢复步骤", hardGate: true, validationMethod: "semantic-judge" });
  const gap = "测试已执行，但评审模型未返回逐标准判定";
  const project = { ...demoProject, acceptanceRubric: [criterion], hiddenEvalSuite: [], validationRun: {
    ...demoProject.validationRun, evaluation: { ...demoProject.baselineRun.result!, unverifiedCriterionIds: [criterion.id],
      criterionScores: [{ criterionId: criterion.id, score: 0, pass: false, verificationStatus: "unverified" as const, evidence: [], gaps: [gap], testCaseIds: [] }] },
  } };
  const retry = vi.fn().mockResolvedValue(false);
  const runtime = { project, status: { busy: false }, revalidateAndContinue: retry } as unknown as ProjectRuntime;
  const attention = { request: { type: "evidence", criterionIds: [criterion.id], reason: "流程完整闭环" } } as AutonomousAttention;
  const host = document.createElement("div"); document.body.append(host);
  const root = createRoot(host);
  const actGlobals=globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT?:boolean};
  const previousAct=actGlobals.IS_REACT_ACT_ENVIRONMENT;
  actGlobals.IS_REACT_ACT_ENVIRONMENT=true;
  try {
    await act(async () => root.render(<AttentionRequestPanel runtime={runtime} attention={attention} onOpenSource={vi.fn()} onOpenRuntime={vi.fn()} onOpenAdvanced={vi.fn()}/>));
    // The detailed Criterion editor is now a lazy chunk. Wait for its real
    // render instead of asserting against the intentionally fast skeleton.
    await act(async()=>{await Promise.resolve();});
    await vi.waitFor(()=>expect(host.textContent).toContain("还有 1 项系统检查未完成"),{timeout:10_000});
    expect(host.textContent).toContain("当前成果还有系统检查未完成");
    expect(host.textContent).toContain("还有 1 项系统检查未完成");
    expect(host.textContent).toContain(gap);
    expect(host.textContent).not.toContain("系统只缺真实验证");
    expect(host.textContent).not.toContain("缺截图就上传截图");
    const button = [...host.querySelectorAll("button")].find((item) => item.textContent === "重新检查并继续")!;
    await act(async () => { button.click(); await new Promise((resolve) => setTimeout(resolve, 10)); });
    expect(retry).toHaveBeenCalledTimes(1);
  } finally { await act(async () => root.unmount()); host.remove(); actGlobals.IS_REACT_ACT_ENVIRONMENT=previousAct; }
},15_000);