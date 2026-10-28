import type {EvolveProject} from "@evolution/contracts";
import {buildServerLessonContext} from "@evolution/harness";
import {serverArtifactSha256,verifyServerCandidateFrozenArtifact} from "./server-experiment-artifacts";

/** Read/verify accepted frozen bytes before constructing the bounded learning egress DTO. */
export function buildServerLessonDistillationPayload(project:EvolveProject,now=Date.now()){
  return buildServerLessonContext(project,{verifyFrozenSnapshot:verifyServerCandidateFrozenArtifact,
    fingerprintText:text=>serverArtifactSha256(new TextEncoder().encode(text))},now);
}
