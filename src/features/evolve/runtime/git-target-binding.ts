import {
  GitRepositoryBindingSchema,
  type EvolveProject,
  type GitRepositoryBinding,
  type SourceArtifact,
} from "@evolution/contracts";
import {resetDownstream} from "@evolution/core";

function hasGitSnapshot(artifact:SourceArtifact){
  const structured=artifact.structuredContent;
  return Boolean(
    structured
    &&typeof structured==="object"
    &&!Array.isArray(structured)
    &&"gitSnapshot" in structured
  );
}

function emptyReleaseTarget():NonNullable<EvolveProject["releaseTarget"]>{
  return{
    provider:"none",
    mode:"progressive",
    status:"not-configured",
    label:"未连接发布平台",
    healthPath:"/",
  };
}

export function bindGitTarget(args:{
  project:EvolveProject;
  repository:GitRepositoryBinding;
  now?:string;
}):EvolveProject{
  const repository=GitRepositoryBindingSchema.parse(args.repository);
  const sourceArtifacts=args.project.sourceArtifacts.flatMap((artifact):SourceArtifact[]=>{
    if(hasGitSnapshot(artifact))return[];
    if(artifact.role==="target")return[{...artifact,role:"reference"}];
    return[artifact];
  });
  const at=args.now??new Date().toISOString();
  const next=resetDownstream({
    ...args.project,
    sourceArtifacts,
    targetConnection:{
      adapter:"git",
      connectionId:`github-${repository.owner}-${repository.repo}`,
      status:"connected",
      label:`GitHub · ${repository.owner}/${repository.repo}`,
      git:repository,
    },
    releaseTarget:args.project.releaseTarget?.provider==="connector"
      ?emptyReleaseTarget()
      :args.project.releaseTarget,
    artifactGraph:undefined,
    semanticEvolution:undefined,
    updatedAt:at,
  },{invalidateUnderstanding:true});
  return{...next,updatedAt:at};
}

export function disconnectGitTarget(project:EvolveProject,now?:string):EvolveProject{
  const at=now??new Date().toISOString();
  const sourceArtifacts=project.sourceArtifacts.filter((artifact)=>!hasGitSnapshot(artifact));
  const next=resetDownstream({
    ...project,
    sourceArtifacts,
    targetConnection:{
      adapter:"artifact",
      connectionId:"local-artifact-runtime",
      status:"connected",
      label:"AI Artifact Runtime",
    },
    artifactGraph:undefined,
    semanticEvolution:undefined,
    updatedAt:at,
  },{invalidateUnderstanding:true});
  return{...next,updatedAt:at};
}
