import { NextResponse } from "next/server";
import { CandidateSchema, EvolveProjectSchema } from "@/features/evolve/schemas";
import { getTargetAdapter } from "@/features/evolve/target/registry";
import { evaluateRuns } from "@/features/evolve/evaluation/service";
import { runEvolveAi } from "@/features/evolve/ai/service";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const project = EvolveProjectSchema.parse(body.project);
    const candidate = CandidateSchema.parse(body.candidate);
    if (project.experimentRun.status !== "completed" || project.experimentRun.winnerId !== candidate.id) throw new Error("Candidate is not the completed experiment winner");
    if (project.hiddenEvalSuite.length === 0) throw new Error("Project hiddenEvalSuite is empty");
    const suite = project.hiddenEvalSuite;
    const adapter = getTargetAdapter(project);
    const runs = [];
    for (const testCase of suite) runs.push(await adapter.run({ project, testCase, variant: candidate }));
    const evaluation = await evaluateRuns({ testCases: suite, runs, context: { mode: "holdout", candidate, project: { goal: project.goal, metrics: project.metrics, sourceUnderstanding: project.sourceUnderstanding } } });

    const baseline = project.baselineRun.result;
    const costLimit = project.metrics.find((m) => m.key === "cost")?.target ?? Number.POSITIVE_INFINITY;
    const evidenceTarget = project.metrics.find((m) => m.key === "evidence")?.target;
    const riskTarget = project.metrics.find((m) => m.key === "risk" || m.key === "robustness")?.target;
    const qualityTarget = project.metrics.find((m) => m.key === "quality" || m.key === "accuracy")?.target;
    const successTarget = project.metrics.find((m) => m.key === "success" || m.key === "completeness")?.target;

    const checks = [
      { label: "Safety", status: evaluation.safety === "PASS" ? "pass" as const : evaluation.safety === "FAIL" ? "fail" as const : "warning" as const, detail: evaluation.safety },
      { label: "关键能力回归", status: evaluation.accuracy >= (baseline?.accuracy ?? 0) - 1 && evaluation.completeness >= (baseline?.completeness ?? 0) - 1 ? "pass" as const : "fail" as const, detail: `Accuracy ${evaluation.accuracy}% / Completeness ${evaluation.completeness}%` },
      ...(qualityTarget !== undefined ? [{ label: "目标质量", status: evaluation.accuracy >= qualityTarget ? "pass" as const : "warning" as const, detail: `质量 ${evaluation.accuracy}% / 目标 ${qualityTarget}%` }] : []),
      ...(successTarget !== undefined ? [{ label: "任务成功", status: evaluation.completeness >= successTarget ? "pass" as const : "warning" as const, detail: `完成度 ${evaluation.completeness}% / 目标 ${successTarget}%` }] : []),
      ...(evidenceTarget !== undefined ? [{ label: "证据覆盖", status: evaluation.evidence >= evidenceTarget ? "pass" as const : "warning" as const, detail: `证据 ${evaluation.evidence}% / 目标 ${evidenceTarget}%` }] : []),
      ...(riskTarget !== undefined ? [{ label: "稳健/风险覆盖", status: evaluation.riskCoverage >= riskTarget ? "pass" as const : "warning" as const, detail: `覆盖 ${evaluation.riskCoverage}% / 目标 ${riskTarget}%` }] : []),
      { label: "成本边界", status: evaluation.averageCost <= costLimit ? "pass" as const : "warning" as const, detail: `平均成本 ${evaluation.averageCost} / 边界 ${Number.isFinite(costLimit) ? costLimit : "未设置"}` },
    ];
    const hardFail = checks.some((check) => check.status === "fail");
    const review = await runEvolveAi("release-review", { baseline, candidate, holdout: evaluation, checks, evolutionCommand: project.evolutionCommand, sourceUnderstanding: project.sourceUnderstanding });
    const aiRecommendation = (review as { recommendation?: "release" | "hold" | "reject" }).recommendation || "hold";
    const recommendation = hardFail ? "hold" : aiRecommendation;
    return NextResponse.json({
      ok: true,
      validationRun: {
        id: `validation-${Date.now()}`,
        status: "completed",
        candidateId: candidate.id,
        evaluation,
        checks,
        recommendation,
        summary: hardFail ? "存在 Hard Gate 失败项，不能进入发布。" : ((review as { summary?: string }).summary || "Holdout validation complete."),
      },
      review,
    });
  } catch (error) {
    return NextResponse.json({ ok: false, error: { code: "VALIDATION_FAILED", message: error instanceof Error ? error.message : "Unknown error" } }, { status: 400 });
  }
}
