import type { Candidate, EvolveProject, ReleaseAdapterResult, TargetRunResult, TestCase } from "../schemas";

export type TargetVariant = Pick<Candidate, "id" | "name" | "change" | "patches" | "artifactSnapshots" | "artifactBuildStatus">;

export interface TargetAdapter {
  readonly name: string;
  readonly live: boolean;
  run(args: { project: EvolveProject; testCase: TestCase; variant?: TargetVariant }): Promise<TargetRunResult>;
  runBatch?(args: { project: EvolveProject; testCases: TestCase[]; variant?: TargetVariant }): Promise<TargetRunResult[]>;
  release?(args: {
    project: EvolveProject;
    candidate: TargetVariant;
    action: "shadow" | "canary-5" | "canary-20" | "canary-50" | "promote" | "rollback";
  }): Promise<ReleaseAdapterResult>;
}
