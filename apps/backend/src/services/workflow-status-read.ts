import { getRun } from "workflow/api";
import { EvolutionWorkflowStatusResponseSchema, type EvolutionWorkflowStatusResponse } from "@evolution/contracts";

type WorkflowObservation = Pick<EvolutionWorkflowStatusResponse, "workflow" | "workflowReadError">;
export const WORKFLOW_STATUS_READ_TIMEOUT_MS = 5_000;

/** Keep the durable Job readable when the external Workflow service is unavailable. */
export async function readServerWorkflowStatus(runId: string): Promise<WorkflowObservation> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const read = async (): Promise<WorkflowObservation> => {
    try {
      const run = getRun(runId);
      const exists = await run.exists;
      const workflow = exists ? { exists: true, status: await run.status } : { exists: false };
      return { workflow: EvolutionWorkflowStatusResponseSchema.shape.workflow.parse(workflow) };
    } catch {
      // Provider errors may include private infrastructure details. Report
      // uncertainty without inventing an existence/terminal-state receipt.
      return { workflowReadError: "unavailable" };
    }
  };
  try {
    return await Promise.race([
      read(),
      new Promise<WorkflowObservation>(resolve => {
        timer = setTimeout(() => resolve({ workflowReadError: "timeout" }), WORKFLOW_STATUS_READ_TIMEOUT_MS);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
