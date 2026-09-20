import { beforeEach, describe, expect, it, vi } from "vitest";
import { Blob as NodeBlob } from "node:buffer";
import { webcrypto } from "node:crypto";
import JSZip from "jszip";
import type { SourceArtifact, CandidateArtifactSnapshot } from "../schemas";
import { buildDownloadBlob, verifyGeneratedArtifact, safeArchivePath } from "./artifact-output-builders";
import { freezeArtifact, readFrozenArtifact } from "./frozen-artifact";
import { putArtifactBlob } from "./artifact-blob-store";

const blobs = vi.hoisted(() => new Map<string, Blob>());
vi.mock("./artifact-blob-store", () => ({getArtifactBlob:async (id:string) => blobs.get(id),putArtifactBlob:async(id:string,blob:Blob) => {blobs.set(id,blob);}}));
beforeEach(() => { blobs.clear(); vi.stubGlobal("Blob",NodeBlob); vi.stubGlobal("crypto",webcrypto); });
const source = (extension = "md") => ({id:"s",name:`sample.${extension}`,extension,artifactKind:extension === "docx" ? "document" : "prompt",mimeType:"text/plain"}) as SourceArtifact;
const snapshot = (content:string) => ({sourceArtifactId:"s",content,name:"candidate"}) as CandidateArtifactSnapshot;

describe("实际文件验证与冻结", () => {
  it("下载读取冻结字节，即使原稿后来改变", async () => {
    const content = "已修改的真实内容";
    const built = await buildDownloadBlob(source(),snapshot(content));
    const checked = await verifyGeneratedArtifact(source(),snapshot(content),built.blob);
    const receipt = await freezeArtifact({sourceArtifactId:"s",content,blob:built.blob,name:built.name,...checked});
    await putArtifactBlob("s",new Blob(["新的原稿"]));
    expect(await (await readFrozenArtifact(receipt,content)).text()).toBe(content);
    expect(receipt.sha256).toHaveLength(64);
  });
  it("内容变化、缺失字节和篡改字节均阻止下载", async () => {
    const receipt = await freezeArtifact({sourceArtifactId:"s",content:"v1",blob:new Blob(["v1"]),name:"x.md",checks:[],limitations:[]});
    await expect(readFrozenArtifact(receipt,"v2")).rejects.toThrow("已变化");
    blobs.delete(receipt.blobId);
    await expect(readFrozenArtifact(receipt,"v1")).rejects.toThrow("不在当前浏览器");
    blobs.set(receipt.blobId,new Blob(["xx"]));
    await expect(readFrozenArtifact(receipt,"v1")).rejects.toThrow("校验不一致");
    await expect(readFrozenArtifact(undefined,"v1")).rejects.toThrow("重新验收");
  });
  it("DOCX 写入文本后重开核对，原包图片保留", async () => {
    const zip = new JSZip();
    zip.file("word/document.xml",'<w:document xmlns:w="urn:test"><w:p><w:r><w:t>原文</w:t></w:r></w:p></w:document>');
    zip.file("word/media/image.png",new Uint8Array([1,2,3]));
    await putArtifactBlob("s",new Blob([new Uint8Array(await zip.generateAsync({type:"uint8array"}))]));
    const candidate = snapshot(JSON.stringify({parts:[{path:"word/document.xml",textRuns:["改进后 & 保留事实"]}]}));
    const built = await buildDownloadBlob(source("docx"),candidate);
    expect((await verifyGeneratedArtifact(source("docx"),candidate,built.blob)).checks).toContain("每项请求的修改均已写入");
    const reopened = await JSZip.loadAsync(new Uint8Array(await built.blob.arrayBuffer()));
    expect(await reopened.file("word/media/image.png")!.async("uint8array")).toEqual(new Uint8Array([1,2,3]));
  });
  it("缺失段落、超出范围或重复的文字索引不能静默成功", async () => {
    const zip = new JSZip(); zip.file("word/document.xml",'<w:t xmlns:w="urn:test">原文</w:t>');
    await putArtifactBlob("s",new Blob([new Uint8Array(await zip.generateAsync({type:"uint8array"}))]));
    await expect(buildDownloadBlob(source("docx"),snapshot(JSON.stringify({parts:[{path:"missing",textRuns:["新版"]}]})))).rejects.toThrow("原文件没有");
    for (const runs of [[{index:9,text:"新版"}],[{index:0,text:"甲"},{index:0,text:"乙"}]]) {
      await expect(buildDownloadBlob(source("docx"),snapshot(JSON.stringify({parts:[{path:"word/document.xml",textRuns:runs}]})))).rejects.toThrow("文本位置无效");
    }
  });
  it("不能将纯文本伪装成 ODT 原格式", async () => {
    await expect(buildDownloadBlob({...source("odt"),artifactKind:"document"},snapshot("新内容"))).rejects.toThrow("当前需要外部");
  });
  it("拒绝路径逃逸、绝对路径和 Windows 路径", () => {
    for (const path of ["../x","/x","C:/x","src\\x","src/../x","src//x",""]) expect(safeArchivePath(path)).toBe(false);
    expect(safeArchivePath("src/中文界面.tsx")).toBe(true);
  });
});
