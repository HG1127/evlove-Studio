import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { OutcomeAnalyticsResponse } from "@evolution/contracts";
import { demoProject } from "../data/mock-project";
import { OutcomeAnalyticsCard } from "./outcome-analytics-card";

const { getAnalysis } = vi.hoisted(() => ({ getAnalysis: vi.fn() }));
vi.mock("../runtime/server-outcome-client", () => ({ getServerOutcomeAnalysis: getAnalysis }));
vi.mock("@/components/ui/button", () => ({ Button: (props: import("react").ButtonHTMLAttributes<HTMLButtonElement>) => <button {...props}/> }));
vi.mock("@/components/ui/card", () => ({
  Card: (props: import("react").HTMLAttributes<HTMLDivElement>) => <div {...props}/> ,
  CardContent: (props: import("react").HTMLAttributes<HTMLDivElement>) => <div {...props}/> ,
}));

const mounted: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const unmount of mounted.splice(0)) await unmount();
  getAnalysis.mockReset();
});

async function mount(candidateId?: string) {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const project = { ...demoProject, release: { ...demoProject.release, candidateId, deploymentId: "deployment-1" } };
  await act(async () => root.render(<OutcomeAnalyticsCard project={project}/>));
  mounted.push(async () => { await act(async () => root.unmount()); host.remove(); });
  return host;
}

const regression: OutcomeAnalyticsResponse = {
  missionId: demoProject.id, candidateId: "candidate-1", checkedAt: "2026-09-28T00:00:00Z",
  sampleCount: 10, minimumSamplesPerArm: 5, verdict: "regression", message: "检测到显著回归",
  metrics: [{ metricKey: "latency", metricKind: "latency", direction: "lower", segment: "all",
    stable: { count: 5, mean: 100 }, candidate: { count: 5, mean: 120 },
    evidenceStatus: "estimated", significance: "significant-regression" }],
  drift: [], regressions: [{ metricKey: "latency", segment: "all", kind: "latency", reason: "slower" }],
};

describe("Production Outcome analysis card", () => {
  it("loads actual server samples only after a read action and shows regression evidence", async () => {
    getAnalysis.mockResolvedValue(regression);
    const host = await mount("candidate-1");
    expect(getAnalysis).not.toHaveBeenCalled();
    expect(host.textContent).toContain("尚未读取服务端统计");
    const button = [...host.querySelectorAll("button")].find((node) => node.textContent?.includes("读取分析"));
    await act(async () => button!.click());
    expect(getAnalysis).toHaveBeenCalledWith(demoProject.id, "candidate-1");
    expect(host.textContent).toContain("检测到回归");
    expect(host.textContent).toContain("Stable 100");
    expect(host.textContent).toContain("Candidate 120");
    expect(host.textContent).toContain("10 条样本");
  });

  it("keeps mixed Deployment evidence visibly insufficient", async () => {
    getAnalysis.mockResolvedValue({ ...regression, verdict: "insufficient", metrics: [], drift: [], regressions: [], message: "样本跨多个 Deployment" });
    const host = await mount("candidate-1");
    await act(async () => host.querySelector("button")!.click());
    expect(host.textContent).toContain("证据不足");
    expect(host.textContent).toContain("样本跨多个 Deployment");
    expect(host.textContent).not.toContain("Stable 100");
  });
  it("shows a real request error without claiming healthy evidence", async () => {
    getAnalysis.mockRejectedValue(new Error("Operator access is not configured"));
    const host = await mount("candidate-1");
    await act(async () => host.querySelector("button")!.click());
    expect(host.querySelector('[role="alert"]')?.textContent).toContain("Operator access is not configured");
    expect(host.textContent).not.toContain("暂无显著回归");
  });

  it("requires a bound Release Candidate before attempting analysis", async () => {
    const host = await mount();
    expect(host.querySelector("button")?.disabled).toBe(true);
    expect(host.textContent).toContain("先完成 Release Candidate 绑定");
    expect(getAnalysis).not.toHaveBeenCalled();
  });
});