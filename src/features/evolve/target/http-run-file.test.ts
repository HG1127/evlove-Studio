// @vitest-environment node
import {createHash} from "node:crypto";
import {describe,expect,it,vi} from "vitest";
import type {Candidate,EvolveProject} from "@evolution/contracts";
import {prepareBrowserHttpRunFile,prepareBrowserHttpRunHtml} from "./http-run-file";

const source={id:"pdf-source",name:"report.pdf",mimeType:"application/pdf",extension:"pdf",role:"target",storageRef:"pdf-upload"} as EvolveProject["sourceArtifacts"][number];
const bytes=Buffer.from("%PDF-1.7 exact bytes");
const digest=createHash("sha256").update(bytes).digest("hex");

function variant(){
  return{id:"C1",artifactSnapshots:[{id:"snapshot",sourceArtifactId:source.id,name:source.name,mimeType:source.mimeType,
    content:"snapshot",contentHash:"snapshot-hash",frozenArtifact:{sourceArtifactId:source.id,snapshotHash:"snapshot-hash",blobId:"frozen-pdf",name:source.name,mimeType:source.mimeType,sha256:digest,size:bytes.length}}]} as unknown as Candidate;
}

describe("browser HTTP generic file binding",()=>{
  it("reads the exact uploaded PDF bytes instead of parsed text",async()=>{
    const get=vi.fn(async(id:string)=>id==="pdf-upload"?new Blob([bytes]):undefined);
    const file=await prepareBrowserHttpRunFile(source,undefined,{get,read:vi.fn()});
    expect(file).toMatchObject({sourceArtifactId:"pdf-source",sha256:digest,size:bytes.length});
    expect(Buffer.from(file.contentBase64,"base64")).toEqual(bytes);
    expect(get).toHaveBeenCalledWith("pdf-upload");
  });

  it("preserves exact zero-byte uploads",async()=>{
    const emptyHash=createHash("sha256").update(Buffer.alloc(0)).digest("hex");
    const file=await prepareBrowserHttpRunFile(source,undefined,{get:async()=>new Blob([]),read:vi.fn()});
    expect(file).toMatchObject({size:0,sha256:emptyHash,contentBase64:""});
  });
  it("uses the Candidate frozen PDF and rejects changed bytes",async()=>{
    const candidate=variant();
    const get=vi.fn();
    const read=vi.fn(async()=>new Blob([bytes]));
    const file=await prepareBrowserHttpRunFile(source,candidate,{get,read});
    expect(file.snapshotHash).toBe("snapshot-hash");
    expect(read).toHaveBeenCalledWith(candidate.artifactSnapshots[0]!.frozenArtifact,"snapshot");
    expect(get).not.toHaveBeenCalled();
    await expect(prepareBrowserHttpRunFile(source,candidate,{get,read:async()=>new Blob(["altered"])})).rejects.toThrow("冻结凭证不一致");
  });

  it("refuses a Candidate without a unique exact frozen Target",async()=>{
    const candidate=variant();
    candidate.artifactSnapshots[0]!.frozenArtifact=undefined;
    await expect(prepareBrowserHttpRunFile(source,candidate,{get:vi.fn(),read:vi.fn()})).rejects.toThrow("身份不一致");
    candidate.artifactSnapshots=[];
    await expect(prepareBrowserHttpRunFile(source,candidate,{get:vi.fn(),read:vi.fn()})).rejects.toThrow("唯一");
  });
});
describe("browser HTTP HTML byte binding",()=>{
  const html="<!doctype html><title>exact</title>";
  const htmlHash=createHash("sha256").update(html).digest("hex");
  const htmlSource={...source,id:"html-source",name:"index.html",mimeType:"text/html",extension:"html",storageRef:"html-upload",textContent:"stale parsed text"};
  it("uses the uploaded HTML Blob instead of stale parsed text",async()=>{
    const get=vi.fn(async(id:string)=>id==="html-upload"?new Blob([html]):undefined);
    const result=await prepareBrowserHttpRunHtml(htmlSource,undefined,{get,read:vi.fn()});
    expect(result).toEqual({artifact:{name:"index.html",content:html},sha256:htmlHash});
    expect(get).toHaveBeenCalledWith("html-upload");
  });
  it("uses frozen Candidate HTML and rejects different stored bytes",async()=>{
    const candidate={id:"C1",artifactSnapshots:[{id:"html-snapshot",sourceArtifactId:"html-source",name:"index.html",mimeType:"text/html",content:html,contentHash:"snapshot-hash",
      frozenArtifact:{sourceArtifactId:"html-source",snapshotHash:"snapshot-hash",blobId:"frozen-html",name:"index.html",mimeType:"text/html",sha256:htmlHash,size:Buffer.byteLength(html)}}]} as unknown as Candidate;
    const get=vi.fn();
    const read=vi.fn(async()=>new Blob([html]));
    const result=await prepareBrowserHttpRunHtml(htmlSource,candidate,{get,read});
    expect(result.sha256).toBe(htmlHash);
    expect(read).toHaveBeenCalledWith(candidate.artifactSnapshots[0]!.frozenArtifact,html);
    expect(get).not.toHaveBeenCalled();
    await expect(prepareBrowserHttpRunHtml(htmlSource,candidate,{get,read:async()=>new Blob(["changed"])})).rejects.toThrow("冻结字节");
  });
});