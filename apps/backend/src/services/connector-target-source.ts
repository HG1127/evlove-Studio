import {createHash} from "node:crypto";
import {
  SourceArtifactSchema,
  type ArtifactStorePort,
  type ConnectorActionRequest,
  type ConnectorActionResponse,
  type EvolveProject,
} from "@evolution/contracts";
import {getServerArtifactStore} from "./artifact-runtime";
import {executeConnectorAction,getServerConnectorManifests} from "./connector-registry";
import {parseServerSource} from "./server-source-parser";

const MAX_CONNECTOR_SOURCE_JSON_BYTES=5*1024*1024;

type ConnectorExecutor=(input:ConnectorActionRequest)=>Promise<ConnectorActionResponse>;
type MaterializePorts={
  execute:ConnectorExecutor;
  artifacts:ArtifactStorePort;
  parse:typeof parseServerSource;
};

function canonicalJson(value:unknown):unknown{
  if(Array.isArray(value))return value.map(canonicalJson);
  if(value&&typeof value==="object"){
    return Object.fromEntries(
      Object.entries(value as Record<string,unknown>)
        .sort(([left],[right])=>left.localeCompare(right))
        .map(([key,item])=>[key,canonicalJson(item)]),
    );
  }
  return value;
}

function safeSlug(value:string){
  return value.replace(/[^A-Za-z0-9._-]+/g,"-").replace(/^-+|-+$/g,"").slice(0,80)||"target";
}

function sourceName(targetType:string,targetId:string,versionRef:string){
  const prefix=targetType==="workflow"?"workflow":targetType==="memory"?"knowledge-memory":targetType;
  return `${prefix}-${safeSlug(targetId)}-${safeSlug(versionRef).slice(0,24)}.json`;
}

export function connectorSnapshotArtifactId(connectorId:string,targetId:string,versionRef:string,snapshotRef?:string){
  const digest=createHash("sha256")
    .update([connectorId,targetId,versionRef,snapshotRef??""].join("|"))
    .digest("hex")
    .slice(0,24);
  return "connector-source-"+digest;
}

export function serverConnectorTargetEnabled(project:EvolveProject){
  return project.targetConnection.adapter==="connector"
    &&project.targetConnection.status==="connected"
    &&Boolean(project.targetConnection.connector);
}

export async function lockConnectorTargetSnapshot(
  project:EvolveProject,
  execute:ConnectorExecutor=executeConnectorAction,
){
  if(!serverConnectorTargetEnabled(project))return project;
  if(project.sourceArtifacts.some((artifact)=>artifact.role==="target"))return project;
  if(project.targetConnection.connectorSnapshot)return project;
  const binding=project.targetConnection.connector;
  if(!binding)throw new Error("Connector Target 缺少 connectorId/targetId binding");
  const snapshot=await execute({
    connectorId:binding.connectorId,
    operation:"snapshot",
    missionId:project.id,
    targetId:binding.targetId,
    payload:{},
  });
  if(!snapshot.ok)throw new Error("Connector snapshot 未成功");
  if(!snapshot.versionRef)throw new Error("Connector snapshot 必须返回 exact versionRef");
  return{
    ...project,
    targetConnection:{
      ...project.targetConnection,
      connectorSnapshot:{
        connectorId:binding.connectorId,
        targetId:binding.targetId,
        versionRef:snapshot.versionRef,
        snapshotRef:snapshot.snapshotRef,
        artifactId:connectorSnapshotArtifactId(binding.connectorId,binding.targetId,snapshot.versionRef,snapshot.snapshotRef),
        observedAt:snapshot.observedAt,
      },
    },
    updatedAt:snapshot.observedAt,
  };
}

function assertNoDerivedTargetState(project:EvolveProject){
  const dirty=project.baselineRun.status!=="idle"
    ||project.experimentRun.status!=="idle"
    ||project.validationRun.status!=="idle"
    ||project.candidates.length>0
    ||Boolean(project.searchChampion)
    ||project.artifactAcceptance.status!=="idle"
    ||project.campaign.currentRound>0
    ||project.outputArtifacts.length>0
    ||project.release.status!=="idle"
    ||project.lessons.length>0
    ||project.roundHistory.length>0;
  if(dirty){
    throw new Error("Connector Target 尚未物化 Source，但 Mission 已存在派生实验状态；禁止把新的远端 Snapshot 静默混入旧证据。");
  }
}

function targetType(connectorId:string){
  const manifest=getServerConnectorManifests().find((item)=>item.id===connectorId);
  if(!manifest)throw new Error(`Connector ${connectorId} is not registered on server`);
  return manifest.targetType;
}

export async function materializeLockedConnectorTargetSource(
  project:EvolveProject,
  ports:MaterializePorts={
    execute:executeConnectorAction,
    artifacts:getServerArtifactStore(),
    parse:parseServerSource,
  },
){
  if(!serverConnectorTargetEnabled(project))return project;
  if(project.sourceArtifacts.some((artifact)=>artifact.role==="target"))return project;
  assertNoDerivedTargetState(project);
  const binding=project.targetConnection.connector;
  const snapshot=project.targetConnection.connectorSnapshot;
  if(!binding)throw new Error("Connector Target 缺少 connector binding");
  if(!snapshot)throw new Error("Connector Target 必须先锁定 exact snapshot");

  let blob=await ports.artifacts.get(snapshot.artifactId).catch(()=>undefined);
  if(!blob){
    const read=await ports.execute({
      connectorId:binding.connectorId,
      operation:"read",
      missionId:project.id,
      targetId:binding.targetId,
      expectedVersionRef:snapshot.versionRef,
      payload:{snapshotRef:snapshot.snapshotRef},
    });
    if(!read.ok)throw new Error("Connector read 未成功");
    if(read.versionRef&&read.versionRef!==snapshot.versionRef){
      throw new Error(`Connector read version drifted: ${read.versionRef} != locked ${snapshot.versionRef}`);
    }
    if(!read.output)throw new Error("Connector read 必须返回 output 才能物化为 SourceArtifact");
    const content=JSON.stringify(canonicalJson(read.output),null,2);
    const bytes=new TextEncoder().encode(content);
    if(bytes.byteLength>MAX_CONNECTOR_SOURCE_JSON_BYTES){
      throw new Error("Connector snapshot output exceeds the 5MB source materialization limit");
    }
    blob=new Blob([Uint8Array.from(bytes).buffer],{type:"application/json"});
    await ports.artifacts.put(snapshot.artifactId,blob);
  }

  const kind=targetType(binding.connectorId);
  const parsed=await ports.parse({
    artifactId:snapshot.artifactId,
    name:sourceName(kind,binding.targetId,snapshot.versionRef),
    mimeType:"application/json",
    size:blob.size,
    role:"target",
    blob,
    storageRef:snapshot.artifactId,
  });
  const structured=parsed.structuredContent&&typeof parsed.structuredContent==="object"&&!Array.isArray(parsed.structuredContent)
    ?parsed.structuredContent as Record<string,unknown>
    :{};
  const source=SourceArtifactSchema.parse({
    ...parsed,
    inputMode:"remote",
    createdAt:snapshot.observedAt,
    structuredContent:{
      ...structured,
      connectorSnapshot:{
        connectorId:binding.connectorId,
        targetId:binding.targetId,
        targetType:kind,
        versionRef:snapshot.versionRef,
        snapshotRef:snapshot.snapshotRef,
      },
    },
    warnings:[
      ...parsed.warnings,
      `Connector Source 已锁定 ${binding.connectorId}/${binding.targetId}@${snapshot.versionRef}；后续实验不会静默跟随远端新版本。`,
    ],
  });
  return{
    ...project,
    sourceArtifacts:[...project.sourceArtifacts,source],
    artifactGraph:undefined,
    semanticEvolution:undefined,
    sourceUnderstanding:undefined,
    inputUnderstanding:undefined,
    inputClarifications:[],
    acceptanceRubric:[],
    acceptanceRubricState:{
      ...project.acceptanceRubricState,
      status:"idle" as const,
      summary:"Connector exact snapshot 已物化，需要重新编译 Project-specific Acceptance Rubric",
      version:project.acceptanceRubricState.version+1,
      weightTotal:0,
      uncoveredCriterionIds:[],
      warnings:[],
    },
    evalSuite:[],
    hiddenEvalSuite:[],
    gates:project.gates.map((gate)=>gate.id==="target-ready"
      ?{
        ...gate,
        status:"ready" as const,
        approvedAt:undefined,
        note:"Connector exact snapshot 已物化为新的进化输入，需要基于该版本重新确认 Target Ready。",
      }
      :{...gate,status:"pending" as const,approvedAt:undefined,note:undefined}),
    updatedAt:snapshot.observedAt,
  };
}
