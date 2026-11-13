import {createHash} from "node:crypto";
import type {EvolveProject,SourceArtifact} from "@evolution/contracts";
import {getServerArtifactStore} from "./artifact-runtime";

const syntheticMissionId="lab-synthetic-html-task-filter-p3x-v1";
const approvedSourceId="source-task-board";
const approvedSourceSha256="192abea39d167d9c0f4310fc603905905de5fa44106685fc7d6ea3d2931da8dc";
const approvedSourceBytes=2067;
const approvedEvaluationSha256="113111c80af41de9a10bec92c87d901d755c1810a4da5a5c817dc64b113e9eb6";
const approvedScopeSha256="dc8c82974a096d79df20efb8172acd5b99c3bfa320385e4b4d9aa56672d46298";
const sha256=(value:string|Uint8Array)=>createHash("sha256").update(value).digest("hex");
const syntheticEvaluationSha256=(project:EvolveProject)=>sha256(JSON.stringify([
  project.goal,project.evolutionCommand,project.acceptanceRubric,
  project.evalSuite,project.hiddenEvalSuite,project.finalHoldout,
]));
const syntheticScopeSha256=(project:EvolveProject)=>sha256(JSON.stringify([
  project.protectedItems,project.editableItems,project.metrics,
  project.targetConnection.adapter,project.objectType,
]));
const frozenSyntheticScope=(project:EvolveProject)=>project.sourceArtifacts.length===1
  &&syntheticScopeSha256(project)===approvedScopeSha256
  &&project.campaign.stopCriteria.maxRounds===1&&project.campaign.candidateCount===1
  &&project.campaign.schedule.enabled===false;
const syntheticLab=(missionId:string)=>process.env.EVOLUTION_EXPERIMENT_MODE==="isolated"&&missionId===syntheticMissionId;
const fail=()=>{throw Error("Synthetic Lab Original custody or frozen source identity is unverified");};

/**
 * Exact physical source custody is required for ALL isolated Lab HTML Sandbox
 * runs. A pasted index or a Source storageRef alone is not an execution receipt.
 */
export async function readLabHtmlOriginal(project:EvolveProject,source:SourceArtifact):Promise<Uint8Array|undefined>{
  if(process.env.EVOLUTION_EXPERIMENT_MODE!=="isolated")return undefined;
  if(syntheticLab(project.id)&&(!frozenSyntheticScope(project)
    ||syntheticEvaluationSha256(project)!==approvedEvaluationSha256
    ||source.id!==approvedSourceId||source.size!==approvedSourceBytes
    ||source.mutationGovernance?.parentSha256!==approvedSourceSha256))return fail();
  const blobId=source.storageRef?.trim(),expected=source.mutationGovernance?.parentSha256;
  const store=getServerArtifactStore();
  if(!blobId||!expected||!store.getMetadata)return fail();
  const [blob,metadata]=await Promise.all([store.get(blobId),store.getMetadata(blobId)]);
  if(!blob||!metadata||metadata.id!==blobId||metadata.missionId!==project.id
    ||metadata.kind!=="source"||metadata.mimeType!==source.mimeType||!blob.size
    ||blob.size>12_000_000||blob.size!==source.size||metadata.sizeBytes!==blob.size)return fail();
  const bytes=new Uint8Array(await blob.arrayBuffer()),actual=sha256(bytes);
  if(bytes.byteLength!==blob.size||actual!==metadata.sha256||actual!==expected)return fail();
  if(source.inputMode==="paste"&&source.textContent!==undefined&&sha256(source.textContent)!==actual)return fail();
  return bytes;
}

/** Initial synthetic Mission registration must precede the FK-bound source blob. */
export function assertLabSyntheticInitialSource(project:EvolveProject){
  if(!syntheticLab(project.id))return;
  const sources=project.sourceArtifacts.filter(source=>source.role==="target");
  const source=sources.length===1?sources[0]:undefined;
  if(!source||!frozenSyntheticScope(project)||source.id!==approvedSourceId||source.extension.toLowerCase()!=="html"
    ||source.inputMode!=="paste"||source.storageRef||source.textContent===undefined
    ||source.size!==approvedSourceBytes||Buffer.byteLength(source.textContent)!==source.size
    ||sha256(source.textContent)!==approvedSourceSha256
    ||source.mutationGovernance?.parentSha256!==approvedSourceSha256
    ||syntheticEvaluationSha256(project)!==approvedEvaluationSha256)return fail();
}

/**
 * Only an already registered, byte-verified source may be bound through the
 * ordinary Mission CAS PUT. After binding, the original cannot be silently
 * removed, replaced, or re-described by a generic user update.
 */
export async function assertLabSyntheticSourceMutation(current:EvolveProject,next:EvolveProject){
  if(!syntheticLab(next.id))return;
  if(current.id!==next.id)return fail();
  const originalTargets=current.sourceArtifacts.filter(s=>s.role==="target");
  const nextTargets=next.sourceArtifacts.filter(s=>s.role==="target");
  if(originalTargets.length!==1||nextTargets.length!==1
    ||!frozenSyntheticScope(current)||!frozenSyntheticScope(next))return fail();
  const original=originalTargets[0]!,source=nextTargets[0]!;
  const identity=(s:SourceArtifact)=>JSON.stringify([
    s.id,s.name,s.role,s.artifactKind,s.mimeType,s.extension,s.size,s.inputMode,
    s.textContent,s.structuredContent,s.mutationGovernance,
  ]);
  if(identity(original)!==identity(source)
    ||original.storageRef&&original.storageRef!==source.storageRef
    ||source.id!==approvedSourceId||source.size!==approvedSourceBytes
    ||source.mutationGovernance?.parentSha256!==approvedSourceSha256
    ||syntheticEvaluationSha256(current)!==approvedEvaluationSha256
    ||syntheticEvaluationSha256(next)!==approvedEvaluationSha256)return fail();
  // An unbound, unchanged draft may be edited before an operator imports bytes.
  if(!source.storageRef)return;
  if(!await readLabHtmlOriginal(next,source))return fail();
}
