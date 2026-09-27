import {createHash} from "node:crypto";
import {z} from "zod";
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

const ConnectorValidationRunSchema=z.object({
  testCaseId:z.string().min(1),
  output:z.unknown().optional(),
  latencyMs:z.number().finite().nonnegative().optional(),
  cost:z.number().finite().nonnegative().optional(),
  verificationStatus:z.enum(["verified","partial","unverified","failed"]),
  artifactHash:z.string().min(1).optional(),
});

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
  const targets=project.sourceArtifacts.filter((artifact)=>artifact.role==="target");
  if(targets.length!==1||targets[0]!.id!==snapshot.artifactId){
    throw new Error("Connector locked snapshot Artifact ID does not match the single primary Target");
  }
  return {binding,snapshot};
}

function currentBaseBinding(project:EvolveProject){
  const target=connectorBinding(project);
  if(!target)throw new Error("Connector Target exact snapshot is not available");
  if(!project.searchChampion)return{
    versionRef:target.snapshot.versionRef,
    snapshotRef:target.snapshot.snapshotRef,
    artifactFingerprint:undefined as string|undefined,
    candidateId:undefined as string|undefined,
  };
  const champion=trustedServerBaselineChampion(project);
  if(!champion)throw new Error("Search Champion lacks completed validation and exact Artifact acceptance");
  const binding=champion.connectorBinding;
  if(!binding)throw new Error("Search Champion has no exact Connector staged version binding");
  if(binding.connectorId!==target.binding.connectorId||binding.targetId!==target.binding.targetId){
    throw new Error("Search Champion Connector binding does not match current Target");
  }
  const fingerprint=connectorCandidateArtifactFingerprint(project,champion);
  if(fingerprint!==binding.artifactFingerprint){
    throw new Error("Search Champion Connector binding does not match current Artifact Fingerprint");
  }
  if(!binding.versionRef)throw new Error("Search Champion Connector versionRef is missing");
  return{
    versionRef:binding.versionRef,
    snapshotRef:binding.snapshotRef,
    artifactFingerprint:fingerprint,
    candidateId:champion.id,
  };
}

function targetSnapshots(project:EvolveProject,candidate:Candidate){
  const targets=project.sourceArtifacts.filter((artifact)=>artifact.role==="target");
  const ids=new Set(targets.map((artifact)=>artifact.id));
  const snapshots=candidate.artifactSnapshots.filter((snapshot)=>ids.has(snapshot.sourceArtifactId));
  if(targets.length!==1||ids.size!==1||snapshots.length!==1){
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
  const baseVersionRef=currentBaseBinding(project).versionRef;
  if(candidate.connectorBinding
    &&candidate.connectorBinding.connectorId===target.binding.connectorId
    &&candidate.connectorBinding.targetId===target.binding.targetId
    &&candidate.connectorBinding.baseVersionRef===baseVersionRef
    &&candidate.connectorBinding.artifactFingerprint===fingerprint){
    return candidate;
  }
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
  if(mutation.versionRef===baseVersionRef){
    throw new Error(
      `Connector staged-version mutate must return a new versionRef; received base version ${baseVersionRef}`,
    );
  }
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
  if(!response.ok)return testCases.map((testCase)=>unavailable(testCase,response.note||"Connector validate returned ok=false"));
  if(response.versionRef!==expectedVersionRef){
    throw new Error(`Connector validate version drifted: ${response.versionRef??"missing"} != expected ${expectedVersionRef}`);
  }
  const rawRuns=response.output&&Array.isArray(response.output.runs)
    ?response.output.runs
    :[];
  const byId=new Map<string,{count:number;first:unknown}>();
  for(const item of rawRuns){
    if(!item||typeof item!=="object")continue;
    const id=(item as Record<string,unknown>).testCaseId;
    if(typeof id==="string"){
      const previous=byId.get(id);
      byId.set(id,previous?{count:previous.count+1,first:previous.first}:{count:1,first:item});
    }
  }
  return testCases.map((testCase):TargetRunResult=>{
    const entry=byId.get(testCase.id);
    if(entry?.count!==1)return unavailable(testCase,entry
      ?`Connector validate 对 TestCase ${testCase.id} 返回了重复结果。`
      :`Connector validate 没有返回 TestCase ${testCase.id} 的结果。`);
    const parsed=ConnectorValidationRunSchema.safeParse(entry.first);
    if(!parsed.success)return unavailable(testCase,`Connector validate 对 TestCase ${testCase.id} 缺少有效的验证状态或结果字段。`);
    const raw=parsed.data;
    const status=raw.verificationStatus;
    return{
      testCaseId:testCase.id,
      output:outputText(raw.output),
      latencyMs:raw.latencyMs??0,
      cost:raw.cost??0,
      verificationStatus:status,
      artifactHash:raw.artifactHash,
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
  let versionRef:string;
  let snapshotRef:string|undefined;
  let artifactFingerprint:string|undefined;
  let currentCandidateId:string|undefined;
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
    currentCandidateId=candidate.id;
  }else{
    try{
      const current=currentBaseBinding(project);
      versionRef=current.versionRef;
      snapshotRef=current.snapshotRef;
      artifactFingerprint=current.artifactFingerprint;
      currentCandidateId=current.candidateId;
    }catch(error){
      const message=error instanceof Error?error.message:String(error);
      return testCases.map((testCase)=>unavailable(testCase,message));
    }
  }
  const response=await execute({
    connectorId:target.binding.connectorId,
    operation:"validate",
    missionId:project.id,
    targetId:target.binding.targetId,
    expectedVersionRef:versionRef,
    payload:{
      candidateId:currentCandidateId,
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
