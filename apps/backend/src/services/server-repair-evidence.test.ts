// @vitest-environment node
import {createHash} from "node:crypto";
import {beforeEach,describe,expect,it,vi} from "vitest";
import {type ArtifactBinding,type ArtifactMetadata,type RepairEvidenceArchiveInput} from "@evolution/contracts";
import {acceptedPackageFixture} from "@evolution/testkit";
import {archiveServerRepairEvidence} from "./server-repair-evidence";

const m=vi.hoisted(()=>({blobs:new Map<string,Blob>(),metadata:new Map<string,ArtifactMetadata>(),put:vi.fn(),get:vi.fn(),hasMetadata:true}));
vi.mock("./artifact-runtime",()=>({getServerArtifactStore:()=>({put:m.put,get:m.get,getMetadata:m.hasMetadata?async(id:string)=>m.metadata.get(id):undefined})}));
const sha=(wire:string)=>createHash("sha256").update(wire).digest("hex");
function input(phase:"visible"|"hidden"="hidden"):RepairEvidenceArchiveInput{
  const {project:p,current:c}=acceptedPackageFixture(false);
  const content=JSON.stringify({version:"repair-feedback-evidence-v1",missionId:p.id,candidateId:c.id,phase,round:1,attempt:1,inputFingerprint:sha("synthetic-input"),
    experiment:p.experimentRun,...(phase==="hidden"?{validation:p.validationRun,acceptance:p.artifactAcceptance}:{})});
  return {version:"repair-evidence-archive-v1",missionId:p.id,candidateId:c.id,phase,attempt:1,content,sha256:sha(content),size:Buffer.byteLength(content)};
}
beforeEach(()=>{
  m.blobs.clear();m.metadata.clear();m.hasMetadata=true;m.get.mockReset().mockImplementation(async(id:string)=>m.blobs.get(id));
  m.put.mockReset().mockImplementation(async(id:string,blob:Blob,binding:ArtifactBinding)=>{
    m.blobs.set(id,blob);m.metadata.set(id,{id,schemaVersion:"artifact-v1",missionId:binding.missionId,kind:binding.kind,bucket:"private-artifacts",objectPath:id,
      mimeType:blob.type,sizeBytes:blob.size,sha256:sha(await blob.text()),createdAt:"2026-10-26T00:00:00Z",updatedAt:"2026-10-26T00:00:00Z"});
  });
});
describe("private repair evidence archive",()=>{
  it.each(["visible","hidden"] as const)("preserves the complete %s report and reads back Mission-bound metadata and exact bytes",async phase=>{
    const data=input(phase),ref=await archiveServerRepairEvidence(data);
    expect(ref).toMatchObject({missionId:data.missionId,candidateId:data.candidateId,sha256:data.sha256,size:data.size});
    expect(await m.blobs.get(ref.artifactId)!.text()).toBe(data.content);
    expect(m.put).toHaveBeenCalledWith(ref.artifactId,expect.any(Blob),{missionId:data.missionId,kind:"candidate-repair-evidence"});
    expect(ref).not.toHaveProperty("content");expect(ref).not.toHaveProperty("experiment");
    await archiveServerRepairEvidence(data);expect(m.put).toHaveBeenCalledOnce();
  });
  it.each(["size","sha","mission","candidate","phase","attempt"])("rejects %s mismatch before writing",async field=>{
    const data=input();
    if(field==="size")data.size++;
    if(field==="sha")data.sha256="0".repeat(64);
    if(field==="mission")data.missionId="foreign";
    if(field==="candidate")data.candidateId="foreign";
    if(field==="phase")data.phase="visible";
    if(field==="attempt")data.attempt=2;
    await expect(archiveServerRepairEvidence(data)).rejects.toThrow();expect(m.put).not.toHaveBeenCalled();
  });
  it("does not overwrite an existing artifact with a different Mission binding",async()=>{
    const data=input(),ref=await archiveServerRepairEvidence(data);m.metadata.get(ref.artifactId)!.missionId="foreign";m.put.mockClear();
    await expect(archiveServerRepairEvidence(data)).rejects.toThrow("binding mismatch");expect(m.put).not.toHaveBeenCalled();
  });
  it("rejects missing metadata capability and tampered byte readback",async()=>{
    const data=input();m.hasMetadata=false;
    await expect(archiveServerRepairEvidence(data)).rejects.toThrow("metadata readback");expect(m.put).not.toHaveBeenCalled();
    m.hasMetadata=true;m.get.mockResolvedValue(new Blob(["changed bytes"]));
    await expect(archiveServerRepairEvidence(data)).rejects.toThrow("exact-byte readback");
  });
});
