import type { EvolveProject } from "@evolution/contracts";
import { recoverServerControlAiWait, serverControlAiWait } from "@evolution/harness";
import { requireServerControlAi, ServerControlAiUnavailableError } from "./server-control-ai";

/** Called only inside an explicitly started durable control run. */
export async function restoreServerControlAiWait(project: EvolveProject): Promise<EvolveProject> {
  if (!serverControlAiWait(project)) return project;
  try {
    await requireServerControlAi({ force: true });
  } catch (error) {
    if (error instanceof ServerControlAiUnavailableError) return project;
    throw error;
  }
  return recoverServerControlAiWait(project, new Date().toISOString());
}
