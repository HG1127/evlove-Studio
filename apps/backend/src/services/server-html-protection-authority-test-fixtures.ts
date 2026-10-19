import { createHash } from "node:crypto";
import { vi } from "vitest";
import { AcceptanceCriterionSchema, CandidateSchema, EvolutionJobSchema, SourceArtifactSchema, TestCaseSchema,
  type ArtifactStorePort, type ArtifactMetadata, type TargetRunResult } from "@evolution/contracts";
import { acceptedPackageFixture } from "@evolution/testkit";
import type { ServerHtmlProtectionAuthorityPorts } from "./server-html-protection-authority";
import { ServerAiPublicSelectionSchema,serverAiPublicSelectionIdentity } from "./server-ai-public-selection";
import {serverAiPublicScoringRouteFingerprint} from "./ai-gateway";
const digest = (value: string) => createHash("sha256").update(value).digest("hex");
export function serverHtmlProtectionAuthorityTestFixture(changed = false, draft = false) {
  const now = Date.parse("2026-10-14T12:00:00Z"); vi.spyOn(Date, "now").mockReturnValue(now);
  const original = '<!doctype html><html><head><style>p{color:red}</style></head><body><article class="slide-card" id="one"><h2>Title</h2><p>Original meaning</p></article></body></html>',
    executed = changed ? original.replace("Original meaning", "Different lost meaning") : original;
  const project = structuredClone(acceptedPackageFixture().project), bytes = new Map<string, Blob>(), metadata = new Map<string, ArtifactMetadata>();
  const store: ArtifactStorePort = { put: vi.fn(async (...[id, blob, scope]: Parameters<ArtifactStorePort["put"]>) => { bytes.set(id,blob); metadata.set(id,{id,schemaVersion:"artifact-v1",...scope,
    bucket:"private",objectPath:id,mimeType:blob.type,createdAt:"2026-10-14T12:00:00Z",updatedAt:"2026-10-14T12:00:00Z",
    sha256:createHash("sha256").update(Buffer.from(await blob.arrayBuffer())).digest("hex"),sizeBytes:blob.size}); }),
    get:vi.fn(async (id: string)=>bytes.get(id)),getMetadata:vi.fn(async (id: string)=>metadata.get(id)),delete:vi.fn() };
  project.sourceArtifacts = [SourceArtifactSchema.parse({id:"source",role:"target",name:"actual.html",extension:"html",mimeType:"text/html",size:Buffer.byteLength(original),storageRef:"original",inputMode:"upload",createdAt:"2026-10-14T11:00:00Z"})];
  const criterion = AcceptanceCriterionSchema.parse({id:"PROTECT-ALL",title:"Original whole protection",requirement:"Preserve all original content, structure and behavior",source:"protected-item",hardGate:true,protectedConstraint:true,minScore:95,artifactIds:["source"]});
  const test = TestCaseSchema.parse({id:"H",title:"Complete whole scope",input:"Full Original",expected:["Preserve all"],hidden:true,criterionIds:[criterion.id],executionMode:"external-runner"});
  project.acceptanceRubric=[criterion];project.evalSuite=[];project.hiddenEvalSuite=[test];project.searchChampion=undefined;project.evolutionArchive=[];
  project.protectedItems=["all original content and behavior"];project.editableItems=[];project.attentionRequests=[];project.targetConnection.adapter="artifact";
  project.campaign.status="running";project.campaign.currentRound=0;
  const operationKey="workflow-control:"+project.id+":authority";
  project.campaign.serverControlOwner={schemaVersion:"server-workflow-control-owner-v1",phase:"bound",controlJobId:"control",operationKey,
    sourceUpdatedAt:project.updatedAt,inputFingerprint:"a".repeat(64),requestedAt:"2026-10-14T11:00:00Z",runId:"sdk-run"};
  const candidate=CandidateSchema.parse({id:"C1",name:"Exact frozen subject",change:"Actual file change",artifactBuildStatus:"ready",artifactSnapshots:[{
    id:"snapshot",sourceArtifactId:"source",name:"actual.html",mimeType:"text/html",content:executed,contentHash:digest(executed),createdAt:"2026-10-14T11:00:00Z",
    frozenArtifact:{sourceArtifactId:"source",snapshotHash:digest(executed),blobId:"candidate",name:"actual.html",mimeType:"text/html",sha256:digest(executed),size:Buffer.byteLength(executed),verifiedAt:"2026-10-14T11:00:00Z",checks:["actual-readback"],limitations:[]} }]});
  project.candidates=[draft?CandidateSchema.parse({id:candidate.id,name:candidate.name,change:candidate.change}):structuredClone(candidate)];
  const job=EvolutionJobSchema.parse({schemaVersion:"job-v1",id:"control",missionId:project.id,type:"campaign",status:"running",label:"Synthetic test owner",idempotencyKey:operationKey,generation:1,outputRef:"sdk-run",createdAt:"2026-10-14T11:00:00Z",updatedAt:"2026-10-14T11:00:00Z"});
  awaitInitialMetadata();
  function awaitInitialMetadata() {
    for (const [id,text] of [["original",original],["candidate",executed]]) {
      bytes.set(id!,new Blob([text!],{type:"text/html"}));
      metadata.set(id!,{id:id!,schemaVersion:"artifact-v1",missionId:project.id,bucket:"private",objectPath:id!,mimeType:"text/html",sha256:digest(text!),sizeBytes:Buffer.byteLength(text!),createdAt:"2026-10-14T11:00:00Z",updatedAt:"2026-10-14T11:00:00Z"});
    }
  }
  const key="synthetic-only-signing-key-00000001", signer={keyId:"synthetic",key,verificationKeys:{synthetic:key}};
  const selection=ServerAiPublicSelectionSchema.parse({version:"server-ai-public-selection-v1",source:"vault",settings:{connectionId:"synthetic",label:"Synthetic",baseUrl:"https://provider.example.test/v1",model:"synthetic-model",protocol:"chat-completions",responseFormat:"json-schema"},
    metadata:{id:"server-ai-default-connection-v1",workspaceId:"synthetic-workspace",name:"Synthetic default",purpose:"Synthetic test",scopes:["ai:default-connection"],version:1,keyId:"synthetic-encryption",algorithm:"aes-256-gcm",createdBy:"synthetic-human",createdAt:"2026-10-14T11:00:00Z",updatedAt:"2026-10-14T11:00:00Z"},sealedRecordSha256:"9".repeat(64)});
  const selectionResult=()=>({availability:"available" as const,selection:structuredClone(selection),selectionIdentitySha256:serverAiPublicSelectionIdentity(selection)});
  const route=serverAiPublicScoringRouteFingerprint({mode:"openai-compatible",baseUrl:selection.settings.baseUrl,model:selection.settings.model,protocol:selection.settings.protocol,responseFormat:selection.settings.responseFormat});
  const ports:ServerHtmlProtectionAuthorityPorts={store,getArtifact:async id=>bytes.get(id),readRuntime:async()=>({version:"html-protection-private-cloud-v1",sha256:"b".repeat(64),byteLength:100}),
    owner:{readMission:async()=>structuredClone(project),readJob:async()=>structuredClone(job),readRun:async()=>({exists:true,status:"running"}),readRoute:async()=>route,readSelection:async()=>selectionResult(),readStoredSelection:async()=>selectionResult()},
    observeWhole:vi.fn<NonNullable<ServerHtmlProtectionAuthorityPorts["observeWhole"]>>(async ({request})=>({availability:"unavailable",reason:"missing-trusted-runtime",request})),observeSemantic:vi.fn(async()=>{throw Error("No real model in tests");}),observeVisual:vi.fn(async()=>{throw Error("No real images in tests");}),
    readSigning:async()=>signer,now:()=>now};
  const currentRun:TargetRunResult={testCaseId:test.id,artifactHash:digest(original),output:"Actual case result",verificationStatus:"verified",latencyMs:1,cost:0,trace:[]};
  const candidateRun={...currentRun,artifactHash:digest(executed)};
  return {project,test,criterion,candidate,job,ports,store,bytes,metadata,signer,currentRun,candidateRun,original,executed,now,selection,route};
}
