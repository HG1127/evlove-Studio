import { describe, expect, it } from "vitest";
import { AcceptanceCriterionSchema, CandidateSchema } from "../schemas";
import { demoProject } from "../data/mock-project";
import { getAiProviderStatus } from "../ai/service";
import { getTargetAdapter } from "../target/registry";
import type { TestCase } from "@evolution/contracts";
import { runIntake, runBaseline, runAi, runValidation } from "./api";
import { CandidateArtifactBuildError, effectiveExperimentPolicy, executeCandidateAwareCaseSet, executeCaseSet, fastGateCaseLimit, isSimpleLocalTextProject, normalizeLocallyVerifiableCandidateRuns, reusableScreeningRuns, visibleBaselineEvaluationReusable } from "./run-local";

describe("experiment performance policy", () => {
  it("groups identical candidate build failures into one actionable error", () => {
    const failed = ["A", "B"].map((name) => CandidateSchema.parse({ id: name, name, change: "Improve HTML", artifactBuildStatus: "failed", artifactBuildSummary: "模型没有返回最终 content" }));
    const error = new CandidateArtifactBuildError(failed);
    expect(error.message).toContain("A、B：模型没有返回最终 content");
    expect(error.message.match(/模型没有返回最终 content/g)).toHaveLength(1);
    expect(error.candidates).toHaveLength(2);
  });

  it("upgrades only the legacy automatic defaults", () => {
    const legacy = { ...demoProject, campaign: { ...demoProject.campaign, executionMode: "auto-rounds" as const }, experimentPolicy: { mode:"adaptive" as const, finalistCount:3, screeningCaseCount:3, batchSize:4, buildConcurrency:3, batchArtifactRuntime:true } };
    expect(effectiveExperimentPolicy(legacy).finalistCount).toBe(2);
    expect(effectiveExperimentPolicy(legacy).screeningCaseCount).toBe(2);
    expect(effectiveExperimentPolicy(legacy).batchSize).toBe(5);
    expect(effectiveExperimentPolicy({ ...demoProject, experimentPolicy: { ...demoProject.experimentPolicy, finalistCount:4 } }).finalistCount).toBe(4);
  });

  it("uses a two-case Fast Gate for simple TXT documents but keeps the full gate budget for other artifacts", () => {
    const simple = { ...demoProject, objectType:"document" as const, sourceArtifacts:[{ ...demoProject.sourceArtifacts[0]!, artifactKind:"document" as const, name:"workflow.txt", extension:"txt", mimeType:"text/plain", textContent:"完整文本" }] };
    expect(isSimpleLocalTextProject(simple)).toBe(true);
    expect(fastGateCaseLimit(simple)).toBe(2);
    expect(isSimpleLocalTextProject(demoProject)).toBe(false);
    expect(fastGateCaseLimit(demoProject)).toBe(4);
  });

  it("reuses the visible Baseline judge only when test definitions and verified runs are unchanged", () => {
    const verified = {
      ...demoProject,
      baselineRun: { ...demoProject.baselineRun, runs: demoProject.evalSuite.map((test) => ({ testCaseId:test.id, output:"verified", latencyMs:1, cost:0, trace:[], verificationStatus:"verified" as const })) },
    };
    expect(visibleBaselineEvaluationReusable(verified, demoProject.evalSuite)).toBe(true);
    expect(visibleBaselineEvaluationReusable(verified, demoProject.evalSuite.map((test, index) => index === 0 ? { ...test, expected:[...test.expected, "changed"] } : test))).toBe(false);
    expect(visibleBaselineEvaluationReusable({ ...verified, baselineRun:{ ...verified.baselineRun, runs:verified.baselineRun.runs.map((run, index) => index === 0 ? { ...run, error:"timeout" } : run) } }, demoProject.evalSuite)).toBe(false);
    const repeatedRuns = [verified.baselineRun.runs[0]!, { ...verified.baselineRun.runs[0]! }, ...verified.baselineRun.runs.slice(2)];
    expect(visibleBaselineEvaluationReusable({ ...verified, baselineRun: { ...verified.baselineRun, runs: repeatedRuns } }, demoProject.evalSuite)).toBe(false);
    expect(visibleBaselineEvaluationReusable({ ...verified, evalSuite: [verified.evalSuite[0]!, { ...verified.evalSuite[0]! }, ...verified.evalSuite.slice(2)] }, demoProject.evalSuite)).toBe(false);
  });

  it("reuses only exact verified local Smoke evidence in the full suite", () => {
    const local = { ...demoProject.evalSuite[0]!, executionMode:"artifact-runtime" as const };
    const live = { ...demoProject.evalSuite[1]!, executionMode:"external-runner" as const };
    const runs = [
      { testCaseId:local.id, output:"ok", latencyMs:1, cost:0, trace:[], verificationStatus:"verified" as const },
      { testCaseId:live.id, output:"ok", latencyMs:1, cost:0, trace:[], verificationStatus:"verified" as const },
    ];
    const reused = reusableScreeningRuns([local, live], [local, live], runs);
    expect(reused.has(local.id)).toBe(true);
    expect(reused.has(live.id)).toBe(false);
    expect(reusableScreeningRuns([{ ...local, expected:["changed"] }], [local], runs).size).toBe(0);
    expect(reusableScreeningRuns([local], [local], [runs[0]!, { ...runs[0]! }]).size).toBe(0);
    expect(reusableScreeningRuns([local], [local, { ...local }], [runs[0]!]).size).toBe(0);
  });
});

describe("local Target execution identity", () => {
  const result = (testCaseId: string, output: string) => ({ testCaseId, output, latencyMs: 1, cost: 0, trace: [], verificationStatus: "verified" as const });
  const cases = demoProject.evalSuite.slice(0, 2);

  it("keeps each batch bound to the Test Cases it requested", async () => {
    const [a, b] = cases;
    const adapter = {
      runBatch: async ({ testCases }: { testCases: TestCase[] }) => testCases[0]?.id === a!.id
        ? [result(a!.id, "A correct"), result(b!.id, "B extra")]
        : [result(b!.id, "B correct")],
    } as unknown as ReturnType<typeof getTargetAdapter>;
    const runs = await executeCaseSet({ adapter, project: demoProject, testCases: cases, batchSize: 1 });
    expect(runs.map((run) => run.output)).toEqual(["A correct", "B correct"]);
  });

  it("keeps duplicate and missing batch results unverified", async () => {
    const [a, b] = cases;
    const adapter = { runBatch: async () => [result(a!.id, "first"), result(a!.id, "second")] } as unknown as ReturnType<typeof getTargetAdapter>;
    const runs = await executeCaseSet({ adapter, project: demoProject, testCases: cases, batchSize: 2 });
    expect(runs[0]).toMatchObject({ testCaseId: a!.id, verificationStatus: "unverified" });
    expect(runs[1]).toMatchObject({ testCaseId: b!.id, verificationStatus: "unverified" });
    expect(runs.every((run) => Boolean(run.error))).toBe(true);
  });

  it("rejects a single-case response with a different Test Case ID", async () => {
    const adapter = { run: async () => result("wrong-case", "claimed pass") } as unknown as ReturnType<typeof getTargetAdapter>;
    const runs = await executeCaseSet({ adapter, project: demoProject, testCases: cases.slice(0, 1), batchSize: 1 });
    expect(runs[0]).toMatchObject({ testCaseId: cases[0]!.id, verificationStatus: "unverified" });
    expect(runs[0]?.error).toBeTruthy();
  });

  it("requires fixing a duplicate Test Case definition instead of offering a pointless rerun", async () => {
    const testCase = cases[0]!;
    const adapter = { run: async () => result(testCase.id, "claimed pass") } as unknown as ReturnType<typeof getTargetAdapter>;
    const runs = await executeCaseSet({ adapter, project: demoProject, testCases: [testCase, { ...testCase }], batchSize: 1 });
    expect(runs.every((run) => run.verificationStatus === "unverified" && !run.error)).toBe(true);
  });

  it("does not let local snapshot evidence upgrade duplicate Test Case definitions", async () => {
    const criterion = AcceptanceCriterionSchema.parse({ id: "FORMAT", title: "TXT 格式", requirement: "UTF-8 往返", source: "system-integrity", weight: 100, hardGate: true, judgeType: "integrity", validationMethod: "format-roundtrip", minScore: 90, evidenceExpected: ["往返"], protectedConstraint: false, artifactIds: ["txt-source"], category: "artifact-specific" });
    const project = { ...demoProject, sourceArtifacts: [{ ...demoProject.sourceArtifacts[0]!, id: "txt-source", name: "workflow.txt", artifactKind: "document" as const, mimeType: "text/plain", extension: "txt", textContent: "旧内容" }], acceptanceRubric: [criterion] };
    const candidate = CandidateSchema.parse({ id: "TXT-DUP", name: "TXT 新版", change: "优化文本", artifactSnapshots: [{ id: "txt-snapshot", sourceArtifactId: "txt-source", name: "workflow.txt", mimeType: "text/plain", content: "新版内容", createdAt: "2026-09-16T00:00:00.000Z" }] });
    const testCase = { id: "T-FORMAT", title: "TXT 原格式", input: "检查 TXT", expected: ["往返"], tags: [], hidden: true, criterionIds: ["FORMAT"], executionMode: "roundtrip" as const, evidenceScope: "format" as const };
    const adapter = { run: async ({ testCase: requested }: { testCase: TestCase }) => result(requested.id, "claimed pass") } as unknown as ReturnType<typeof getTargetAdapter>;
    const runs = await executeCandidateAwareCaseSet({ adapter, project, testCases: [testCase, { ...testCase }], variant: candidate, batchSize: 1 });
    expect(runs).toHaveLength(2);
    expect(runs.every((run) => run.verificationStatus === "unverified")).toBe(true);
    expect(runs.every((run) => !run.error)).toBe(true);
  });

  it("validates a DOCX SOP from its Candidate blueprint without an executor call", async () => {
    const criterion = AcceptanceCriterionSchema.parse({ id:"DOC-CONFIG", title:"配置流程可理解性", requirement:"配置步骤编号、示例和注意事项清晰", source:"user-command", weight:100, hardGate:true, judgeType:"llm", validationMethod:"user-scenario", minScore:85, evidenceExpected:["步骤编号","示例","注意事项"], protectedConstraint:false, artifactIds:["sop"], category:"outcome" });
    const project = { ...demoProject, objectType:"document" as const, sourceArtifacts:[{
      ...demoProject.sourceArtifacts[0]!, id:"sop", name:"sop.docx", extension:"docx", mimeType:"application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      artifactKind:"document" as const, textContent:"旧版配置流程", artifactDescriptor:{adapterId:"document-docx-ooxml"},
      structuredContent:{kind:"document",subtype:"docx",parts:[{path:"word/document.xml",textRuns:[{index:0,text:"旧版配置流程"}]}]},
    }], acceptanceRubric:[criterion] } as unknown as typeof demoProject;
    const candidate = CandidateSchema.parse({ id:"DOC-C", name:"SOP 新版", change:"补齐配置流程", artifactSnapshots:[{
      id:"doc-snapshot", sourceArtifactId:"sop", name:"sop.docx", mimeType:"application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      content:JSON.stringify({kind:"document",subtype:"docx",parts:[{path:"word/document.xml",textRuns:[{index:0,text:"1. 填写地址。示例：输入项目地址。注意事项：保存后检查。"}]}]}),
      createdAt:"2026-09-27T00:00:00.000Z",
    }] });
    const testCase = { id:"H-DOC-CONFIG", title:"配置流程可理解性", input:"检查文档配置说明", expected:["步骤编号","示例","注意事项"], tags:[], hidden:true, criterionIds:[criterion.id], executionMode:"artifact-runtime" as const, evidenceScope:"product-behavior" as const };
    const adapter = { run: async () => { throw new Error("DOCX 内容检查不应调用外部执行器"); } } as unknown as ReturnType<typeof getTargetAdapter>;
    const runs = await executeCandidateAwareCaseSet({ adapter, project, testCases:[testCase], variant:candidate, batchSize:1 });
    expect(runs[0]?.verificationStatus).toBe("verified");
    expect(runs[0]?.output).toContain("1. 填写地址");
  });
  it("validates the current HTML Candidate content without an executor call", async () => {
    const criterion = AcceptanceCriterionSchema.parse({ id:"HTML-READ", title:"理解难度降低", requirement:"概念解释直白、示例贴近实际", source:"user-command", weight:100, hardGate:true, judgeType:"llm", validationMethod:"user-scenario", minScore:85, evidenceExpected:["直白解释","具体示例"], protectedConstraint:false, artifactIds:["tutorial"], category:"outcome" });
    const project = { ...demoProject, objectType:"document" as const, sourceArtifacts:[{
      ...demoProject.sourceArtifacts[0]!, id:"tutorial", name:"tutorial.html", extension:"html", mimeType:"text/html", artifactKind:"document" as const,
      textContent:"<!doctype html><html><body><h1>旧教程</h1></body></html>",
    }], acceptanceRubric:[criterion] } as typeof demoProject;
    const candidate = CandidateSchema.parse({ id:"HTML-C", name:"教程新版", change:"降低理解难度", artifactSnapshots:[{
      id:"html-snapshot", sourceArtifactId:"tutorial", name:"tutorial.html", mimeType:"text/html",
      content:"<!doctype html><html><body><h1>概念解释</h1><p>用一个实际项目举例说明。</p></body></html>",
      createdAt:"2026-09-27T00:00:00.000Z",
    }] });
    const testCase = { id:"H-HTML-READ", title:"理解难度降低", input:"检查教程的解释和示例", expected:["解释直白","示例贴近实际"], tags:[], hidden:true, criterionIds:[criterion.id], executionMode:"artifact-runtime" as const, evidenceScope:"product-behavior" as const };
    const adapter = { run: async () => { throw new Error("HTML 内容检查不应调用外部执行器"); } } as unknown as ReturnType<typeof getTargetAdapter>;
    const runs = await executeCandidateAwareCaseSet({ adapter, project, testCases:[testCase], variant:candidate, batchSize:1 });
    expect(runs[0]?.verificationStatus).toBe("verified");
    expect(runs[0]?.output).toContain("用一个实际项目举例");
    expect(runs[0]?.output).not.toContain("旧教程");

    const pendingProject = {
      ...project,
      candidates:[candidate],
      evalSuite:[testCase], hiddenEvalSuite:[testCase],
      experimentRun:{...demoProject.experimentRun,status:"completed" as const,pendingEvidenceCandidateId:candidate.id,candidateResults:[]},
    };
    const validation = await runValidation(pendingProject,candidate);
    expect(validation.status).toBe("completed");
    expect(validation.runs.find((run)=>run.testCaseId===testCase.id)?.verificationStatus).toBe("verified");
    expect(validation.evaluation?.unverifiedCriterionIds).not.toContain(criterion.id);
  });
});

describe("browser runtime smoke", () => {
  it("ai status falls back to demo engine", () => {
    const s = getAiProviderStatus();
    expect(s.provider).toBe("demo");
    expect(s.model).toBe("demo-evolve-engine");
  });

  it("intake parses pasted text and returns contract", async () => {
    const form = new FormData();
    form.set("command", "让重要结论都有证据");
    form.set("pastedText", "你是一个研究 Agent。请输出结论。");
    const result = await runIntake(form);
    expect(result.artifacts.length).toBeGreaterThan(0);
    expect(result.intake.goal.length).toBeGreaterThan(0);
  });

  it("baseline runs locally through mock target adapter", async () => {
    const rubric = [
      { id: "REQ-1", title: "重要结论有证据", requirement: "关键结论必须绑定可验证来源", weight: 40, hardGate: true, evidenceExpected: ["结论附来源引用"] },
      { id: "REQ-2", title: "风险分析完整", requirement: "风险分析包含反证与下行情景", weight: 30, evidenceExpected: ["反证条件与下行情景文本"] },
      { id: "REQ-3", title: "成本不显著增加", requirement: "平均成本不明显高于基线", weight: 30, evidenceExpected: ["执行成本记录"] },
    ].map((item) => AcceptanceCriterionSchema.parse(item));
    const project = { ...demoProject, acceptanceRubric: rubric, acceptanceRubricState: { ...demoProject.acceptanceRubricState, status: "ready" as const, weightTotal: 100 }, gates: demoProject.gates.map((g) => g.id === "target-ready" ? { ...g, status: "approved" as const } : g) };
    const suite = await runAi<{ validationCases: unknown[] }>("eval-suite", { project });
    expect(Array.isArray(suite.validationCases)).toBe(true);
    const baseline = await runBaseline({ ...project, evalSuite: demoProject.evalSuite });
    expect(baseline.status).toBe("completed");
    expect(baseline.totalCases).toBeGreaterThan(0);
  });

  it("uses the accepted Search Champion as the next-round Baseline execution target", async () => {
    const rubric = [
      { id: "REQ-1", title: "重要结论有证据", requirement: "关键结论必须绑定可验证来源", weight: 40, hardGate: true, evidenceExpected: ["结论附来源引用"] },
      { id: "REQ-2", title: "风险分析完整", requirement: "风险分析包含反证与下行情景", weight: 30, evidenceExpected: ["反证条件与下行情景文本"] },
      { id: "REQ-3", title: "成本不显著增加", requirement: "平均成本不明显高于基线", weight: 30, evidenceExpected: ["执行成本记录"] },
    ].map((item) => AcceptanceCriterionSchema.parse(item));
    const parent = CandidateSchema.parse({
      id: "C", name: "已验收 Champion", change: "上一轮已验收改进",
      artifactSnapshots: [{ id: "s1", sourceArtifactId: "demo-prompt", name: "research-agent-system-prompt.md", mimeType: "text/markdown", content: "已验收的 S1 Prompt", createdAt: "2026-09-01T00:00:00.000Z" }],
    });
    const project = {
      ...demoProject,
      targetConnection: { adapter: "mock" as const, connectionId: "mock", status: "connected" as const, label: "Mock" },
      acceptanceRubric: rubric,
      acceptanceRubricState: { ...demoProject.acceptanceRubricState, status: "ready" as const, weightTotal: 100 },
      gates: demoProject.gates.map((g) => g.id === "target-ready" ? { ...g, status: "approved" as const } : g),
      searchChampion: {
        id: "champion-s1", versionLabel: "S1", round: 1, score: 90, candidate: parent, patches: [], reason: "validated", selectedAt: "2026-09-01T00:00:00.000Z",
        validation: { id: "v-s1", status: "completed" as const, candidateId: parent.id, runs: [], baselineRuns: [], checks: [], recommendation: "release" as const },
        artifactAcceptance: { id: "a-s1", status: "passed" as const, candidateId: parent.id, overallScore: 90, coverageScore: 90, integrityScore: 100, pairwiseScore: 90, hardGatePass: true, results: [], attempts: 0, maxRepairAttempts: 3, summary: "passed" },
      },
    };
    const baseline = await runBaseline(project);
    expect(baseline.runs.length).toBeGreaterThan(0);
    expect(baseline.runs.every((run) => run.output.includes("实验版本：已验收 Champion"))).toBe(true);
  });

  it("verifies TXT Candidate roundtrip directly from the current snapshot before Frozen Artifact exists", () => {
    const criterion = AcceptanceCriterionSchema.parse({ id:"ART-TXT-FORMAT", title:"TXT 原格式交付", requirement:"最终成果保持 txt 格式", source:"system-integrity", weight:100, hardGate:true, judgeType:"integrity", validationMethod:"format-roundtrip", minScore:90, evidenceExpected:["UTF-8 往返一致"], protectedConstraint:false, artifactIds:["txt-source"], category:"artifact-specific" });
    const candidate = CandidateSchema.parse({ id:"TXT-C1", name:"TXT 新版", change:"优化文本内容", artifactSnapshots:[{ id:"txt-snapshot", sourceArtifactId:"txt-source", name:"workflow.txt", mimeType:"text/plain", content:"第一步：输入\n第二步：验证\n第三步：交付", createdAt:"2026-09-16T00:00:00.000Z" }] });
    const project = { ...demoProject, sourceArtifacts:[{ ...demoProject.sourceArtifacts[0]!, id:"txt-source", name:"workflow.txt", artifactKind:"document" as const, mimeType:"text/plain", extension:"txt", textContent:"旧内容" }], acceptanceRubric:[criterion] };
    const testCase = { id:"txt-roundtrip", title:"TXT 原格式", input:"检查 TXT 是否可原格式交付", expected:["UTF-8 往返一致"], tags:[], hidden:true, criterionIds:[criterion.id], executionMode:"roundtrip" as const, evidenceScope:"format" as const };
    const runs = normalizeLocallyVerifiableCandidateRuns(project, candidate, [testCase], [{ testCaseId:testCase.id, output:"缺少 Frozen Artifact", latencyMs:0, cost:0, trace:[], verificationStatus:"unverified" }], { semanticProviderLive:false });
    expect(runs[0]?.verificationStatus).toBe("verified");
    expect(runs[0]?.output).toContain("CANDIDATE TEXT FORMAT ROUNDTRIP VERIFIED");
    expect(runs[0]?.trace.some((step)=>step.stage==="format-roundtrip"&&step.status==="pass")).toBe(true);
  });

  it("uses the current Candidate TXT snapshot itself as semantic evidence and lets the rubric judge quality", () => {
    const criterion = AcceptanceCriterionSchema.parse({ id:"TXT-QUALITY", title:"最终成果质量", requirement:"文本必须包含完整验收说明", source:"user-command", weight:100, hardGate:true, judgeType:"llm", validationMethod:"semantic-judge", minScore:90, evidenceExpected:["完整验收说明"], protectedConstraint:false, artifactIds:["txt-source"], category:"outcome" });
    const candidate = CandidateSchema.parse({ id:"TXT-C2", name:"TXT 新版", change:"优化文本", artifactSnapshots:[{ id:"txt-snapshot-2", sourceArtifactId:"txt-source", name:"workflow.txt", mimeType:"text/plain", content:"第一步：检查。第二步：完整验收说明。第三步：交付。", createdAt:"2026-09-16T00:00:00.000Z" }] });
    const project = { ...demoProject, sourceArtifacts:[{ ...demoProject.sourceArtifacts[0]!, id:"txt-source", name:"workflow.txt", artifactKind:"document" as const, mimeType:"text/plain", extension:"txt", textContent:"旧内容" }], acceptanceRubric:[criterion] };
    const testCase = { id:"txt-quality", title:"最终成果质量", input:"检查内容是否满足要求", expected:["完整验收说明"], tags:[], hidden:true, criterionIds:[criterion.id], executionMode:"artifact-runtime" as const, evidenceScope:"product-behavior" as const };
    const runs = normalizeLocallyVerifiableCandidateRuns(project, candidate, [testCase], [{ testCaseId:testCase.id, output:"UNVERIFIED：执行器未单独确认语义质量。", latencyMs:20, cost:0.01, trace:[], verificationStatus:"unverified" }], { semanticProviderLive:false });
    expect(runs[0]?.verificationStatus).toBe("verified");
    expect(runs[0]?.output).toContain("CURRENT CANDIDATE SNAPSHOT EVIDENCE");
    expect(runs[0]?.output).toContain("完整验收说明");
    expect(runs[0]?.trace.some((step)=>step.stage==="semantic-evidence"&&step.status==="pass")).toBe(true);
  });

  it("settles a TXT document user-scenario from the current Candidate snapshot instead of looping as unverified", () => {
    const criterion = AcceptanceCriterionSchema.parse({ id:"DOC-SCENARIO", title:"最终成果可用", requirement:"用户能按文档步骤完成目标", source:"user-command", weight:100, hardGate:true, judgeType:"llm", validationMethod:"user-scenario", minScore:90, evidenceExpected:["步骤完整且有完成条件"], protectedConstraint:false, artifactIds:["txt-source"], category:"outcome" });
    const candidate = CandidateSchema.parse({ id:"TXT-SC1", name:"TXT 新版", change:"补齐流程", artifactSnapshots:[{ id:"txt-scenario-snapshot", sourceArtifactId:"txt-source", name:"workflow.txt", mimeType:"text/plain", content:"1. 输入需求。2. 执行并检查结果。3. 验收通过后交付。每一步都有完成条件。", createdAt:"2026-09-16T00:00:00.000Z" }] });
    const project = { ...demoProject, objectType:"document" as const, sourceArtifacts:[{ ...demoProject.sourceArtifacts[0]!, id:"txt-source", name:"workflow.txt", artifactKind:"document" as const, mimeType:"text/plain", extension:"txt", textContent:"旧内容" }], acceptanceRubric:[criterion] };
    const testCase = { id:"txt-user-scenario", title:"最终成果可用", input:"检查用户是否能按文档完成任务", expected:["步骤完整且有完成条件"], tags:[], hidden:true, criterionIds:[criterion.id], executionMode:"artifact-runtime" as const, evidenceScope:"product-behavior" as const };
    const runs = normalizeLocallyVerifiableCandidateRuns(project, candidate, [testCase], [{ testCaseId:testCase.id, output:"UNVERIFIED：未连接外部 Runner", latencyMs:0, cost:0, trace:[], verificationStatus:"unverified" }]);
    expect(runs[0]?.verificationStatus).toBe("verified");
    expect(runs[0]?.output).toContain("CURRENT CANDIDATE SNAPSHOT EVIDENCE");
    expect(runs[0]?.output).toContain("验收通过后交付");
  });

  it("verifies SYS-PAIRWISE from an actual original-vs-candidate TXT snapshot pair", () => {
    const criterion = AcceptanceCriterionSchema.parse({ id:"SYS-PAIRWISE", title:"相对原版真实改进", requirement:"最终成果必须相对原始版本更符合用户进化目标", source:"system-integrity", weight:100, hardGate:true, judgeType:"pairwise", validationMethod:"semantic-judge", minScore:85, evidenceExpected:["Original vs Evolved 对比"], protectedConstraint:false, artifactIds:["txt-source"], category:"outcome" });
    const candidate = CandidateSchema.parse({ id:"TXT-C3", name:"TXT 新版", change:"补齐验收闭环", artifactSnapshots:[{ id:"txt-snapshot-3", sourceArtifactId:"txt-source", name:"workflow.txt", mimeType:"text/plain", content:"新版：输入→处理→自动验证→明确交付。每一步都有完成条件。", createdAt:"2026-09-16T00:00:00.000Z" }] });
    const project = { ...demoProject, evolutionCommand:"补齐验证与交付闭环", sourceArtifacts:[{ ...demoProject.sourceArtifacts[0]!, id:"txt-source", name:"workflow.txt", artifactKind:"document" as const, mimeType:"text/plain", extension:"txt", textContent:"旧版：输入→处理→输出。" }], acceptanceRubric:[criterion] };
    const testCase = { id:"txt-pairwise", title:"相对原版真实改进", input:"比较原版和新版是否更符合进化目标", expected:["新版相对原版有可定位改进"], tags:[], hidden:true, criterionIds:[criterion.id], executionMode:"artifact-runtime" as const, evidenceScope:"product-behavior" as const };
    const runs = normalizeLocallyVerifiableCandidateRuns(project, candidate, [testCase], [{ testCaseId:testCase.id, output:"BASELINE COMPARISON PENDING", latencyMs:0, cost:0, trace:[], verificationStatus:"unverified" }]);
    expect(runs[0]?.verificationStatus).toBe("verified");
    expect(runs[0]?.output).toContain("ORIGINAL VS EVOLVED SNAPSHOT EVIDENCE");
    expect(runs[0]?.output).toContain("旧版：输入→处理→输出");
    expect(runs[0]?.output).toContain("新版：输入→处理→自动验证→明确交付");
    expect(runs[0]?.trace.some((step)=>step.stage==="pairwise-snapshot"&&step.status==="pass")).toBe(true);
  });

  it("keeps semantic evidence unresolved only when the Candidate has no scoped content to inspect", () => {
    const criterion = AcceptanceCriterionSchema.parse({ id:"TXT-QUALITY", title:"最终成果质量", requirement:"文本必须完整", source:"user-command", weight:100, hardGate:true, judgeType:"llm", validationMethod:"semantic-judge", minScore:90, evidenceExpected:["完整正文"], protectedConstraint:false, artifactIds:["other-source"], category:"outcome" });
    const candidate = CandidateSchema.parse({ id:"TXT-C4", name:"TXT 新版", change:"优化文本", artifactSnapshots:[{ id:"txt-snapshot-4", sourceArtifactId:"txt-source", name:"workflow.txt", mimeType:"text/plain", content:"当前文本", createdAt:"2026-09-16T00:00:00.000Z" }] });
    const project = { ...demoProject, sourceArtifacts:[{ ...demoProject.sourceArtifacts[0]!, id:"txt-source", name:"workflow.txt", artifactKind:"document" as const, mimeType:"text/plain", extension:"txt", textContent:"旧内容" }], acceptanceRubric:[criterion] };
    const testCase = { id:"txt-quality-no-content", title:"最终成果质量", input:"检查内容", expected:["完整正文"], tags:[], hidden:true, criterionIds:[criterion.id], executionMode:"artifact-runtime" as const, evidenceScope:"product-behavior" as const };
    const runs = normalizeLocallyVerifiableCandidateRuns(project, candidate, [testCase], [{ testCaseId:testCase.id, output:"UNVERIFIED", latencyMs:20, cost:0.01, trace:[], verificationStatus:"unverified" }]);
    expect(runs[0]?.verificationStatus).toBe("unverified");
  });

  it("target adapter registry defaults to mock", () => {
    expect(getTargetAdapter().name).toContain("Mock");
  });

  it("allows a pending-evidence candidate to enter Hidden Validation without first pretending it is a winner", async () => {
    const candidate = CandidateSchema.parse({ id: "PENDING", name: "待补证候选", change: "等待本地自动复验" });
    const project = {
      ...demoProject,
      candidates: [candidate],
      experimentRun: {
        id: "experiment-pending",
        status: "completed" as const,
        candidateResults: [],
        pendingEvidenceCandidateId: candidate.id,
        summary: "候选没有已证实失败，只缺验证证据",
      },
    };
    await expect(runValidation(project, candidate)).resolves.toMatchObject({ status: "completed", candidateId: candidate.id });
  });

  it("validation compares candidate with same-paper baseline on hidden suite", async () => {
    const candidate = CandidateSchema.parse({ id: "C", name: "证据门升级", change: "为结论添加证据门" });
    const project = {
      ...demoProject,
      candidates: [candidate],
      experimentRun: {
        id: "experiment-test",
        status: "completed" as const,
        candidateResults: [{ candidateId: "C", experimentStage: "finalist" as const, evaluation: demoProject.baselineRun.result!, runs: [], artifactSnapshots: [] }],
        winnerId: "C",
        summary: "测试实验完成",
      },
    };
    const validation = await runValidation(project, candidate);
    expect(validation.status).toBe("completed");
    expect(validation.validationMode).toBe("full");
    expect(validation.executedCases).toBe(validation.plannedCases);
    const regression = validation.checks.find((check) => check.label === "关键能力回归");
    // 回归判定必须引用「同一套盲测卷」的当前版本对照，而不是可见题基线
    expect(regression?.detail).toContain("同一套盲测卷");
    expect(regression?.detail).toContain("当前版本");
    expect(regression?.status).toBe("pass");
    // 同卷两组执行明细都要保留，供验证页逐题回看
    expect(validation.runs.length).toBeGreaterThan(0);
    expect(validation.baselineRuns.length).toBe(validation.runs.length);
  });
});
