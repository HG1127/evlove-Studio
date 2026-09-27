import {createHash} from "node:crypto";
import {describe,expect,it,vi} from "vitest";
import type {Candidate,EvolveProject} from "@evolution/contracts";
import {prepareBrowserHttpReleaseArtifacts} from "./http-release-artifacts";

function fixture(){
  const content="<html>accepted</html>";
  const sha256=createHash("sha256").update(content).digest("hex");
  const snapshot={id:"s1",sourceArtifactId:"source",name:"index.html",mimeType:"text/html",content,contentHash:sha256,createdAt:"now"};
  const candidate={id:"C1",name:"accepted",change:"x",patches:[],artifactSnapshots:[snapshot]} as unknown as Candidate;
  const frozen={sourceArtifactId:"source",snapshotHash:sha256,blobId:"frozen-source",name:"index.html",mimeType:"text/html",sha256,size:Buffer.byteLength(content),verifiedAt:"now",checks:["readback"],limitations:[]};
  const project={id:"m",sourceArtifacts:[{id:"source",role:"target"}],searchChampion:{candidate,artifactAcceptance:{status:"passed",candidateId:"C1",frozenArtifacts:[frozen]}}} as unknown as EvolveProject;
  const read=vi.fn(async()=>new Blob([content]));
  return{project,candidate,content,frozen,read};
}

describe("browser HTTP Release frozen bytes",()=>{
  it("sends exact Gate F bytes and the accepted Candidate",async()=>{
    const x=fixture();
    const result=await prepareBrowserHttpReleaseArtifacts(x.project,x.candidate,x.read);
    expect(result.candidate).toBe(x.candidate);
    expect(result.frozenArtifacts).toHaveLength(1);
    expect(Buffer.from(result.frozenArtifacts[0]!.contentBase64,"base64").toString()).toBe(x.content);
    expect(result.frozenArtifacts[0]?.sha256).toBe(x.frozen.sha256);
    expect(x.read).toHaveBeenCalledWith(x.frozen,x.content);
  });

  it("rejects an edited Candidate and a missing Gate F before reading local files",async()=>{
    const x=fixture();
    const changed={...x.candidate,artifactSnapshots:[{...x.candidate.artifactSnapshots[0]!,content:"edited"}]};
    await expect(prepareBrowserHttpReleaseArtifacts(x.project,changed,x.read)).rejects.toThrow("Snapshot 不一致");
    expect(x.read).not.toHaveBeenCalled();
    x.project.searchChampion!.artifactAcceptance!.status="unverified";
    await expect(prepareBrowserHttpReleaseArtifacts(x.project,x.candidate,x.read)).rejects.toThrow("Gate F");
    expect(x.read).not.toHaveBeenCalled();
  });

  it("surfaces a missing local frozen Blob instead of sending Snapshot text",async()=>{
    const x=fixture();
    await expect(prepareBrowserHttpReleaseArtifacts(x.project,x.candidate,async()=>{throw new Error("missing frozen blob");})).rejects.toThrow("missing frozen blob");
  });
});
