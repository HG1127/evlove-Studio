// @vitest-environment node
import {createHash} from "node:crypto";
import {beforeEach,describe,expect,it,vi} from "vitest";
import {ArtifactMetadataSchema,type ProductionRuntimePorts} from "@evolution/contracts";

const appendEvidence=vi.hoisted(()=>vi.fn());
vi.mock("./evidence-ledger",()=>({appendEvidenceLedger:appendEvidence}));
import {isTextArtifactMimeType,reconcileArtifactRegistration} from "./artifact-lifecycle";

const content="exact artifact bytes";
const sha256=createHash("sha256").update(content).digest("hex");
const metadata=ArtifactMetadataSchema.parse({
  id:"artifact-1",schemaVersion:"artifact-v1",missionId:"mission-1",jobId:"job-1",
  kind:"source",bucket:"evolution-artifacts",objectPath:"mission-1/artifact-1",
  mimeType:"text/plain",sizeBytes:Buffer.byteLength(content),sha256,
  createdAt:"2026-09-24T00:00:00.000Z",updatedAt:"2026-09-24T00:00:00.000Z",
});

function runtime(overrides:{sha256?:string;missionId?:string;content?:string}={}){
  return {
    missions:{get:vi.fn(async()=>({id:"mission-1"}))},
    artifacts:{
      get:vi.fn(async()=>new Blob([overrides.content??content],{type:"text/plain"})),
      getMetadata:vi.fn(async()=>({...metadata,sha256:overrides.sha256??metadata.sha256,
        missionId:overrides.missionId??metadata.missionId})),
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

  it("can retry a ledger failure without replacing the stored artifact",async()=>{
    appendEvidence.mockRejectedValueOnce(new Error("ledger unavailable"));
    const ports=runtime();
    const input={missionId:"mission-1",artifactId:"artifact-1"};
    await expect(reconcileArtifactRegistration(ports,input)).rejects.toThrow("ledger unavailable");
    await expect(reconcileArtifactRegistration(ports,input)).resolves.toMatchObject({status:"reconciled"});
    expect(ports.artifacts.get).toHaveBeenCalledTimes(2);
    expect(appendEvidence).toHaveBeenCalledTimes(2);
  });
});
