import type {ConnectorPublicManifest,EvolveProject,SourceArtifact} from "@evolution/contracts";
import {resetDownstream} from "@evolution/core";

const CONNECTOR_EXPERIMENT_OPERATIONS=["read","snapshot","mutate","validate"] as const;
const CONNECTOR_FULL_LIFECYCLE_OPERATIONS=[
  "read","snapshot","mutate","validate","deploy","observe","rollback",
] as const;

function hasConnectorSnapshot(artifact:SourceArtifact){
  const structured=artifact.structuredContent;
  return Boolean(
    structured
    &&typeof structured==="object"
    &&!Array.isArray(structured)
    &&"connectorSnapshot" in structured
  );
}

export function connectorSupportsExperiment(manifest:ConnectorPublicManifest){
  return manifest.credentialConfigured
    &&manifest.mutationMode==="staged-version"
    &&CONNECTOR_EXPERIMENT_OPERATIONS.every((operation)=>manifest.lifecycle[operation]);
}

export function connectorSupportsFullLifecycle(manifest:ConnectorPublicManifest){
  return manifest.credentialConfigured
    &&manifest.mutationMode==="staged-version"
    &&CONNECTOR_FULL_LIFECYCLE_OPERATIONS.every((operation)=>manifest.lifecycle[operation]);
}

function connectorReleaseTarget(manifest:ConnectorPublicManifest):NonNullable<EvolveProject["releaseTarget"]>{
  return{
    provider:"connector",
    mode:"preview-promote",
    status:"connected",
    label:`${manifest.label} · Connector Release`,
    healthPath:"/",
  };
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

export function bindConnectorTarget(args:{
  project:EvolveProject;
  manifest:ConnectorPublicManifest;
  targetId:string;
  useForRelease:boolean;
  now?:string;
}):EvolveProject{
  const targetId=args.targetId.trim();
  if(!targetId)throw new Error("Connector Target ID 不能为空");
  if(!connectorSupportsExperiment(args.manifest)){
    throw new Error("该 Connector 尚未具备 staged-version Candidate isolation + Read / Snapshot / Mutate / Validate 实验闭环");
  }
  if(args.useForRelease&&!connectorSupportsFullLifecycle(args.manifest)){
    throw new Error("该 Connector 尚未具备 Deploy / Observe / Rollback，不能作为生产 Release Target");
  }
  const sourceArtifacts=args.project.sourceArtifacts.flatMap((artifact):SourceArtifact[]=>{
    if(hasConnectorSnapshot(artifact))return[];
    if(artifact.role==="target")return[{...artifact,role:"reference"}];
    return[artifact];
  });
  const releaseTarget=args.useForRelease
    ?connectorReleaseTarget(args.manifest)
    :args.project.releaseTarget?.provider==="connector"
      ?emptyReleaseTarget()
      :args.project.releaseTarget;
  const next=resetDownstream({
    ...args.project,
    sourceArtifacts,
    targetConnection:{
      adapter:"connector",
      connectionId:`connector-${args.manifest.id}`,
      status:"connected",
      label:`${args.manifest.label} · ${targetId}`,
      connector:{connectorId:args.manifest.id,targetId},
    },
    releaseTarget,
    artifactGraph:undefined,
    semanticEvolution:undefined,
    updatedAt:args.now??new Date().toISOString(),
  },{invalidateUnderstanding:true});
  return{
    ...next,
    updatedAt:args.now??next.updatedAt,
  };
}

export function disconnectConnectorTarget(project:EvolveProject,now?:string):EvolveProject{
  const sourceArtifacts=project.sourceArtifacts.filter((artifact)=>!hasConnectorSnapshot(artifact));
  const next=resetDownstream({
    ...project,
    sourceArtifacts,
    targetConnection:{
      adapter:"artifact",
      connectionId:"local-artifact-runtime",
      status:"connected",
      label:"AI Artifact Runtime",
    },
    releaseTarget:project.releaseTarget?.provider==="connector"?emptyReleaseTarget():project.releaseTarget,
    artifactGraph:undefined,
    semanticEvolution:undefined,
    updatedAt:now??new Date().toISOString(),
  },{invalidateUnderstanding:true});
  return{
    ...next,
    updatedAt:now??next.updatedAt,
  };
}
