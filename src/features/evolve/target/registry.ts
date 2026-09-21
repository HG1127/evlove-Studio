import { serverEnv } from "../runtime/env";
import { isRunnerGatewayReady } from "../runtime/target-runner-config";
import type { EvolveProject } from "../schemas";
import { artifactTargetAdapter } from "./artifact-adapter";
import { httpTargetAdapter } from "./http-adapter";
import { mockTargetAdapter } from "./mock-adapter";
import type { TargetAdapter } from "./types";

export function getTargetAdapter(project?: EvolveProject): TargetAdapter {
  const requested = project?.targetConnection.adapter ?? serverEnv.EVOLVE_TARGET_ADAPTER ?? "mock";
  if (requested === "http") return httpTargetAdapter;
  if (requested === "artifact" || requested === "git") return artifactTargetAdapter;
  return mockTargetAdapter;
}

export function getTargetStatus() {
  const gatewayReady = isRunnerGatewayReady();
  const requested = serverEnv.EVOLVE_TARGET_ADAPTER || (gatewayReady ? "http" : "mock");
  const httpRequested = requested === "http";
  const gitRequested = requested === "git";
  return {
    adapter: requested,
    name: httpRequested ? httpTargetAdapter.name : requested === "artifact" || gitRequested ? artifactTargetAdapter.name : mockTargetAdapter.name,
    live: httpRequested || gitRequested,
    configured: httpRequested ? gatewayReady : gitRequested ? false : true,
    releaseConfigured: httpRequested ? gatewayReady : gitRequested ? false : true,
    availableAdapters: ["artifact", "mock", "http", "git"],
  };
}
