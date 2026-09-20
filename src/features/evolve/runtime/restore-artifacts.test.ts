import { beforeEach, expect, it, vi } from "vitest";
import { Blob as NodeBlob } from "node:buffer";
import { webcrypto } from "node:crypto";
import type { EvolveProject, EvolvedVersion } from "../schemas";
import { restoreVersionArtifacts } from "./restore-artifacts";
import { readFrozenArtifact } from "./frozen-artifact";

const blobs = vi.hoisted(() => new Map<string, Blob>());
vi.mock("./artifact-blob-store", () => ({
  getArtifactBlob:async (id:string) => blobs.get(id),
  putArtifactBlob:async (id:string,blob:Blob) => {blobs.set(id,blob);},
  putArtifactBlobs:async (entries:Array<{id:string;blob:Blob}>) => {for(const item of entries) blobs.set(item.id,item.blob);},
}));
vi.mock("../sources/extract", () => ({extractSource:async ({buffer}:{buffer:Uint8Array}) => ({extractedText:new TextDecoder().decode(buffer),excerpt:"恢复后的摘要",structure:[],warnings:[],extension:"md",artifactKind:"document"})}));
beforeEach(() => {blobs.clear();vi.stubGlobal("Blob",NodeBlob);vi.stubGlobal("crypto",webcrypto);});
const project = () => ({sourceArtifacts:[{id:"s",role:"target",name:"guide.md",extension:"md",mimeType:"text/plain",textContent:"当前内容",openaiFileId:"old-remote"}]}) as EvolveProject;
const version = () => ({label:"旧版",artifacts:[{sourceArtifactId:"s",content:"历史内容"}]}) as EvolvedVersion;

it("恢复实际文件并重新提取内容，保存恢复前的原文件",async () => {
  blobs.set("s",new Blob(["当前内容"]));
  const result = await restoreVersionArtifacts(project(),version());
  expect(await blobs.get("s")!.text()).toBe("历史内容");
  expect(result.sources[0].textContent).toBe("历史内容");
  expect(result.sources[0].openaiFileId).toBeUndefined();
  expect(await (await readFrozenArtifact(result.backups[0].frozenArtifact,"当前内容")).text()).toBe("当前内容");
});
it("缺少某个历史文件时不覆盖任何当前文件",async () => {
  const p=project();p.sourceArtifacts.push({...p.sourceArtifacts[0],id:"missing"});
  blobs.set("s",new Blob(["当前内容"]));
  await expect(restoreVersionArtifacts(p,version())).rejects.toThrow("无法完整恢复");
  expect(await blobs.get("s")!.text()).toBe("当前内容");
});
it("没有冻结原格式文件时拒绝从历史文本伪造 Office 文件",async () => {
  const p=project();p.sourceArtifacts[0].extension="docx";
  await expect(restoreVersionArtifacts(p,version())).rejects.toThrow("没有原格式文件");
});
