import type { TargetRunResult } from "@evolution/contracts";
import { compactBaselineRunOutput } from "./server-baseline-evidence";

/** Bound the actual independent Judge input, not only the stored execution observation. */
export function serverJudgeEvidence(run: TargetRunResult, query: string) {
  const output = compactBaselineRunOutput(run.output, query, 64_000);
  const outputTruncated = output !== run.output;
  const status = outputTruncated && run.verificationStatus === "verified" ? "partial" as const : run.verificationStatus;
  return {
    run: { ...run, verificationStatus: status },
    payload: { testCaseId: run.testCaseId, verificationStatus: status, outputChunks: [output],
      originalOutputCharacters: run.output.length, outputTruncated,
      trace: run.trace.slice(0, 12).map(step => ({ stage: step.stage, status: step.status, summary: step.summary })) },
  };
}
