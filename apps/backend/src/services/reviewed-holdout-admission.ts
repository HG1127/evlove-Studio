import {ReviewedHoldoutPreviewSchema,type EvolveProject,type ReviewedHoldoutPreview} from "@evolution/contracts";
import {reviewedHoldoutBoundary} from "@evolution/harness";
import {getServerMissionEnvelope} from "./production-runtime";
import {readServerHoldoutArtifactFingerprint} from "./server-holdout-artifact-binding";
import {getServerArtifactStore} from "./artifact-runtime";
import {serverArtifactSha256} from "./server-experiment-artifacts";
import {serverAiScoringRouteFingerprint} from "./ai-gateway";
import {reviewedBinding,reviewedSha} from "./reviewed-holdout-identity";

export async function previewReviewedHoldout(project:EvolveProject):Promise<ReviewedHoldoutPreview>{
  const boundary=reviewedHoldoutBoundary(project);
  if(boundary)throw new Error("人工复核续接不可用："+boundary);
  const candidate=project.candidates.find(c=>c.id===project.experimentRun.winnerId)!;
  const route=await serverAiScoringRouteFingerprint();
  const physical=await readServerHoldoutArtifactFingerprint({project,candidate});
  const source=project.sourceArtifacts[0]!;
  const original=await getServerArtifactStore().get(source.storageRef?.trim()||source.id);
  if(!route||!physical||!original||original.size!==source.size)throw new Error("无法核验实际原文件、冻结文件或模型连接身份。");
  const originalSha=await serverArtifactSha256(await original.arrayBuffer());
  if(originalSha===candidate.artifactSnapshots[0]!.frozenArtifact!.sha256)throw new Error("Candidate 必须有实际文件改动。");
  // Independent read after physical/model awaits; do not refresh the writer's CAS revision.
  const current=(await getServerMissionEnvelope(project.id))?.payload;
  if(!current||reviewedSha(current)!==reviewedSha(project)||await serverAiScoringRouteFingerprint()!==route)
    throw new Error("核验期间 Mission 或模型连接已变化，请重新复核。");
  return ReviewedHoldoutPreviewSchema.parse({
    binding:reviewedBinding(project,physical,originalSha,route),reviewNotes:project.baselineRun.result!.notes,
    preservationNotice:"REVIEW 保留；仅同一冻结文件的隔离隐藏验证；验收标准、保护要求和 Gate F 不豁免。",
  });
}
