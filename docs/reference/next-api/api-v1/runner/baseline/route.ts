import { NextResponse } from "next/server";
import { EvolveProjectSchema } from "@/features/evolve/schemas";
import { getTargetAdapter } from "@/features/evolve/target/registry";
import { evaluateRuns } from "@/features/evolve/evaluation/service";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const project = EvolveProjectSchema.parse(body.project);
    const targetGate = project.gates.find((gate) => gate.id === "target-ready");
    if (targetGate?.status !== "approved") throw new Error("Target Ready gate is not approved");
    if (project.evalSuite.length === 0) throw new Error("Project evalSuite is empty");
    const suite = project.evalSuite;
    const adapter = getTargetAdapter(project);
    const runs = [];
    for (const testCase of suite) runs.push(await adapter.run({ project, testCase }));
    const result = await evaluateRuns({ testCases: suite, runs, context: { mode: "baseline", project: { goal: project.goal, metrics: project.metrics } } });
    return NextResponse.json({
      ok: true,
      baselineRun: {
        id: `baseline-${Date.now()}`,
        status: "completed",
        startedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
        suiteName: "Core Validation Suite",
        totalCases: suite.length,
        result,
        runs,
      },
    });
  } catch (error) {
    return NextResponse.json({ ok: false, error: { code: "BASELINE_FAILED", message: error instanceof Error ? error.message : "Unknown error" } }, { status: 400 });
  }
}
