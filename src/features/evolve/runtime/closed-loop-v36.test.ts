import { evidenceFingerprint } from "./evidence-binding";
import { assertDeliverablePackageIdentity, materializeAcceptedCandidatePackage, materializeAcceptedChampionPackage } from "@evolution/core";
import { buildDeliverableZip } from "./artifact-output-builders";
import { describe, expect, it } from "vitest";
import { demoProject } from "../data/mock-project";
import { CandidateArtifactSnapshotSchema, CandidateSchema, EvolveProjectSchema, OutputArtifactSchema, type SourceArtifact, type SearchChampion } from "../schemas";
import { deliveryReadiness } from "./delivery-readiness";
import { stepCompleted, stepUnlocked } from "./real-evolution-workflow";
import { buildCandidateDeterministically, normalizeCandidateArtifactOutputs, repairHtmlEnvelope } from "./candidate-builder";
import { resetDownstream } from "./downstream";
import { acceptanceArtifacts } from "./artifact-quality";

function ready() {
  const project = EvolveProjectSchema.parse({ ...demoProject,
    experimentRun: { ...demoProject.experimentRun, winnerId: "C" },
    validationRun: { ...demoProject.validationRun, status: "completed", validationMode: "full", candidateId: "C", recommendation: "release", evaluation: demoProject.baselineRun.result },
    artifactAcceptance: { ...demoProject.artifactAcceptance, candidateId: "C", status: "passed", hardGatePass: true },
  });
  project.candidates = [CandidateSchema.parse({ id: "C", name: "candidate", change: "edit", artifactSnapshots: [CandidateArtifactSnapshotSchema.parse({ id: "s", sourceArtifactId: "demo-prompt", name: "page.md", mimeType: "text/markdown", content: "tested content", contentHash: "caller-hash", buildMode: "deterministic", createdAt: "now" })] })];
  project.validationRun.runs = project.hiddenEvalSuite.map((testCase) => ({testCaseId:testCase.id,output:"ok",latencyMs:1,cost:0,trace:[],verificationStatus:"verified"}));
  project.validationRun.baselineRuns = project.validationRun.runs.map((run) => ({...run}));
  project.validationRun.baselineEvaluation = project.baselineRun.result;
  project.validationRun.baselineSuiteIds = project.hiddenEvalSuite.map((testCase) => testCase.id);
  project.validationRun.baselineContextFingerprint = "same-paper";
  project.validationRun.baselineObservedAt = 123456;
  project.artifactAcceptance.frozenArtifacts = [{
    sourceArtifactId: "demo-prompt", snapshotHash: "snapshot-proof", blobId: "blob-proof",
    name: "page.md", mimeType: "text/markdown", sha256: "bytes-proof", size: 14,
    verifiedAt: "2026-09-20T00:00:00Z", checks: ["roundtrip"], limitations: [],
  }];  const binding = evidenceFingerprint(project, project.candidates[0]);
  project.validationRun.evidenceFingerprint = binding;
  project.artifactAcceptance.evidenceFingerprint = binding;
  expect(project.sourceArtifacts.find((item) => item.id === "demo-prompt")).toMatchObject({
    name: "research-agent-system-prompt.md", extension: "md", mimeType: "text/markdown",
  });
  // Synthetic receipts start valid so each rejection below exercises its intended boundary.
  expect(deliveryReadiness(project).ready).toBe(true);
  return project;
}
function source(extension: string, textContent: string) {
  return { id: "s", name: `sample.${extension}`, extension, mimeType: extension === "html" ? "text/html" : "text/markdown", textContent } as SourceArtifact;
}
function candidate(operation: "add" | "update", target: string, content: string) {
  return CandidateSchema.parse({ id: "C", name: "test", change: "edit", patches: [{ id: "p", component: "code", operation, target, content, rationale: "test" }] });
}

describe("真实交付闭环", () => {
  it("已验收但未夺冠的单轮候选交付自身文件、评分和清单", () => {
    const project = ready();
    project.searchChampion = { id: "old-champion", versionLabel: "S1", candidate: { id: "old" } } as SearchChampion;
    const candidate = project.candidates[0]!;
    const artifacts = materializeAcceptedCandidatePackage(project, candidate, project.artifactAcceptance);
    expect(new Set(artifacts.map((item) => item.candidateId))).toEqual(new Set([candidate.id]));
    expect(artifacts.every((item) => item.accepted && !item.isChampion)).toBe(true);
    expect(artifacts.find((item) => item.kind === "primary")?.content).toBe("tested content");
    const manifest = JSON.parse(artifacts.find((item) => item.kind === "manifest")!.content);
    expect(manifest).toMatchObject({ packageKind: "accepted-candidate", candidateId: candidate.id, currentSearchChampionId: "old-champion" });
    expect(artifacts.find((item) => item.kind === "scorecard")?.name).toBe("candidate-scorecard.json");
    project.outputArtifacts = artifacts;
    expect(assertDeliverablePackageIdentity(project)).toBe(candidate.id);
  });
  it("当前 Champion 的完整成果包仍通过 exact 身份检查", () => {
    const project=ready();
    const candidate=project.candidates[0]!;
    project.validationRun.evaluation=project.baselineRun.result;
    project.searchChampion={id:"champ-C",versionLabel:"S1",round:1,score:90,candidate,
      evaluation:project.validationRun.evaluation,validation:project.validationRun,
      artifactAcceptance:project.artifactAcceptance,patches:[],reason:"accepted",selectedAt:"2026-09-20T00:00:00Z"} as SearchChampion;
    project.outputArtifacts=materializeAcceptedChampionPackage(project);
    expect(project.outputArtifacts.every((item)=>item.isChampion&&item.candidateId===candidate.id)).toBe(true);
    expect(assertDeliverablePackageIdentity(project)).toBe(candidate.id);
  });
  it("ZIP 拒绝混装旧 Champion 元数据与新候选主文件", async () => {
    const project = ready();
    const candidate = project.candidates[0]!;
    const artifacts = materializeAcceptedCandidatePackage(project, candidate, project.artifactAcceptance);
    project.outputArtifacts = artifacts.map((item) => item.kind === "manifest" ? { ...item, candidateId: "old" } : item);
    expect(() => assertDeliverablePackageIdentity(project)).toThrow(/候选身份不一致/);
    await expect(buildDeliverableZip(project)).rejects.toThrow(/候选身份不一致/);
  });
  it.each([["page.txt", "text/plain"], ["page.html", "text/html"]])("Markdown Target 共同改成 %s 后仍禁止交付，即使重新绑定证据", (name, mimeType) => {
    const project = ready();
    const candidate = project.candidates[0]!;
    const snapshot = candidate.artifactSnapshots[0]!;
    const receipt = project.artifactAcceptance.frozenArtifacts![0]!;
    snapshot.name = receipt.name = name;
    snapshot.mimeType = receipt.mimeType = mimeType;
    const binding = evidenceFingerprint(project, candidate);
    project.validationRun.evidenceFingerprint = binding;
    project.artifactAcceptance.evidenceFingerprint = binding;
    expect(snapshot.content).toBe("tested content");
    expect(project.artifactAcceptance.status).toBe("passed");
    expect(deliveryReadiness(project).ready).toBe(false);
    expect(stepUnlocked(project, "deliver")).toBe(false);
    expect(acceptanceArtifacts(project, candidate, project.artifactAcceptance).every((item) => !item.accepted)).toBe(true);
    expect(() => materializeAcceptedCandidatePackage(project, candidate, project.artifactAcceptance)).toThrow(/冻结身份尚未一致/);
  });
  it("候选验收绑定失效时不生成已接受交付包", () => {
    const project = ready();
    project.validationRun.evidenceFingerprint = "stale";
    expect(() => materializeAcceptedCandidatePackage(project, project.candidates[0]!, project.artifactAcceptance)).toThrow(/冻结身份尚未一致/);
  });
  it("同一候选通过两类验收后才解锁交付", () => {
    expect(deliveryReadiness(ready()).ready).toBe(true);
    expect(stepUnlocked(ready(), "deliver")).toBe(true);
  });
  it.each(["hold", "reject"] as const)("验证完成但结论为 %s 不可交付", recommendation => {
    const project = ready(); project.validationRun.recommendation = recommendation;
    expect(stepUnlocked(project, "deliver")).toBe(false);
    expect(stepCompleted(project, "verify")).toBe(false);
  });
  it("候选不一致或必要门槛失败均阻断", () => {
    const project = ready(); project.validationRun.candidateId = "older";
    expect(deliveryReadiness(project).ready).toBe(false);
    project.validationRun.candidateId = "C"; project.artifactAcceptance.hardGatePass = false;
    expect(deliveryReadiness(project).ready).toBe(false);
  });
  it("缺少完整 Hidden 评测结果时，release 建议不能解锁交付或成果包", () => {
    const project=ready();
    project.validationRun.evaluation=undefined;
    expect(deliveryReadiness(project).ready).toBe(false);
    expect(acceptanceArtifacts(project,project.candidates[0]!,project.artifactAcceptance).every((item)=>!item.accepted)).toBe(true);
    expect(()=>materializeAcceptedCandidatePackage(project,project.candidates[0]!,project.artifactAcceptance)).toThrow(/冻结身份尚未一致/);
  });
  it("演示评测不能解锁真实交付", () => {
    const project = ready(); project.validationRun.evaluation = { ...demoProject.baselineRun.result!, demoJudged: true };
    expect(deliveryReadiness(project).ready).toBe(false);
    const outputs = acceptanceArtifacts(project, candidate("update", "old text", "new text"), project.artifactAcceptance);
    expect(outputs.every(output => !output.accepted)).toBe(true);
  });
  it("HTML 新增基于原文件合并为完整文档", () => {
    const result = buildCandidateDeterministically(candidate("add", "说明", "<section>new body</section>"), [source("html", "<!doctype html><html><head><style>.old{color:red}</style></head><body><main>old</main></body></html>")]);
    expect(result?.snapshots[0]?.content).toContain("<main>old</main>");
    expect(result?.snapshots[0]?.content).toContain("<section>new body</section>");
    expect(result?.snapshots[0]?.content).toContain("<style>.old{color:red}</style>");
    expect(result?.snapshots[0]?.content).toMatch(/<\/body>\s*<\/html>/);
  });
  it("HTML 纯文本新增会编码为可运行内容，不注入脚本标签", () => {
    const result = buildCandidateDeterministically(candidate("add", "说明", "配置 <script>alert(1)</script>"), [source("html", "<html><body>old</body></html>")]);
    expect(result?.snapshots[0]?.content).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
  });
  it("AI 遗漏 HTML 包装时保留原 head，并把局部片段安全合并回完整文档", () => {
    const original = "<!doctype html><html lang=zh><head><style>.old{color:red}</style></head><body>old</body></html>";
    const repaired = repairHtmlEnvelope(original, "```html\n<body><main>new</main>\n```");
    expect(repaired).toContain("<html lang=zh>");
    expect(repaired).toContain("<style>.old{color:red}</style>");
    expect(repaired).toContain("<body><main>new</main></body></html>");
    const fragment = repairHtmlEnvelope(original, "<section>fragment</section>");
    expect(fragment).toContain("<body>old\n<section>fragment</section>\n</body></html>");
  });
  it("AI 返回 main 片段时替换原 main，不重复页面其他结构", () => {
    const original = "<!doctype html><html><head><title>保留</title></head><body><header>导航</header><main>旧内容</main><footer>页脚</footer></body></html>";
    const repaired = repairHtmlEnvelope(original, "<style>main{line-height:1.6}</style><main><section>新内容</section></main>");
    expect(repaired).toContain("<title>保留</title>");
    expect(repaired).toContain("<header>导航</header>");
    expect(repaired).toContain("<main><section>新内容</section></main>");
    expect(repaired.match(/<main\b/g)).toHaveLength(1);
    expect(repaired).toContain("main{line-height:1.6}");
  });
  it("AI 自动修复仅返回 CSS 时合并回原 HTML 并保持文件可运行", () => {
    const original = "<!doctype html><html><head><style>body { color: #222; }</style></head><body><main>原内容</main></body></html>";
    const repaired = repairHtmlEnvelope(original, "```css\nbody{line-height:1.6;color:#111}\n```");
    expect(repaired).toContain("<main>原内容</main>");
    expect(repaired).toContain("body{line-height:1.6;color:#111}");
    expect(repaired).toMatch(/<html[\s\S]*<body[\s\S]*<\/body>\s*<\/html>/i);
  });
  it("同一目标的多段 AI 输出归并为一份完整可运行成果", () => {
    const original = source("html", "<!doctype html><html><head><title>保留</title></head><body><main>旧内容</main></body></html>");
    const outputs = normalizeCandidateArtifactOutputs([original], [
      { sourceArtifactId: "wrong-id-1", name: "fragment.html", mimeType: "text/html", content: "<main>新内容</main>", buildMode: "ai-full", notes: ["正文"] },
      { sourceArtifactId: "wrong-id-2", name: "styles.css", mimeType: "text/css", content: "body{line-height:1.6}", buildMode: "ai-full", notes: ["样式"] },
    ]);
    expect(outputs).toHaveLength(1);
    expect(outputs[0]?.sourceArtifactId).toBe(original.id);
    expect(outputs[0]?.content).toContain("<title>保留</title>");
    expect(outputs[0]?.content).toContain("<main>新内容</main>");
    expect(outputs[0]?.content).toContain("body{line-height:1.6}");
    expect(outputs[0]?.notes.at(-1)).toContain("2 段局部修改");
  });
  it("重复原文不能只修改第一个匹配", () => {
    expect(buildCandidateDeterministically(candidate("update", "same text", "new text"), [source("html", "same text + same text")])).toBeUndefined();
  });
  it("完全无变化的候选不能报告构造成功", () => {
    expect(buildCandidateDeterministically(candidate("update", "old text", "old text"), [source("md", "old text")])).toBeUndefined();
  });
  it("精确修改与 Markdown 新增仍可使用", () => {
    expect(buildCandidateDeterministically(candidate("update", "old text", "new text"), [source("html", "<html><body>old text</body></html>")])?.snapshots[0]?.content).toContain("new text");
    expect(buildCandidateDeterministically(candidate("add", "说明", "new body"), [source("md", "# 原文\nold text")])?.snapshots[0]?.content).toContain("new body");
  });
  it("输入变化使结论失效，但保留历史成果且不重复归档", () => {
    const project = ready();
    project.outputArtifacts = [OutputArtifactSchema.parse({ id: "o", projectId: project.id, round: 1, versionLabel: "S1", name: "old.md", mimeType: "text/markdown", kind: "primary", content: "old", description: "已验证", accepted: true, isChampion: true, createdAt: "2026-09-11" })];
    const reset = resetDownstream(project);
    expect(deliveryReadiness(reset).ready).toBe(false);
    expect(reset.outputArtifacts).toHaveLength(0);
    expect(reset.archivedOutputs?.[0]).toMatchObject({ accepted: true, isChampion: false, content: "old" });
    expect(EvolveProjectSchema.parse(resetDownstream(reset)).archivedOutputs).toHaveLength(1);
  });
});

it("rejects same-ID changed contents even when the supplied contentHash is unchanged", () => {
  const project = ready();
  project.candidates[0].artifactSnapshots[0].content = "untested content";
  expect(deliveryReadiness(project).ready).toBe(false);
});
it("requires revalidation after the acceptance contract changes but not score display updates", () => {
  const project = ready();
  if (project.metrics.length) project.metrics[0].value += 1;
  expect(deliveryReadiness(project).ready).toBe(true);
  project.protectedItems.push("new protection requirement");
  expect(deliveryReadiness(project).ready).toBe(false);
});
it("legacy unbound proof cannot authorize final delivery", () => {
  const project = ready();
  project.validationRun.evidenceFingerprint = undefined;
  expect(deliveryReadiness(project).ready).toBe(false);
});

it("交付就绪与成果包拒绝重复、额外或缺失的冻结凭证", () => {
  for (const mutate of [
    (project:ReturnType<typeof ready>) => { project.artifactAcceptance.frozenArtifacts = []; },
    (project:ReturnType<typeof ready>) => { project.artifactAcceptance.frozenArtifacts!.push({...project.artifactAcceptance.frozenArtifacts![0]!}); },
    (project:ReturnType<typeof ready>) => { project.artifactAcceptance.frozenArtifacts!.push({...project.artifactAcceptance.frozenArtifacts![0]!, sourceArtifactId:"unrelated"}); },
  ]) {
    const project = ready();
    mutate(project);
    expect(deliveryReadiness(project).ready).toBe(false);
    expect(acceptanceArtifacts(project, project.candidates[0]!, project.artifactAcceptance).every((item) => !item.accepted)).toBe(true);
  }
});

it("交付就绪拒绝重复候选快照，即使验证指纹重新计算", () => {
  const project = ready();
  const candidate = project.candidates[0]!;
  candidate.artifactSnapshots.push({...candidate.artifactSnapshots[0]!, id:"duplicate-snapshot"});
  const binding=evidenceFingerprint(project,candidate);
  project.validationRun.evidenceFingerprint=binding;
  project.artifactAcceptance.evidenceFingerprint=binding;
  expect(deliveryReadiness(project).ready).toBe(false);
  expect(acceptanceArtifacts(project,candidate,project.artifactAcceptance).every((item)=>!item.accepted)).toBe(true);
});
it("交付就绪拒绝与已验收凭证不符的候选冻结记录", () => {
  const project = ready();
  project.candidates[0]!.artifactSnapshots[0]!.frozenArtifact = {
    ...project.artifactAcceptance.frozenArtifacts![0]!, blobId:"different-blob",
  };
  expect(deliveryReadiness(project).ready).toBe(false);
  expect(acceptanceArtifacts(project, project.candidates[0]!, project.artifactAcceptance).every((item) => !item.accepted)).toBe(true);
});
it("旧验收不能给改写后的同 ID 文件标记已接受", () => {
  const project = ready();
  project.candidates[0].artifactSnapshots[0].content = "changed after acceptance";
  expect(acceptanceArtifacts(project, project.candidates[0], project.artifactAcceptance).every(item => !item.accepted)).toBe(true);
});
