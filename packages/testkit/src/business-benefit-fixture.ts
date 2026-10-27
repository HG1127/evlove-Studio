import { BusinessBenefitPolicySchema, type OutcomeMetricSample } from "@evolution/contracts";
import { acceptedPackageFixture } from "./accepted-package-fixture";

/** Synthetic, complete planned cohorts; never a claim of real traffic or actual billing. */
export function businessBenefitFixture(meanOnly = false) {
  const project = acceptedPackageFixture(false).project, checkedAt = new Date().toISOString();
  project.id = "synthetic-business-benefit"; project.goal = "Controlled SOP task benefit";
  project.releaseTarget = { provider: "vercel", status: "connected", mode: "preview-promote", label: "synthetic", healthPath: "/" };
  project.release = { ...project.release, status: "promoted", candidateId: "C", deploymentId: "candidate", stableDeploymentId: "stable" };
  project.metrics = [
    { key: "accepted", label: "accepted attempts", value: 0, target: 0.8, direction: "higher", unit: "ratio" },
    { key: "elapsed", label: "elapsed per attempt", value: 0, target: 200, direction: "lower", unit: "ms" },
    { key: "cost", label: "cost per attempt", value: 0, target: 0.95, direction: "lower", unit: "USD" },
  ];
  const policy = BusinessBenefitPolicySchema.parse({ version: "controlled-task-benefit-v1", source: "outcome-telemetry:trusted", segment: "all",
    acceptanceMetricKey: "accepted", elapsedMetricKey: "elapsed", costMetricKey: "cost", costUnit: "USD",
    stableTaskIds: Array.from({ length: 30 }, (_, i) => `stable-${i}`), candidateTaskIds: Array.from({ length: 30 }, (_, i) => `candidate-${i}`) });
  project.businessBenefitPolicy = policy;
  const samples: OutcomeMetricSample[] = [];
  for (const arm of ["stable", "candidate"] as const) for (let i = 0; i < 30; i++) {
    const values = {
      accepted: arm === "stable" ? (i === 7 || i === 22 ? 0 : 1) : (i % (meanOnly ? 5 : 10) === (meanOnly ? 4 : 9) ? 0 : 1),
      elapsed: arm === "stable" ? (i < 16 ? 100 : 500) : (meanOnly ? 150 : 70), cost: arm === "stable" ? 1 : 0.9,
    };
    for (const [metricKey, value] of Object.entries(values)) samples.push({
      id: `${arm}-${i}-${metricKey}`, workspaceId: "synthetic", missionId: project.id, candidateId: "C", deploymentId: arm, arm, metricKey,
      metricKind: metricKey === "accepted" ? "business" : metricKey === "elapsed" ? "latency" : "cost",
      direction: metricKey === "accepted" ? "higher" : "lower", unit: metricKey === "accepted" ? "ratio" : metricKey === "elapsed" ? "ms" : "USD",
      value, segment: "all", source: policy.source, observedAt: new Date(Date.parse(checkedAt) - 60_000 + i * 1000).toISOString(),
      observation: { schemaVersion: "outcome-observation-v1", kind: "independent-task", taskId: `${arm}-${i}` }, metadata: {},
    });
  }
  return { project, policy, samples, checkedAt };
}
