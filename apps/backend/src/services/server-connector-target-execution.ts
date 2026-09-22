import {createHash} from "node:crypto";
import {
  type Candidate,
  type ConnectorActionRequest,
  type ConnectorActionResponse,
  type EvolveProject,
  type TargetRunResult,
  type TestCase,
} from "@evolution/contracts";
import {trustedServerBaselineChampion} from "@evolution/harness";
import {assertConnectorCandidateIsolation,executeConnectorAction} from "./connector-registry";
import {serverConnectorTargetEnabled} from "./connector-target-source";

type ConnectorExecutor=(input:ConnectorActionRequest)=>Promise<ConnectorActionResponse>;
type IsolationAssert=(connectorId:string)=>unknown;

function unavailable(testCase:TestCase,detail:string):TargetRunResult{
  return{
    testCaseId:testCase.id,
    output:`UNVERIFIED：${detail}`,
    latencyMs:0,
    cost:0,
    verificationStatus:"unverified",
    trace:[{
      id:`connector-unverified-${testCase.id}`,
      stage:"connector-validate",
      summary:"Connector 未返回可验证执行证据",
      status:"warning",
      detail,
    }],
  };
}

function connectorBinding(project:EvolveProject){
  if(!serverConnectorTargetEnabled(project))return undefined;
  const binding=project.targetConnection.connector;
  const snapshot=project.targetConnection.connectorSnapshot;
  if(!binding||!snapshot)return undefined;
  if(binding.connectorId!==snapshot.connectorId||binding.targetId!==snapshot.targetId){
    throw new Error("Connector target binding does not match locked snapshot");
  }
  return {binding,snapshot};
}

function currentBaseVersion(project:EvolveProject){
  const target=connectorBinding(project);
  if(!target)throw new Error("Connector Target exact snapshot is not available");
  const champion=trustedServerBaselineChampion(project)?.connectorBinding;
  if(champion){
    if(champion.connectorId!==target.binding.connectorId||champion.targetId!==target.binding.targetId){
      throw new Error("Search Champion Connector binding does not match current Target");
    }
    return champion.versionRef;
  }
  return target.snapshot.versionRef;
}

function targetSnapshots(project:EvolveProject,candidate:Candidate){
  const ids=new Set(project.sourceArtifacts.filter((artifact)=>artifact.role==="target").map((artifact)=>artifact.id));
  const snapshots=candidate.artifactSnapshots.filter((snapshot)=>ids.has(snapshot.sourceArtifactId));
  if(ids.size!==1||snapshots.length!==1){
    throw new Error("Connector Target requires exactly one primary Target Artifact snapshot");
  }
  return snapshots;
}

export function connectorCandidateArtifactFingerprint(project:EvolveProject,candidate:Candidate){
  const snapshots=targetSnapshots(project,candidate);
  return createHash("sha256")
    .update(snapshots
      .map((snapshot)=>[snapshot.sourceArtifactId,snapshot.contentHash??"",snapshot.content].join("|"))
      .sort()
      .join("\n"))
    .digest("hex");
}

export async function stageServerConnectorCandidate(
  project:EvolveProject,
  candidate:Candidate,
  execute:ConnectorExecutor=executeConnectorAction,
  assertIsolation:IsolationAssert=assertConnectorCandidateIsolation,
){
  const target=connectorBinding(project);
  if(!target)return candidate;
  assertIsolation(target.binding.connectorId);
  const fingerprint=connectorCandidateArtifactFingerprint(project,candidate);
  if(candidate.connectorBinding
    &&candidate.connectorBinding.connectorId===target.binding.connectorId
    &&candidate.connectorBinding.targetId===target.binding.targetId
    &&candidate.connectorBinding.artifactFingerprint===fingerprint){
    return candidate;
  }
  const baseVersionRef=currentBaseVersion(project);
  const snapshots=targetSnapshots(project,candidate);
  const idempotencyKey="connector-mutate-"+createHash("sha256")
    .update([project.id,candidate.id,baseVersionRef,fingerprint].join("|"))
    .digest("hex")
    .slice(0,32);
  const mutation=await execute({
    connectorId:target.binding.connectorId,
    operation:"mutate",
    missionId:project.id,
    targetId:target.binding.targetId,
    expectedVersionRef:baseVersionRef,
    idempotencyKey,
    payload:{
      candidateId:candidate.id,
      candidateName:candidate.name,
      artifactFingerprint:fingerprint,
      artifacts:snapshots.map((snapshot)=>({
        sourceArtifactId:snapshot.sourceArtifactId,
        name:snapshot.name,
        mimeType:snapshot.mimeType,
        content:snapshot.content,
        contentHash:snapshot.contentHash,
      })),
    },
  });
  if(!mutation.ok)throw new Error("Connector Candidate mutate did not succeed");
  if(!mutation.versionRef)throw new Error("Connector Candidate mutate must return exact versionRef");
  return{
    ...candidate,
    connectorBinding:{
      connectorId:target.binding.connectorId,
      targetId:target.binding.targetId,
      baseVersionRef,
      versionRef:mutation.versionRef,
      artifactFingerprint:fingerprint,
      snapshotRef:mutation.snapshotRef,
      evidenceRefs:mutation.evidenceRefs,
      observedAt:mutation.observedAt,
    },
  };
}

function outputText(value:unknown){
  if(typeof value==="string")return value;
  try{return JSON.stringify(value??null);}
  catch{return String(value);}
}

function normalizeValidationRuns(
  response:ConnectorActionResponse,
  testCases:TestCase[],
  expectedVersionRef:string,
){
  if(response.versionRef&&response.versionRef!==expectedVersionRef){
    throw new Error(`Connector validate version drifted: ${response.versionRef} != expected ${expectedVersionRef}`);
  }
  const rawRuns=response.output&&Array.isArray(response.output.runs)
    ?response.output.runs
    :[];
  const byId=new Map<string,Record<string,unknown>>();
  for(const item of rawRuns){
    if(!item||typeof item!=="object")continue;
    const id=(item as Record<string,unknown>).testCaseId;
    if(typeof id==="string")byId.set(id,item as Record<string,unknown>);
  }
  return testCases.map((testCase):TargetRunResult=>{
    if(!response.ok)return unavailable(testCase,response.note||"Connector validate returned ok=false");
    const raw=byId.get(testCase.id);
    if(!raw)return unavailable(testCase,`Connector validate 没有返回 TestCase ${testCase.id} 的结果。`);
    const status=["verified","partial","unverified","failed"].includes(String(raw.verificationStatus))
      ?raw.verificationStatus as TargetRunResult["verificationStatus"]
      :"partial";
    const latency=typeof raw.latencyMs==="number"&&Number.isFinite(raw.latencyMs)?Math.max(0,raw.latencyMs):0;
    const cost=typeof raw.cost==="number"&&Number.isFinite(raw.cost)?Math.max(0,raw.cost):0;
    return{
      testCaseId:testCase.id,
      output:outputText(raw.output),
      latencyMs:latency,
      cost,
      verificationStatus:status,
      artifactHash:typeof raw.artifactHash==="string"?raw.artifactHash:undefined,
      trace:[{
        id:`connector-validate-${testCase.id}-${response.observedAt}`,
        stage:"connector-validate",
        summary:`Connector 在 exact version ${expectedVersionRef} 上执行 TestCase`,
        status:status==="failed"?"fail":status==="unverified"?"warning":"pass",
        detail:[
          response.note,
          response.evidenceRefs.length?`evidenceRefs=${response.evidenceRefs.join(",")}`:"",
        ].filter(Boolean).join(" · "),
      }],
    };
  });
}

export async function runServerConnectorTargetBatch(
  project:EvolveProject,
  testCases:TestCase[],
  candidate?:Candidate,
  execute:ConnectorExecutor=executeConnectorAction,
){
  const target=connectorBinding(project);
  if(!target)return testCases.map((testCase)=>unavailable(testCase,"Mission 未连接 Connector Target exact snapshot。"));
  let versionRef=target.snapshot.versionRef;
  let snapshotRef=target.snapshot.snapshotRef;
  let artifactFingerprint:string|undefined;
  if(candidate){
    const binding=candidate.connectorBinding;
    if(!binding
      ||binding.connectorId!==target.binding.connectorId
      ||binding.targetId!==target.binding.targetId){
      return testCases.map((testCase)=>unavailable(testCase,"Candidate 尚未绑定 Connector staged version。"));
    }
    const currentFingerprint=connectorCandidateArtifactFingerprint(project,candidate);
    if(currentFingerprint!==binding.artifactFingerprint){
      return testCases.map((testCase)=>unavailable(testCase,"Candidate Connector binding 与当前 Artifact Fingerprint 不一致。"));
    }
    versionRef=binding.versionRef;
    snapshotRef=binding.snapshotRef;
    artifactFingerprint=binding.artifactFingerprint;
  }
  const response=await execute({
    connectorId:target.binding.connectorId,
    operation:"validate",
    missionId:project.id,
    targetId:target.binding.targetId,
    expectedVersionRef:versionRef,
    payload:{
      candidateId:candidate?.id,
      snapshotRef,
      artifactFingerprint,
      testCases:testCases.map((testCase)=>({
        id:testCase.id,
        title:testCase.title,
        input:testCase.input,
        expected:testCase.expected,
        tags:testCase.tags,
        criterionIds:testCase.criterionIds,
        executionMode:testCase.executionMode,
        evidenceScope:testCase.evidenceScope,
        browserSteps:testCase.browserSteps,
      })),
    },
  });
  return normalizeValidationRuns(response,testCases,versionRef);
}
