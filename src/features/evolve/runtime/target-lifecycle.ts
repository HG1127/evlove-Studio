import type { Candidate, EvolveProject, TargetRunResult, TestCase } from "../schemas";
import { getTargetAdapter } from "../target/registry";
import type { TargetAdapter, TargetVariant } from "../target/types";
import type { TargetLifecycleCapabilities, TargetSnapshot } from "@evolution/contracts";

export type { TargetLifecycleOperation, TargetLifecycleCapabilities, TargetSnapshot } from "@evolution/contracts";

export interface TargetLifecycleAdapter extends TargetAdapter {
  readonly lifecycle: TargetLifecycleCapabilities;
  read?(project:EvolveProject):Promise<unknown>;
  snapshot?(project:EvolveProject):Promise<TargetSnapshot>;
  mutate?(args:{project:EvolveProject;candidate:Candidate}):Promise<TargetVariant>;
  validate?(args:{project:EvolveProject;testCase:TestCase;variant?:TargetVariant}):Promise<TargetRunResult>;
  deploy?(args:{project:EvolveProject;candidate:TargetVariant;action:"shadow"|"canary-5"|"canary-20"|"canary-50"|"promote"}):Promise<unknown>;
  observe?(project:EvolveProject):Promise<unknown>;
  rollback?(args:{project:EvolveProject;candidate:TargetVariant}):Promise<unknown>;
}

export function targetLifecycleCapabilities(project:EvolveProject):TargetLifecycleCapabilities {
  const adapter=getTargetAdapter(project);
  const artifact=project.targetConnection.adapter==="artifact";
  const http=project.targetConnection.adapter==="http";
  return {
    read:artifact,
    snapshot:artifact,
    mutate:artifact,
    validate:Boolean(adapter.run),
    deploy:http && Boolean(adapter.release),
    observe:http && Boolean(adapter.release),
    rollback:artifact || (http && Boolean(adapter.release)),
  };
}

export function validateThroughLifecycle(adapter:TargetLifecycleAdapter|TargetAdapter,args:{project:EvolveProject;testCase:TestCase;variant?:TargetVariant}) {
  return "validate" in adapter && adapter.validate ? adapter.validate(args) : adapter.run(args);
}
