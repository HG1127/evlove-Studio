// @vitest-environment node
import {createHash} from "node:crypto";
import {beforeEach,describe,expect,it,vi} from "vitest";
import {ArtifactMetadataSchema,type ProductionRuntimePorts,type EvolutionEvent} from "@evolution/contracts";
import {EventEvidenceMirrorError,EventIdempotencyConflictError} from "./event-persistence";

const appendEvidence=vi.hoisted(()=>vi.fn());
const readEvent=vi.hoisted(()=>vi.fn());
vi.mock("./production-runtime",()=>({getServerEventById:readEvent}));
vi.mock("./evidence-ledger",async(original)=>({...await original<typeof import("./evidence-ledger")>(),appendEvidenceLedger:appendEvidence}));
import {isTextArtifactMimeType,reconcileArtifactRegistration} from "./artifact-lifecycle";

const content="exact artifact bytes";
const sha256=createHash("sha256").update(content).digest("hex");
const metadata=ArtifactMetadataSchema.parse({
  id:"artifact-1",schemaVersion:"artifact-v1",missionId:"mission-1",jobId:"job-1",
  kind:"source",bucket:"evolution-artifacts",objectPath:"mission-1/artifact-1",
  mimeType:"text/plain",sizeBytes:Buffer.byteLength(content),sha256,
  createdAt:"2026-09-24T00:00:00.000Z",updatedAt:"2026-09-24T00:00:00.000Z",
});

function runtime(overrides:{sha256?:string;missionId?:string;artifactId?:string;content?:string;jobMissionId?:string;jobMissing?:boolean}={}){
  return {
    missions:{get:vi.fn(async()=>({id:"mission-1"}))},
    jobs:{get:vi.fn(async()=>overrides.jobMissing?undefined:{id:"job-1",missionId:overrides.jobMissionId??"mission-1"})},
    artifacts:{
      get:vi.fn(async()=>new Blob([overrides.content??content],{type:"text/plain"})),
      getMetadata:vi.fn(async()=>({...metadata,sha256:overrides.sha256??metadata.sha256,
        id:overrides.artifactId??metadata.id,missionId:overrides.missionId??metadata.missionId})),
    },
    events:{append:vi.fn(async()=>undefined)},
  } as unknown as ProductionRuntimePorts;
}

describe("Artifact registration reconciliation",()=>{
  beforeEach(()=>{appendEvidence.mockReset();appendEvidence.mockResolvedValue({id:"ledger-1"});});

  it("keeps binary Artifacts out of the JSON text read endpoint",()=>{
    expect(isTextArtifactMimeType("text/plain")).toBe(true);
    expect(isTextArtifactMimeType("application/vnd.example+json")).toBe(true);
    expect(isTextArtifactMimeType("application/pdf")).toBe(false);
    expect(isTextArtifactMimeType("application/zip")).toBe(false);
    expect(isTextArtifactMimeType("")).toBe(false);
  });

  it("replays deterministic Event and Evidence writes from the stored exact bytes",async()=>{
    const ports=runtime();
    const result=await reconcileArtifactRegistration(ports,{missionId:"mission-1",artifactId:"artifact-1"});
    expect(result).toMatchObject({status:"reconciled",sha256,sizeBytes:Buffer.byteLength(content)});
    expect(ports.events.append).toHaveBeenCalledWith(expect.objectContaining({
      id:`artifact-registered:mission-1:artifact-1:${sha256}`,
    }));
    expect(ports.jobs.get).toHaveBeenCalledWith("job-1");
    expect(appendEvidence).toHaveBeenCalledWith(expect.objectContaining({
      id:`artifact-registration:artifact-1:${sha256}`,artifactRefs:["artifact-1"],
    }));
  });

  it("rejects binding and byte drift before writing evidence",async()=>{
    await expect(reconcileArtifactRegistration(runtime({missionId:"another"}),{
      missionId:"mission-1",artifactId:"artifact-1",
    })).rejects.toMatchObject({reason:"binding-mismatch"});
    await expect(reconcileArtifactRegistration(runtime({content:"changed"}),{
      missionId:"mission-1",artifactId:"artifact-1",
    })).rejects.toMatchObject({reason:"hash-mismatch"});
    expect(appendEvidence).not.toHaveBeenCalled();
  });

  it.each([
    {label:"another Artifact ID",overrides:{artifactId:"artifact-2"}},
    {label:"a missing Job",overrides:{jobMissing:true}},
    {label:"a Job from another Mission",overrides:{jobMissionId:"mission-2"}},
  ])("refuses to replay audit records for $label",async({overrides})=>{
    const ports=runtime(overrides);
    await expect(reconcileArtifactRegistration(ports,{
      missionId:"mission-1",artifactId:"artifact-1",
    })).rejects.toMatchObject({reason:"binding-mismatch"});
    expect(ports.events.append).not.toHaveBeenCalled();
    expect(appendEvidence).not.toHaveBeenCalled();
  });

  it("can retry a ledger failure without replacing the stored artifact",async()=>{
    appendEvidence.mockRejectedValueOnce(new Error("ledger unavailable"));
    const ports=runtime();
    const input={missionId:"mission-1",artifactId:"artifact-1"};
    await expect(reconcileArtifactRegistration(ports,input)).rejects.toThrow("ledger unavailable");
    await expect(reconcileArtifactRegistration(ports,input)).resolves.toMatchObject({status:"reconciled"});
    expect(ports.artifacts.get).toHaveBeenCalledTimes(2);
    expect(appendEvidence).toHaveBeenCalledTimes(2);
  });

  it("recovers a real partial registration while retaining the first immutable Event time",async()=>{
    const ports=runtime();
    let stored:EvolutionEvent|undefined;
    let mirrored=false;
    ports.events.append=vi.fn(async value=>{
      if(!stored){
        stored={...value,at:"2026-10-23T00:00:00.123456+00:00"};
        throw new EventEvidenceMirrorError(value.id,new Error("signer previously missing"));
      }
      if(value.at!==stored.at)throw new EventIdempotencyConflictError(value.id);
      mirrored=true;
    });
    readEvent.mockImplementation(async()=>stored);
    const input={missionId:"mission-1",artifactId:"artifact-1"};
    await expect(reconcileArtifactRegistration(ports,input)).rejects.toBeInstanceOf(EventEvidenceMirrorError);
    expect(appendEvidence).not.toHaveBeenCalled();
    await expect(reconcileArtifactRegistration(ports,input)).resolves.toMatchObject({status:"reconciled",sha256});
    expect(mirrored).toBe(true);
    expect(ports.events.append).toHaveBeenCalledTimes(3);
    expect(ports.events.append).toHaveBeenLastCalledWith(stored);
    expect(stored?.at).toBe("2026-10-23T00:00:00.123456+00:00");
    expect(appendEvidence).toHaveBeenCalledOnce();
  });

  it("refuses a conflicting stored Event instead of certifying its Artifact",async()=>{
    const ports=runtime();
    const conflict=new EventIdempotencyConflictError("artifact-event");
    ports.events.append=vi.fn(async value=>{
      readEvent.mockResolvedValue({...value,payload:{...value.payload,sha256:"f".repeat(64)}});
      throw conflict;
    });
    await expect(reconcileArtifactRegistration(ports,{missionId:"mission-1",artifactId:"artifact-1"})).rejects.toBe(conflict);
    expect(ports.events.append).toHaveBeenCalledOnce();
    expect(appendEvidence).not.toHaveBeenCalled();
  });
});
