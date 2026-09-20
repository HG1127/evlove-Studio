import { NextResponse } from "next/server";
import { CandidateSchema, EvolveProjectSchema } from "@/features/evolve/schemas";
import { getTargetAdapter } from "@/features/evolve/target/registry";
import { evaluateRuns } from "@/features/evolve/evaluation/service";

function score(e: { accuracy: number; evidence: number; riskCoverage: number; safety: string; averageCost: number; averageLatencyMs: number }) {
  if (e.safety === "FAIL") return -Infinity;
  return e.accuracy * 0.32 + e.evidence * 0.35 + e.riskCoverage * 0.18 - e.averageCost * 4 - e.averageLatencyMs / 10000 * 1.5;
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const project = EvolveProjectSchema.parse(body.project);
    const experimentGate = project.gates.find((gate) => gate.id === "experiment-ready");
    if (experimentGate?.status !== "approved") throw new Error("Experiment Ready gate is not approved");
    const candidates = CandidateSchema.array().parse(body.candidates);
    if (project.evalSuite.length === 0) throw new Error("Project evalSuite is empty");
    const suite = project.evalSuite;
    const adapter = getTargetAdapter(project);
    const candidateResults = [];

    for (const candidate of candidates) {
      const runs = [];
      for (const testCase of suite) {
        runs.push(await adapter.run({ project, testCase, variant: candidate }));
      }
      const evaluation = await evaluateRuns({ testCases: suite, runs, context: { mode: "candidate", candidate, project: { goal: project.goal, metrics: project.metrics } } });
      candidateResults.push({ candidateId: candidate.id, evaluation, runs });
    }

    const winner = [...candidateResults].sort((a, b) => score(b.evaluation) - score(a.evaluation))[0];
    return NextResponse.json({
      ok: true,
      experimentRun: {
        id: `experiment-${Date.now()}`,
        status: "completed",
        startedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
        candidateResults,
        winnerId: winner?.candidateId,
        summary: winner ? `${winner.candidateId} 在质量、成本、延迟与安全的综合比较中领先。` : "没有候选通过。",
      },
    });
  } catch (error) {
    return NextResponse.json({ ok: false, error: { code: "EXPERIMENT_FAILED", message: error instanceof Error ? error.message : "Unknown error" } }, { status: 400 });
  }
}
