// @vitest-environment node
import {createHash} from "node:crypto";
import {readFileSync} from "node:fs";
import {H3} from "nitro/h3";
import {afterEach,beforeEach,describe,expect,it,vi} from "vitest";
import {finalHoldoutContractFingerprint,htmlNativeCaseSource} from "@evolution/core";
import {
  ArtifactMetadataSchema,EvolveProjectSchema,MissionEnvelopeSchema,missionEnvelope,
  type ArtifactMetadata,type EvolveProject,type MissionEnvelope,
} from "@evolution/contracts";

const mock=vi.hoisted(()=>({
  create:vi.fn(),getEnvelope:vi.fn(),swap:vi.fn(),getMission:vi.fn(),
  put:vi.fn(),get:vi.fn(),getMetadata:vi.fn(),append:vi.fn(),health:vi.fn(),ledger:vi.fn(),sandbox:vi.fn(),
}));
vi.mock("./security-policy",()=>({requireGovernedEvolutionPermission:vi.fn(async()=>undefined)}));
vi.mock("./data-plane-guard",()=>({requireServerDataPlaneAvailable:vi.fn()}));
vi.mock("./server-confirmation-admission",()=>({assertServerConfirmationAdmission:vi.fn(async()=>undefined)}));
vi.mock("./production-runtime",()=>({
  createServerMissionEnvelope:mock.create,
  getServerMissionEnvelope:mock.getEnvelope,
  compareAndSwapServerMissionEnvelope:mock.swap,
  getServerProductionRuntime:()=>({
    missions:{get:mock.getMission},jobs:{get:vi.fn()},events:{append:mock.append},
  }),
}));
vi.mock("./artifact-runtime",()=>({getServerArtifactStore:()=>({
  put:mock.put,get:mock.get,getMetadata:mock.getMetadata,delete:vi.fn(),
})}));
vi.mock("./evidence-ledger",()=>({
  getEvidenceLedgerHealth:mock.health,appendEvidenceLedger:mock.ledger,
}));
vi.mock("./event-replay",()=>({
  appendCanonicalOccurrenceEvent:vi.fn(async(events:{append:(event:unknown)=>Promise<unknown>},event:unknown)=>events.append(event)),
}));
vi.mock("@evolution/adapters/sandbox",()=>({
  runVercelSandboxHtmlValidation:mock.sandbox,runVercelSandboxCodebaseValidation:vi.fn(),
}));
vi.mock("./server-visual-evidence",()=>({attachServerVisualEvidence:vi.fn(async(_project:unknown,_tests:unknown,runs:unknown)=>runs)}));

import missionCreate from "../../server/api/evolution/missions.post";
import missionPut from "../../server/api/evolution/missions/[id].put";
import artifactRegister from "../../server/api/evolution/artifacts/register.post";
import {executeServerArtifactExternal} from "./server-artifact-external";

const app=new H3()
  .post("/missions",missionCreate)
  .put("/missions/:id",missionPut)
  .post("/artifacts/register",artifactRegister);
const fixtureDir="tests/fixtures/p3x-synthetic-task-board/";
const original=readFileSync(fixtureDir+"original.html","utf8");
const missionDraft=EvolveProjectSchema.parse(JSON.parse(readFileSync(fixtureDir+"mission.template.json","utf8")));
const approval=JSON.parse(readFileSync(fixtureDir+"approval.request.json","utf8")) as {source:{sha256:string,sizeBytes:number}};
const blobId="p3y-synthetic-task-board-original";
const sha=(input:string|Uint8Array)=>createHash("sha256").update(input).digest("hex");
const at="2026-11-13T09:00:00.000Z";
let stored:MissionEnvelope|undefined;
let blobs:Map<string,Blob>;
let metadata:Map<string,ArtifactMetadata>;

function request(path:string,method:"POST"|"PUT",body:unknown){
  return new Request("http://localhost"+path,{
    method,headers:{"content-type":"application/json"},body:JSON.stringify(body),
  });
}
beforeEach(()=>{
  vi.clearAllMocks();
  vi.stubEnv("EVOLUTION_EXPERIMENT_MODE","isolated");
  mock.sandbox.mockImplementation(async(input:{expectedSha256:string;testCases:Array<{id:string}>})=>({
    artifactHash:input.expectedSha256,scriptsRun:[],results:input.testCases.map(test=>({
      testCaseId:test.id,artifactHash:input.expectedSha256,verificationStatus:"unverified",
      output:"P3-Y isolated fake Sandbox: browser never ran",latencyMs:0,cost:0,trace:[],
    })),
  }));
  stored=undefined;blobs=new Map();metadata=new Map();
  mock.getMission.mockImplementation(async(id:string)=>id===stored?.missionId?stored.payload:undefined);
  mock.create.mockImplementation(async(project:EvolveProject)=>{
    if(stored)throw Error("Synthetic Mission already exists");
    stored=missionEnvelope(project,0);return stored;
  });
  mock.getEnvelope.mockImplementation(async(id:string)=>id===stored?.missionId?stored:undefined);
  mock.swap.mockImplementation(async(input:MissionEnvelope)=>{
    if(!stored||input.missionId!==stored.missionId||input.revision!==stored.revision)throw Error("Mission CAS conflict");
    stored=MissionEnvelopeSchema.parse({...input,revision:stored.revision+1});return stored;
  });
  mock.put.mockImplementation(async(id:string,blob:Blob,binding?:{missionId?:string;jobId?:string;kind?:string})=>{
    const bytes=new Uint8Array(await blob.arrayBuffer());
    blobs.set(id,blob);
    metadata.set(id,ArtifactMetadataSchema.parse({
      id,schemaVersion:"artifact-v1",bucket:"synthetic-memory-only",objectPath:id,
      mimeType:blob.type,sizeBytes:bytes.byteLength,sha256:sha(bytes),
      createdAt:at,updatedAt:at,...binding,
    }));
  });
  mock.get.mockImplementation(async(id:string)=>blobs.get(id));
  mock.getMetadata.mockImplementation(async(id:string)=>metadata.get(id));
  mock.health.mockResolvedValue({configured:true,databaseReady:true,signingConfigured:true,appendFunctionReady:true,immutableTriggerReady:true});
  mock.append.mockResolvedValue(undefined);
  mock.ledger.mockResolvedValue({id:"synthetic-evidence-receipt"});
});

afterEach(()=>vi.unstubAllEnvs());

async function bindPhysicalSource(){
  const created=await app.fetch(request("/missions","POST",missionDraft));
  expect(created.status).toBe(200);
  expect(await created.json()).toMatchObject({missionId:missionDraft.id,revision:0});
  // The mission must exist before mission-scoped registration can create an immutable receipt.
  const registered=await app.fetch(request("/artifacts/register","POST",{
    id:blobId,missionId:missionDraft.id,kind:"source",mimeType:"text/html",content:original,
  }));
  expect(registered.status).toBe(200);
  expect(await registered.json()).toMatchObject({
    id:blobId,missionId:missionDraft.id,kind:"source",sha256:approval.source.sha256,size:2067,
  });
  const bound=EvolveProjectSchema.parse({...missionDraft,sourceArtifacts:[
    {...missionDraft.sourceArtifacts[0]!,storageRef:blobId},
  ]});
  const updated=await app.fetch(request("/missions/"+encodeURIComponent(missionDraft.id),"PUT",missionEnvelope(bound,0)));
  expect(updated.status).toBe(200);
  expect(await updated.json()).toMatchObject({missionId:missionDraft.id,revision:1});
  expect(stored?.payload.sourceArtifacts[0]?.storageRef).toBe(blobId);
  expect(finalHoldoutContractFingerprint(bound)).toBe(bound.finalHoldout?.contractFingerprint);
  expect(metadata.get(blobId)).toMatchObject({
    missionId:missionDraft.id,kind:"source",sha256:approval.source.sha256,sizeBytes:approval.source.sizeBytes,
  });
  return bound;
}

describe("P3-Y synthetic Mission import and physical custody — memory-only dry run",()=>{
  it("routes all visible browser tests to generic HTML Sandbox with exact stored source, never a live provider",async()=>{
    const bound=await bindPhysicalSource();
    // The legacy Native plan intentionally accepts only its exact historical search profile.
    expect(bound.evalSuite.every(test=>htmlNativeCaseSource(bound,test)===undefined)).toBe(true);
    const runs=await executeServerArtifactExternal(bound,bound.evalSuite,"baseline");
    expect(mock.sandbox).toHaveBeenCalledOnce();
    const payload=mock.sandbox.mock.calls[0]![0] as {
      html:Uint8Array;expectedSha256:string;testCases:Array<{id:string;browserSteps?:unknown[]}>;
    };
    expect(payload.expectedSha256).toBe(approval.source.sha256);
    expect(sha(payload.html)).toBe(approval.source.sha256);
    expect(payload.testCases.map(test=>test.id)).toEqual(bound.evalSuite.map(test=>test.id));
    expect(payload.testCases.every(test=>Boolean(test.browserSteps?.length))).toBe(true);
    expect(runs).toHaveLength(bound.evalSuite.length);
    // Fake Sandbox deliberately never returns VERIFIED.
    expect(runs.every(run=>run.verificationStatus==="unverified"&&!run.nativeHtmlProof)).toBe(true);
    expect(blobs.size).toBe(1);
    expect(mock.put).toHaveBeenCalledOnce();
  });

  it("refuses registering source bytes without an existing Mission",async()=>{
    const response=await app.fetch(request("/artifacts/register","POST",{
      id:blobId,missionId:missionDraft.id,kind:"source",mimeType:"text/html",content:original,
    }));
    expect(response.status).toBe(404);
    expect(mock.put).not.toHaveBeenCalled();
    expect(mock.ledger).not.toHaveBeenCalled();
  });


  it.each(["prebound-storage","drifted-text","self-consistent-new-original","changed-visible-case","changed-hidden-case",
    "extra-reference-source","changed-protected-items","changed-editable-items","changed-object-type","changed-target-adapter",
    "multi-round","multiple-candidates","scheduled-run"] as const)(
    "rejects synthetic Mission POST before persistence when %s is present",async kind=>{
      const draft=structuredClone(missionDraft);
      if(kind==="prebound-storage")draft.sourceArtifacts[0]!.storageRef=blobId;
      else if(kind==="changed-visible-case")draft.evalSuite[0]!.title="different visible case";
      else if(kind==="changed-hidden-case")draft.hiddenEvalSuite[0]!.title="different hidden case";
      else if(kind==="extra-reference-source")draft.sourceArtifacts.push({...draft.sourceArtifacts[0]!,id:"extra-context",role:"reference"});
      else if(kind==="changed-protected-items")draft.protectedItems=[];
      else if(kind==="changed-editable-items")draft.editableItems=[];
      else if(kind==="changed-object-type")draft.objectType="system";
      else if(kind==="changed-target-adapter")draft.targetConnection.adapter="http";
      else if(kind==="multi-round")draft.campaign.stopCriteria.maxRounds=2;
      else if(kind==="multiple-candidates")draft.campaign.candidateCount=2;
      else if(kind==="scheduled-run")draft.campaign.schedule.enabled=true;
      else{
        const modified=original+"\\nunsafe";
        draft.sourceArtifacts[0]!.textContent=modified;
        draft.sourceArtifacts[0]!.size=Buffer.byteLength(modified);
        if(kind==="self-consistent-new-original")
          draft.sourceArtifacts[0]!.mutationGovernance!.parentSha256=sha(modified);
      }
      const response=await app.fetch(request("/missions","POST",draft));
      expect(response.status).toBe(422);
      expect(await response.json()).toMatchObject({data:{code:"LAB_SYNTHETIC_SOURCE_PREREGISTRATION_INVALID"}});
      expect(mock.create).not.toHaveBeenCalled();
      expect(mock.put).not.toHaveBeenCalled();
    });

  it("refuses synthetic Mission creation via generic CAS PUT with fabricated sourceRef",async()=>{
    const draft=structuredClone(missionDraft);
    draft.sourceArtifacts[0]!.storageRef="predeclared-but-unregistered";
    const response=await app.fetch(request("/missions/"+encodeURIComponent(draft.id),"PUT",missionEnvelope(draft,0)));
    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({data:{code:"LAB_SYNTHETIC_SOURCE_PREREGISTRATION_INVALID"}});
    expect(mock.swap).not.toHaveBeenCalled();
  });

  it.each([
    "missing-blob","wrong-mission","wrong-kind","wrong-hash","wrong-size",
    "wrong-mime","wrong-parent","drifted-source","tampered-blob",
  ] as const)("rejects Mission CAS source binding before persistence for %s",async drift=>{
    const created=await app.fetch(request("/missions","POST",missionDraft));
    expect(created.status).toBe(200);
    if(drift!=="missing-blob"){
      const registered=await app.fetch(request("/artifacts/register","POST",{
        id:blobId,missionId:missionDraft.id,kind:"source",mimeType:"text/html",content:original,
      }));
      expect(registered.status).toBe(200);
    }
    const bound=structuredClone(missionDraft);
    bound.sourceArtifacts[0]!.storageRef=blobId;
    if(drift==="wrong-parent")bound.sourceArtifacts[0]!.mutationGovernance!.parentSha256="a".repeat(64);
    else if(drift==="drifted-source")bound.sourceArtifacts[0]!.textContent=original+" changed";
    else if(drift==="tampered-blob")blobs.set(blobId,new Blob([original.replace("Alpha","Omega")],{type:"text/html"}));
    else if(drift!=="missing-blob"){
      const meta=metadata.get(blobId)!;
      metadata.set(blobId,{...meta,...drift==="wrong-mission"?{missionId:"wrong-mission"}
        :drift==="wrong-kind"?{kind:"candidate"}
        :drift==="wrong-hash"?{sha256:"a".repeat(64)}
        :drift==="wrong-size"?{sizeBytes:meta.sizeBytes+1}
        :{mimeType:"text/plain"}});
    }
    const updated=await app.fetch(request("/missions/"+encodeURIComponent(bound.id),"PUT",missionEnvelope(bound,0)));
    expect(updated.status).toBe(409);
    expect(await updated.json()).toMatchObject({data:{code:"LAB_SYNTHETIC_SOURCE_BINDING_UNVERIFIED"}});
    expect(mock.swap).not.toHaveBeenCalled();
    expect(stored?.revision).toBe(0);
    expect(stored?.payload.sourceArtifacts[0]?.storageRef).toBeUndefined();
    expect(mock.sandbox).not.toHaveBeenCalled();
  });

  it.each(["rebind","remove-ref","change-text","missing-existing-blob","change-visible-case","change-hidden-case",
    "add-reference","change-protected-items","change-editable-items","multi-round","multiple-candidates","schedule-enabled"] as const)(
    "does not change a frozen Mission after %s",async kind=>{
      const bound=await bindPhysicalSource();
      const revision=stored!.revision;
      const next=structuredClone(bound);
      next.name="Operator note only";
      if(kind==="rebind")next.sourceArtifacts[0]!.storageRef="another-artifact";
      if(kind==="remove-ref")next.sourceArtifacts[0]!.storageRef=undefined;
      if(kind==="change-text")next.sourceArtifacts[0]!.textContent="altered original source";
      if(kind==="change-visible-case")next.evalSuite[0]!.title="modified visible evaluation";
      if(kind==="change-hidden-case")next.hiddenEvalSuite[0]!.title="modified hidden evaluation";
      if(kind==="add-reference")next.sourceArtifacts.push({...next.sourceArtifacts[0]!,id:"extra-context",role:"reference"});
      if(kind==="change-protected-items")next.protectedItems=[];
      if(kind==="change-editable-items")next.editableItems=[];
      if(kind==="multi-round")next.campaign.stopCriteria.maxRounds=2;
      if(kind==="multiple-candidates")next.campaign.candidateCount=2;
      if(kind==="schedule-enabled")next.campaign.schedule.enabled=true;
      if(kind==="missing-existing-blob")blobs.delete(blobId);
      const response=await app.fetch(request("/missions/"+encodeURIComponent(next.id),"PUT",missionEnvelope(next,revision)));
      expect(response.status).toBe(409);
      expect(await response.json()).toMatchObject({data:{code:"LAB_SYNTHETIC_SOURCE_BINDING_UNVERIFIED"}});
      expect(mock.swap).toHaveBeenCalledTimes(1);
      expect(stored?.revision).toBe(revision);
      expect(stored?.payload.sourceArtifacts[0]?.storageRef).toBe(blobId);
    });

  it("permits unrelated Mission metadata edits after a valid source binding",async()=>{
    const bound=await bindPhysicalSource();
    const next=structuredClone(bound);
    next.name="Operator note only";
    const response=await app.fetch(request("/missions/"+encodeURIComponent(next.id),"PUT",missionEnvelope(next,1)));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({revision:2,missionId:next.id});
    expect(stored?.payload.name).toBe("Operator note only");
    expect(stored?.payload.sourceArtifacts[0]?.storageRef).toBe(blobId);
    expect(mock.sandbox).not.toHaveBeenCalled();
  });

  it("does not enforce Lab-only import policy outside isolated mode",async()=>{
    vi.stubEnv("EVOLUTION_EXPERIMENT_MODE","production");
    const draft=structuredClone(missionDraft);
    draft.sourceArtifacts[0]!.storageRef="prod-legacy-ref";
    const response=await app.fetch(request("/missions","POST",draft));
    expect(response.status).toBe(200);
    expect(mock.create).toHaveBeenCalledOnce();
    expect(mock.getMetadata).not.toHaveBeenCalled();
  });
  it("rejects a changed protected-scope mission before any HTML Sandbox call",async()=>{
    const bound=await bindPhysicalSource();
    bound.protectedItems=[];
    const runs=await executeServerArtifactExternal(bound,bound.evalSuite,"baseline");
    expect(mock.sandbox).not.toHaveBeenCalled();
    expect(runs.every(x=>x.verificationStatus==="unverified")).toBe(true);
  });

  it.each(["unbound","wrong-mission","wrong-kind","wrong-hash","wrong-size","wrong-parent","tampered-blob"] as const)(
    "never transmits source to Sandbox when physical custody is %s",async drift=>{
      const bound=await bindPhysicalSource();
      if(drift==="unbound")bound.sourceArtifacts[0]!.storageRef=undefined;
      else if(drift==="wrong-parent")bound.sourceArtifacts[0]!.mutationGovernance!.parentSha256="a".repeat(64);
      else if(drift==="tampered-blob")blobs.set(blobId,new Blob([original.replace("Alpha","Omega")],{type:"text/html"}));
      else {
        const saved=metadata.get(blobId)!;
        metadata.set(blobId,{...saved,...drift==="wrong-mission"?{missionId:"another-mission"}
          :drift==="wrong-kind"?{kind:"candidate"}
          :drift==="wrong-hash"?{sha256:"a".repeat(64)}
          :{sizeBytes:saved.sizeBytes+1}});
      }
      const runs=await executeServerArtifactExternal(bound,bound.evalSuite,"baseline");
      expect(mock.sandbox).not.toHaveBeenCalled();
      expect(runs).toHaveLength(bound.evalSuite.length);
      expect(runs.every(run=>run.verificationStatus==="unverified"&&!run.nativeHtmlProof)).toBe(true);
    });
});
