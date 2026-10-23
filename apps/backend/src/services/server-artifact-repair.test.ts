// @vitest-environment node
import JSZip from "jszip";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AcceptanceCriterionSchema, CandidateSchema, SourceArtifactSchema, type CandidateArtifactSnapshot, type EvolveProject } from "@evolution/contracts";
import { repairServerArtifactCandidate } from "./server-artifact-acceptance";
import { serverArtifactSha256, verifyServerCandidateFrozenArtifact } from "./server-experiment-artifacts";
import {evidenceFingerprint} from "@evolution/core";
import {acceptedPackageFixture} from "@evolution/testkit";

const { blobs, ai, put } = vi.hoisted(() => ({ blobs: new Map<string, Blob>(), ai: vi.fn(), put: vi.fn() }));
vi.mock("./artifact-runtime", () => ({ getServerArtifactStore: () => ({ get: async (id: string) => blobs.get(id), put }) }));
vi.mock("./ai-gateway", () => ({ runServerAi: ai }));
const before = '<p id="refund-approval">主管确认退款后才进入执行。</p>';
const after = '<p id="refund-approval">主管确认退款后才进入执行，并记录审批编号。</p>';
const current = '<html><body><p id="prior-improvement">保留已完成的改进。</p>' + '<p>保留每个章节和原有说明。</p>'.repeat(10000) + before + '</body></html>';
const failed = AcceptanceCriterionSchema.parse({ id: "REFUND", title: "退款审批编号", requirement: "主管确认退款后记录审批编号", artifactIds: ["source"] });
const edits = (from = before, to = after) => JSON.stringify({ kind: "text-edits", edits: [{ before: from, after: to }] });
const output = (content = edits()) => ({ summary: "修复退款编号", repairedCriteria: [failed.id], artifacts: [{ sourceArtifactId: "source", name: "repaired.html", mimeType: "text/html", content, notes: [] }] });
async function snapshot(sourceArtifactId: string, content: string, blob = new Blob([content], { type: "text/html" }), name = "tested.html"): Promise<CandidateArtifactSnapshot> {
  const sha256 = await serverArtifactSha256(await blob.arrayBuffer());
  const contentHash = await serverArtifactSha256(new TextEncoder().encode(content));
  const blobId = `tested:${sha256}`;
  blobs.set(blobId, blob);
  return { id: `snapshot-${sourceArtifactId}`, sourceArtifactId, name, mimeType: blob.type, content, contentHash, buildMode: "ai-full", notes: [], createdAt: "2026-10-08T00:00:00.000Z", frozenArtifact: { sourceArtifactId, snapshotHash: contentHash, blobId, name, mimeType: blob.type, sha256, size: blob.size, verifiedAt: "2026-10-08T00:00:00.000Z", checks: [], limitations: [] } };
}
async function fixture() {
  const source = SourceArtifactSchema.parse({ id: "source", name: "original.html", extension: "html", mimeType: "text/html", artifactKind: "document", role: "target", size: 28, inputMode: "upload", parseStatus: "ready", textContent: "STALE SOURCE INDEX", createdAt: "2026-10-08T00:00:00.000Z" });
  const tested = CandidateSchema.parse({ id: "failed-tested", name: "已测试候选", change: "保留全部文件内容", artifactBuildStatus: "ready", artifactSnapshots: [await snapshot(source.id, current)] });
  const champion = CandidateSchema.parse({ id: "older-champion", name: "旧冠军", change: "旧改进", artifactBuildStatus: "ready", artifactSnapshots: [await snapshot(source.id, '<html><body>OLDER CHAMPION</body></html>')] });
  const project = { id: "repair-mission", name: "修复当前长 HTML", version: "V1", sourceArtifacts: [source], goal: "保留文件并细化退款审批", evolutionCommand: "主管确认退款后记录审批编号", protectedItems: [], editableItems: [], validationRun: { evaluation: { criterionScores: [{ criterionId: failed.id, evidence: ["缺少编号"], gaps: ["主管确认退款后没有审批编号"] }] } }, searchChampion: { candidate: champion } } as unknown as EvolveProject;
  blobs.set(source.id, new Blob(['<html><body>OLD SOURCE</body></html>'], { type: "text/html" }));
  return { project, candidate: tested, failedCriteria: [failed], attempt: 1 };
}
beforeEach(() => { vi.stubEnv("EVOLUTION_AI_FULL_REPAIR_TEXT_MISSIONS","");blobs.clear(); ai.mockReset(); put.mockReset(); put.mockImplementation(async (id: string, blob: Blob) => { blobs.set(id, blob); }); });
afterEach(()=>vi.unstubAllEnvs());

describe("server targeted Artifact repair", () => {
  it("rejects an invented later body-text anchor before freezing any earlier valid edit",async()=>{
    const args=await fixture();
    args.candidate.artifactSnapshots=[await snapshot("source",'<html><body><p>第一段配置</p><p>第二段配置</p><script>保留原脚本</script></body></html>')];
    vi.stubEnv("EVOLUTION_AI_FULL_REPAIR_TEXT_MISSIONS",args.project.id);
    ai.mockImplementation(async(_operation:string,payload:{candidate:{artifacts:Array<{parentSha256:string;htmlTextNodes:Array<{anchorId:string;text:string}>}>}})=>{
      const target=payload.candidate.artifacts[0]!;
      return output(JSON.stringify({kind:"html-text-node-edits",parentSha256:target.parentSha256,
        edits:[...target.htmlTextNodes.map(node=>({anchorId:node.anchorId,text:node.text+"：填写项目名并保存回读。"})),{anchorId:"invented-third-anchor",text:"无法定位"}]}));
    });
    await expect(repairServerArtifactCandidate(args)).rejects.toThrow(/unknown/);
    expect(ai).toHaveBeenCalledTimes(1);expect(put).not.toHaveBeenCalled();
  });
  it.each(["bound","changed-contract","different-candidate","not-authorized","other-mission","invalid-allowlist"] as const)("uses only already measured document observations with a %s repair binding",async kind=>{
    const args=await fixture(),base=acceptedPackageFixture(false).project;
    const complete=current.replace('<p>保留每个章节和原有说明。</p>'.repeat(10000),'<p>保留每个章节和原有说明。</p>');
    args.candidate.artifactSnapshots=[await snapshot("source",kind==="bound"?complete.replace('</body>','<script>PRIVATE_RUNTIME_CODE</script><style>PRIVATE_STYLE_CODE</style></body>'):complete)];
    args.project={...base,...args.project,candidates:[args.candidate],acceptanceRubric:[failed]};
    const outputText="CURRENT CANDIDATE SNAPSHOT EVIDENCE\ncomplete text projection\n\nEXISTING FULL DOCUMENT CONFIGURATION TAIL";
    args.project.validationRun={...base.validationRun,...args.project.validationRun,candidateId:args.candidate.id,
      runs:[{testCaseId:"H1",output:outputText,artifactHash:args.candidate.artifactSnapshots[0]!.frozenArtifact!.sha256,
        verificationStatus:"verified",latencyMs:1,cost:0,trace:[{id:"candidate-semantic-snapshot-H1",stage:"candidate-document-text",status:"pass",summary:"existing measured text"}]}]};
    args.project.validationRun.evidenceFingerprint=evidenceFingerprint(args.project,args.candidate);
    vi.stubEnv("EVOLUTION_AI_FULL_REPAIR_TEXT_MISSIONS",kind==="not-authorized"?"":kind==="other-mission"?"another-mission":kind==="invalid-allowlist"?args.project.id+",*":args.project.id);
    if(kind==="changed-contract")args.project.goal+=" changed";
    if(kind==="different-candidate")args.project.validationRun.candidateId="different";
    ai.mockImplementation(async(_operation:string,payload:{candidate:{artifacts:Array<{content:string;mutationMode:string;parentSha256?:string;htmlTextNodes?:Array<{anchorId:string;text:string}>}>};measuredCandidateDocuments:{observations:Array<{output:string}>}})=>{
      expect(payload.measuredCandidateDocuments.observations).toHaveLength(kind==="bound"?1:0);
      if(kind==="bound")expect(payload.measuredCandidateDocuments.observations[0]!.output).toBe(outputText);
      if(kind==="bound"){
        expect(payload.candidate.artifacts[0]!.content).not.toMatch(/PRIVATE_RUNTIME_CODE|PRIVATE_STYLE_CODE/);
        expect(payload.candidate.artifacts[0]!.mutationMode).toBe("html-text-node-edits");
        expect(JSON.stringify(payload.candidate.artifacts[0]!.htmlTextNodes)).not.toMatch(/PRIVATE_RUNTIME_CODE|PRIVATE_STYLE_CODE/);
      }
      const target=payload.candidate.artifacts[0]!;
      if(target.mutationMode==="html-text-node-edits"){
        const anchor=target.htmlTextNodes!.find(node=>node.text==='主管确认退款后才进入执行。')!;
        return output(JSON.stringify({kind:"html-text-node-edits",parentSha256:target.parentSha256,edits:[{anchorId:anchor.anchorId,text:"主管确认退款后才进入执行，并记录审批编号。"}]}));
      }
      return output();
    });
    const repaired=await repairServerArtifactCandidate(args);
    if(kind==="bound"){
      expect(repaired.artifactSnapshots[0]!.content).toContain('PRIVATE_RUNTIME_CODE');
      expect(repaired.artifactSnapshots[0]!.content).toContain('PRIVATE_STYLE_CODE');
    }
  });
  it("uses bounded failed-Candidate context and preserves its existing improvements in exact frozen bytes", async () => {
    const args = await fixture();
    ai.mockImplementation(async (operation: string, payload: { candidate: { id: string; artifacts: Array<{ content: string; currentVersion: string; originalChars: number; truncated: boolean; mutationMode: string }> } }) => {
      expect(operation).toBe("repair-artifact");
      expect(payload.candidate.id).toBe(args.candidate.id);
      const context = payload.candidate.artifacts[0]!;
      expect(context).toMatchObject({ currentVersion: args.candidate.id, originalChars: current.length, truncated: true, mutationMode: "text-edits" });
      expect(context.content.length).toBeLessThanOrEqual(22000);
      expect(context.content).toContain(before);
      expect(context.content).not.toMatch(/OLDER CHAMPION|OLD SOURCE|STALE SOURCE/);
      return output();
    });
    const repaired = await repairServerArtifactCandidate(args);
    expect(repaired.id).not.toBe(args.candidate.id);
    expect(repaired.status).toBe("draft");
    const file = repaired.artifactSnapshots[0]!;
    expect(file.content).toBe(current.replace(before, after));
    expect(file.content).toContain('id="prior-improvement"');
    expect(await verifyServerCandidateFrozenArtifact(file)).toBe(true);
    expect(await blobs.get(file.frozenArtifact!.blobId)!.text()).toBe(file.content);
    expect(file.frozenArtifact!.sha256).toBe(await serverArtifactSha256(new TextEncoder().encode(file.content)));
  });

  it.each(["missing", "tampered", "receipt-name", "duplicate"])("refuses %s tested-parent identity without falling back to Source or Champion", async (kind) => {
    const args = await fixture();
    const file = args.candidate.artifactSnapshots[0]!;
    if (kind === "missing") blobs.delete(file.frozenArtifact!.blobId);
    if (kind === "tampered") blobs.set(file.frozenArtifact!.blobId, new Blob(["tampered"], { type: file.mimeType }));
    if (kind === "receipt-name") file.frozenArtifact!.name = "different.html";
    if (kind === "duplicate") args.candidate.artifactSnapshots.push({ ...file, id: "duplicate" });
    await expect(repairServerArtifactCandidate(args)).rejects.toThrow(/父代|身份/);
    expect(ai).not.toHaveBeenCalled();
    expect(put).not.toHaveBeenCalled();
  });

  it.each([
    { name: "no-op", result: edits(before, before), error: /完全相同/ },
    { name: "guessed anchor", result: edits('<p id="missing">猜测的内容</p>', after), error: /未找到|锚点|匹配/ },
    { name: "excerpt full rewrite", result: '<html><body>SHORT REWRITE</body></html>', error: /text-edits/ },
  ])("rejects $name before minting frozen repair bytes", async ({ result, error }) => {
    ai.mockResolvedValue(output(result));
    await expect(repairServerArtifactCandidate(await fixture())).rejects.toThrow(error);
    expect(put).not.toHaveBeenCalled();
  });

  it("rejects a claimed repair outside the failed criterion scope", async () => {
    ai.mockResolvedValue({ ...output(), repairedCriteria: ["PROTECTED-OTHER"] });
    await expect(repairServerArtifactCandidate(await fixture())).rejects.toThrow(/out-of-scope/);
    expect(put).not.toHaveBeenCalled();
  });

  it("repairs ZIP bytes from the tested Candidate and retains cumulative changed files", async () => {
    const args = await fixture();
    const zip = new JSZip();
    zip.file("prior.txt", "already improved");
    zip.file("refund.txt", "missing approval id");
    zip.file("untouched.txt", "original unchanged bytes");
    const bytes = await zip.generateAsync({ type: "arraybuffer" });
    const blueprint = JSON.stringify({ kind: "codebase", overlay: true, files: [{ path: "prior.txt", content: "already improved" }], deletions: [] });
    args.project.sourceArtifacts[0] = SourceArtifactSchema.parse({ ...args.project.sourceArtifacts[0], name: "original.zip", extension: "zip", mimeType: "application/zip", artifactKind: "codebase", size: bytes.byteLength });
    args.candidate.artifactSnapshots = [await snapshot("source", blueprint, new Blob([bytes], { type: "application/zip" }), "tested.zip")];
    blobs.delete("source");
    ai.mockResolvedValue({ ...output(), artifacts: [{ sourceArtifactId: "source", name: "repaired.zip", mimeType: "application/zip", content: JSON.stringify({ kind: "codebase", overlay: true, files: [{ path: "refund.txt", content: "approval id required" }], deletions: [] }), notes: [] }] });
    const repaired = await repairServerArtifactCandidate(args);
    const file = repaired.artifactSnapshots[0]!;
    const actual = await JSZip.loadAsync(await blobs.get(file.frozenArtifact!.blobId)!.arrayBuffer(), { checkCRC32: true });
    expect(await actual.file("prior.txt")!.async("string")).toBe("already improved");
    expect(await actual.file("refund.txt")!.async("string")).toBe("approval id required");
    expect(await actual.file("untouched.txt")!.async("string")).toBe("original unchanged bytes");
    expect(JSON.parse(file.content).files).toEqual([{ path: "prior.txt", content: "already improved" }, { path: "refund.txt", content: "approval id required" }]);
    expect(await verifyServerCandidateFrozenArtifact(file)).toBe(true);
  });

  it("keeps another large target unchanged through a no-op excerpt edit", async () => {
    const args = await fixture();
    const other = SourceArtifactSchema.parse({ ...args.project.sourceArtifacts[0], id: "other", name: "protected.html" });
    const inherited = await snapshot(other.id, current);
    args.project.sourceArtifacts.push(other);
    args.candidate.artifactSnapshots.push(inherited);
    ai.mockResolvedValue({ ...output(), artifacts: [...output().artifacts, { sourceArtifactId: other.id, name: inherited.name, mimeType: inherited.mimeType, content: edits(before, before), notes: [] }] });
    const repaired = await repairServerArtifactCandidate(args);
    expect(repaired.artifactSnapshots[1]!.content).toBe(current);
    expect(repaired.artifactSnapshots[1]!.frozenArtifact).toEqual(inherited.frozenArtifact);
    expect(put).toHaveBeenCalledTimes(1);
  });
  it("repairs an HTML Target while preserving a frozen CSV Target with exact bytes",async()=>{
    const args=await fixture();
    const tableText="code,total\n000123,5\n000124,9\n";
    const csv=SourceArtifactSchema.parse({
      ...args.project.sourceArtifacts[0],id:"csv",name:"protected.csv",extension:"csv",mimeType:"text/csv",
      artifactKind:"spreadsheet",role:"target",size:Buffer.byteLength(tableText),
      structuredContent:{kind:"spreadsheet",sheets:[{name:"Sheet1",cells:[
        {address:"A1",value:"code"},{address:"B1",value:"total"},
        {address:"A2",value:"000123"},{address:"B2",value:5},
        {address:"A3",value:"000124"},{address:"B3",value:9},
      ]}]},
    });
    const keep=JSON.stringify({kind:"keep-parent",sourceArtifactId:csv.id});
    const csvSnapshot=await snapshot(csv.id,keep,new Blob([tableText],{type:csv.mimeType}),csv.name);
    args.project.sourceArtifacts.push(csv);
    args.candidate.artifactSnapshots.push(csvSnapshot);
    ai.mockImplementation(async(operation:string,payload:{instruction:string,candidate:{artifacts:Array<{sourceArtifactId:string;structuredContext?:unknown}>}})=>{
      expect(operation).toBe("repair-artifact");
      expect(payload.instruction).toContain("keep-parent");
      expect(payload.instruction).toContain("Sheet/A1");
      expect(payload.candidate.artifacts.find(item=>item.sourceArtifactId===csv.id)?.structuredContext)
        .toMatchObject({kind:"spreadsheet",sheets:[{name:"Sheet1"}]});
      return {...output(),artifacts:[...output().artifacts,{
        sourceArtifactId:csv.id,name:csv.name,mimeType:csv.mimeType,content:keep,notes:[],
      }]};
    });
    const repaired=await repairServerArtifactCandidate(args);
    const preserved=repaired.artifactSnapshots.find(item=>item.sourceArtifactId===csv.id)!;
    expect(preserved.frozenArtifact?.blobId).toBe(csvSnapshot.frozenArtifact?.blobId);
    expect(await verifyServerCandidateFrozenArtifact(preserved)).toBe(true);
    expect(await blobs.get(preserved.frozenArtifact!.blobId)!.text()).toBe(tableText);
    expect(put).toHaveBeenCalledTimes(1);
  });

  it("reindexes all frozen CSV revisions before a targeted repair",async()=>{
    const args=await fixture();
    const original={kind:"spreadsheet",sheets:[{name:"Sheet1",cells:[
      {address:"A1",value:"code"},{address:"B1",value:"value"},
      {address:"A2",value:"000123"},{address:"B2",value:5},
      {address:"A3",value:"000124"},{address:"B3",value:9},
    ]}]};
    const csv=SourceArtifactSchema.parse({...args.project.sourceArtifacts[0],
      id:"csv",name:"history.csv",extension:"csv",mimeType:"text/csv",
      artifactKind:"spreadsheet",structuredContent:original,
    });
    const full="code,value\n000123,15\n000124,19\n";
    const latestOnly=JSON.stringify({kind:"spreadsheet",sheets:[{name:"Sheet1",cells:[{address:"B3",value:19}]}]});
    const inherited=await snapshot(csv.id,latestOnly,new Blob([full],{type:csv.mimeType}),csv.name);
    args.project.sourceArtifacts.push(csv);
    args.candidate.artifactSnapshots.push(inherited);
    ai.mockImplementation(async(_operation:string,payload:{candidate:{artifacts:Array<{sourceArtifactId:string;structuredContext?:unknown}>}})=>{
      const structured=payload.candidate.artifacts.find(item=>item.sourceArtifactId===csv.id)!.structuredContext as {
        sheets:Array<{cells:Array<{address:string;value?:unknown}>}>;
      };
      const value=(address:string)=>structured.sheets[0]!.cells.find(cell=>cell.address===address)?.value;
      // Raw CSV retains exact text field values including leading zeros.
      expect(value("B2")).toBe("15");
      expect(value("B3")).toBe("19");
      expect(value("A2")).toBe("000123");
      return {...output(),artifacts:[...output().artifacts,{
        sourceArtifactId:csv.id,name:csv.name,mimeType:csv.mimeType,
        content:JSON.stringify({kind:"keep-parent",sourceArtifactId:csv.id}),notes:[],
      }]};
    });
    const result=await repairServerArtifactCandidate(args);
    const preserved=result.artifactSnapshots.find(item=>item.sourceArtifactId===csv.id)!;
    expect(preserved.frozenArtifact?.sha256).toBe(inherited.frozenArtifact?.sha256);
    expect(await verifyServerCandidateFrozenArtifact(preserved)).toBe(true);
  });

  it("preserves an unrelated target's exact frozen receipt during a scoped repair", async () => {
    const args = await fixture();
    const other = SourceArtifactSchema.parse({ ...args.project.sourceArtifacts[0], id: "other", name: "protected.md", extension: "md", mimeType: "text/markdown" });
    const inherited = await snapshot(other.id, "already accepted content", new Blob(["already accepted content"], { type: other.mimeType }), "protected.md");
    args.project.sourceArtifacts.push(other);
    args.candidate.artifactSnapshots.push(inherited);
    ai.mockResolvedValue({ ...output(), artifacts: [...output().artifacts, { sourceArtifactId: other.id, name: inherited.name, mimeType: inherited.mimeType, content: inherited.content, notes: [] }] });
    const repaired = await repairServerArtifactCandidate(args);
    const preserved = repaired.artifactSnapshots.find((file) => file.sourceArtifactId === other.id)!;
    expect(preserved.content).toBe(inherited.content);
    expect(preserved.frozenArtifact).toEqual(inherited.frozenArtifact);
    expect(put).toHaveBeenCalledTimes(1);
    expect(await verifyServerCandidateFrozenArtifact(preserved)).toBe(true);
  });
});
