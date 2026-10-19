import {createHash} from "node:crypto";
import {htmlProtectionCanonicalJson as canonical} from "./server-html-protection-authority-attestation";
import {
  ConnectorReleaseReceiptSchema,
  type Candidate,
  type ConnectorActionRequest,
  type ConnectorActionResponse,
  type ConnectorReleaseReceipt,
  type EvolveProject,
  type ReleaseAdapterResult,
} from "@evolution/contracts";
import {
  currentReleaseCandidate,
  expectedReleaseArtifactHashes,
  projectUsesConnectorRelease,
  type DurableReleaseAction,
} from "@evolution/core";
import {assertConnectorCandidateIsolation,executeConnectorAction} from "./connector-registry";

type ConnectorExecutor=(input:ConnectorActionRequest,beforeDispatch?:()=>Promise<()=>void>)=>Promise<ConnectorActionResponse>;
type IsolationAssert=(connectorId:string)=>unknown;

function trafficPercent(action:DurableReleaseAction){
  if(action==="canary-5")return 5;
  if(action==="canary-20")return 20;
  if(action==="canary-50")return 50;
  if(action==="promote")return 100;
  return 0;
}

function assertReceiptSemantics(project:EvolveProject,receipt:ConnectorReleaseReceipt){
  const expectedTraffic=trafficPercent(receipt.effectiveAction);
  if(receipt.trafficPercent!==expectedTraffic){
    throw new Error(
      `Connector ${receipt.effectiveAction} receipt trafficPercent ${receipt.trafficPercent} != expected ${expectedTraffic}`,
    );
  }
  if(project.releaseTarget?.mode==="preview-promote"
    &&["canary-5","canary-20","canary-50"].includes(receipt.effectiveAction)){
    throw new Error(
      `Connector preview-promote target cannot report ${receipt.effectiveAction} progressive traffic`,
    );
  }
  if(receipt.observationStatus==="healthy"&&!receipt.healthy){
    throw new Error("Connector receipt is contradictory: observationStatus=healthy but healthy=false");
  }
  if(receipt.observationStatus==="unhealthy"&&receipt.healthy){
    throw new Error("Connector receipt is contradictory: observationStatus=unhealthy but healthy=true");
  }
}

function rollbackCandidate(project:EvolveProject){
  const id=project.release.candidateId;if(!id)throw Error("Connector rollback stored Candidate is unavailable");
  const matches=project.candidates.filter(candidate=>candidate.id===id);if(matches.length>1)throw Error("Connector rollback stored Candidate is ambiguous");
  const champion=project.searchChampion?.candidate?.id===id?project.searchChampion.candidate:undefined;
  if(matches[0]&&champion&&canonical(matches[0])!==canonical(champion))throw Error("Connector rollback stored Candidate copies disagree");
  const candidate=matches[0]??champion;if(!candidate)throw Error("Connector rollback stored Candidate is unavailable");return candidate;
}
function releaseBinding(project:EvolveProject,action?:DurableReleaseAction){
  if(!projectUsesConnectorRelease(project))throw new Error("Mission 未连接 Connector Release Target");
  const target=project.targetConnection.connector;
  const source=project.targetConnection.connectorSnapshot;
  const candidate=action==="rollback"?rollbackCandidate(project):currentReleaseCandidate(project);
  if(!target||!source)throw new Error("Connector Release 缺少 exact Target snapshot binding");
  if(!candidate)throw new Error("Connector Release 找不到 exact Candidate");
  const binding=candidate.connectorBinding;
  if(!binding)throw new Error("Connector Release Candidate 尚未绑定 staged versionRef");
  if(binding.connectorId!==target.connectorId||binding.targetId!==target.targetId){
    throw new Error("Connector Release Candidate binding 与 Target 不一致");
  }
  if(source.connectorId!==target.connectorId||source.targetId!==target.targetId){
    throw new Error("Connector Release Source snapshot 与 Target 不一致");
  }
  return{target,source,candidate,binding};
}

function idempotencyKey(project:EvolveProject,candidate:Candidate,action:DurableReleaseAction,versionRef:string){
  return "connector-release-"+createHash("sha256")
    .update([project.id,candidate.id,action,versionRef].join("|"))
    .digest("hex")
    .slice(0,32);
}

function toReleaseResult(args:{
  project:EvolveProject;
  response:ConnectorActionResponse;
  action:DurableReleaseAction;
  observedDeploymentId?:string;
  observedStableDeploymentId?:string;
}):ReleaseAdapterResult{
  const {candidate,binding}=releaseBinding(args.project,args.action);
  const receipt=ConnectorReleaseReceiptSchema.parse(args.response.output);
  assertReceiptSemantics(args.project,receipt);
  if(receipt.effectiveAction!==args.action){
    throw new Error(`Connector effectiveAction ${receipt.effectiveAction} 与请求 ${args.action} 不一致`);
  }
  if(args.action==="rollback"){
    if(args.response.versionRef!==binding.baseVersionRef){
      throw new Error(`Connector rollback versionRef ${args.response.versionRef??"missing"} != stable ${binding.baseVersionRef}`);
    }
  }else if(args.response.versionRef!==binding.versionRef){
    throw new Error(`Connector release versionRef ${args.response.versionRef??"missing"} != Candidate ${binding.versionRef}`);
  }
  if(args.observedDeploymentId&&args.response.deploymentRef&&args.response.deploymentRef!==args.observedDeploymentId){
    throw new Error(
      `Connector observe deploymentRef ${args.response.deploymentRef} != expected ${args.observedDeploymentId}`,
    );
  }
  if(args.observedStableDeploymentId
    &&receipt.stableDeploymentRef
    &&receipt.stableDeploymentRef!==args.observedStableDeploymentId){
    throw new Error(
      `Connector observe stableDeploymentRef ${receipt.stableDeploymentRef} != expected ${args.observedStableDeploymentId}`,
    );
  }
  const deploymentId=args.response.deploymentRef
    ??args.observedDeploymentId
    ??(args.action==="rollback"
      ?receipt.stableDeploymentRef??args.project.release.stableDeploymentId??binding.baseVersionRef
      :binding.versionRef);
  if(!deploymentId)throw new Error("Connector Release receipt 缺少 deploymentRef/version identity");
  const stableDeploymentId=args.action==="rollback"
    ?deploymentId
    :receipt.stableDeploymentRef
      ??args.observedStableDeploymentId
      ??args.project.release.stableDeploymentId
      ??binding.baseVersionRef;
  return{
    ok:args.response.ok,
    trafficPercent:receipt.trafficPercent,
    note:args.response.note,
    healthy:receipt.healthy,
    kpis:[],
    evidenceMode:"live",
    effectiveAction:receipt.effectiveAction,
    observationStatus:receipt.observationStatus,
    deploymentId,
    stableDeploymentId,
    artifactHashes:args.action==="rollback"?undefined:expectedReleaseArtifactHashes(candidate),
    environment:receipt.environment,
    observedAt:args.response.observedAt,
    latencyMs:receipt.latencyMs,
    sampleSize:receipt.sampleSize,
    windowMinutes:receipt.windowMinutes,
  };
}

export async function executeConnectorReleaseAction(
  project:EvolveProject,
  args:{
    action:DurableReleaseAction;
    deploymentId?:string;
    stableDeploymentId?:string;
    artifactHashes:Array<{sourceArtifactId:string;contentHash:string}>;
  },
  execute:ConnectorExecutor=executeConnectorAction,
  assertIsolation:IsolationAssert=assertConnectorCandidateIsolation,
  beforeDispatch?:()=>Promise<()=>void>,
){
  const {target,candidate,binding}=releaseBinding(project,args.action);
  assertIsolation(target.connectorId);
  const operation=args.action==="rollback"?"rollback" as const:"deploy" as const;
  const versionRef=args.action==="rollback"?binding.baseVersionRef:binding.versionRef;
  const response=await execute({
    connectorId:target.connectorId,
    operation,
    missionId:project.id,
    targetId:target.targetId,
    expectedVersionRef:args.action==="rollback"?binding.versionRef:binding.versionRef,
    idempotencyKey:idempotencyKey(project,candidate,args.action,versionRef),
    payload:{
      releaseAction:args.action,
      trafficPercent:trafficPercent(args.action),
      candidateId:candidate.id,
      candidateVersionRef:binding.versionRef,
      stableVersionRef:binding.baseVersionRef,
      artifactFingerprint:binding.artifactFingerprint,
      artifactHashes:args.artifactHashes,
      deploymentRef:args.deploymentId,
      stableDeploymentRef:args.stableDeploymentId,
    },
  },beforeDispatch);
  return toReleaseResult({project,response,action:args.action});
}

export async function observeConnectorReleaseReality(
  project:EvolveProject,
  args:{
    recoveryAction?:DurableReleaseAction;
    deploymentId?:string;
    stableDeploymentId?:string;
  },
  execute:ConnectorExecutor=executeConnectorAction,
  assertIsolation:IsolationAssert=assertConnectorCandidateIsolation,
){
  const {target,candidate,binding}=releaseBinding(project,args.recoveryAction);
  assertIsolation(target.connectorId);
  const response=await execute({
    connectorId:target.connectorId,
    operation:"observe",
    missionId:project.id,
    targetId:target.targetId,
    payload:{
      recoveryAction:args.recoveryAction,
      candidateId:candidate.id,
      candidateVersionRef:binding.versionRef,
      stableVersionRef:binding.baseVersionRef,
      artifactFingerprint:binding.artifactFingerprint,
      deploymentRef:args.deploymentId,
      stableDeploymentRef:args.stableDeploymentId,
    },
  });
  const receipt=ConnectorReleaseReceiptSchema.parse(response.output);
  return toReleaseResult({
    project,
    response,
    action:receipt.effectiveAction,
    observedDeploymentId:args.deploymentId,
    observedStableDeploymentId:args.stableDeploymentId,
  });
}
