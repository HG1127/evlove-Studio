import { NextResponse } from "next/server";
import { CandidateSchema, EvolveProjectSchema } from "@/features/evolve/schemas";
import { getTargetAdapter } from "@/features/evolve/target/registry";

const actions = ["shadow", "canary-5", "canary-20", "canary-50", "promote", "rollback"] as const;
type Action = typeof actions[number];

const requiredPrevious: Partial<Record<Action, string>> = {
  shadow: "idle",
  "canary-5": "shadow",
  "canary-20": "canary-5",
  "canary-50": "canary-20",
  promote: "canary-50",
};

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const project = EvolveProjectSchema.parse(body.project);
    const candidate = CandidateSchema.parse(body.candidate);
    if (!actions.includes(body.action as Action)) throw new Error("Unsupported release action");
    const action = body.action as Action;

    const releaseGate = project.gates.find((gate) => gate.id === "release-ready");
    if (action !== "rollback" && releaseGate?.status !== "approved") throw new Error("Release Ready gate is not approved");
    if (action !== "rollback" && project.release.healthy === false) throw new Error("Current release KPI is unhealthy. Rollback or investigate before advancing traffic.");

    if (action !== "rollback") {
      const expected = requiredPrevious[action];
      if (expected && project.release.status !== expected) {
        throw new Error(`Invalid release transition: ${project.release.status} → ${action}; expected previous state ${expected}`);
      }
    } else if (project.release.status === "idle") {
      throw new Error("Nothing has been released, rollback is not available");
    }

    if (project.validationRun.recommendation !== "release" && action !== "rollback") throw new Error("Validation did not recommend release");
    if (project.experimentRun.winnerId !== candidate.id) throw new Error("Only the experiment winner can be released");

    const adapter = getTargetAdapter(project);
    if (!adapter.release) throw new Error("Target adapter does not implement release()");
    const result = await adapter.release({ project, candidate, action });
    return NextResponse.json({ ...result, action });
  } catch (error) {
    return NextResponse.json({ ok: false, error: { code: "RELEASE_FAILED", message: error instanceof Error ? error.message : "Unknown error" } }, { status: 400 });
  }
}
