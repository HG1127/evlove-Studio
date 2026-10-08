import type { EvolveProject } from "@evolution/contracts";
import { recoverServerControlAiWait, serverControlAiWait, recoverServerExperimentJudgeWait, serverExperimentJudgeWait } from "@evolution/harness";
import { requireServerControlAi, ServerControlAiUnavailableError } from "./server-control-ai";

/** Called only inside an explicitly started durable control run. */
export async function restoreServerControlAiWait(project: EvolveProject): Promise<EvolveProject> {
  const controlWait = serverControlAiWait(project);
  if (!controlWait && !serverExperimentJudgeWait(project)) return project;
  try {
    await requireServerControlAi({ force: true });
  } catch (error) {
    if (error instanceof ServerControlAiUnavailableError) return project;
    throw error;
  }
  const at = new Date().toISOString();
  return controlWait ? recoverServerControlAiWait(project, at) : recoverServerExperimentJudgeWait(project, at);
}
