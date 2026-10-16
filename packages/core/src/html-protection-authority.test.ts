import { afterEach, describe, expect, it, vi } from "vitest";
import { AcceptanceCriterionSchema, CandidateSchema, SourceArtifactSchema, TestCaseSchema,
  type EvolveProject, type HtmlProtectionEvidence, type HtmlProtectionObligation,
  type HtmlProtectionProof, type HtmlProtectionProofBinding, type TargetRunResult } from "@evolution/contracts";
import { HTML_PROTECTION_AUTHORITY_POLICY, bindHtmlProtectionAuthorities, createHtmlProtectionAuthority,
  hasHtmlProtectionAcceptanceAuthority, htmlProtectionCriterionAuthority, inheritHtmlProtectionAuthorities, invalidateHtmlProtectionAuthorities } from "./html-protection-authority";
import { htmlProtectionAcceptanceBlocker, htmlProtectionCoverageGap } from "./html-protection-scope";
import { settleAiEvaluation } from "./evaluation-settlement";
const now = Date.parse("2026-10-14T12:00:01Z");
const criterion = AcceptanceCriterionSchema.parse({ id: "PROTECT-ALL", title: "Whole", requirement: "Preserve all original content and behavior",
  protectedConstraint: true, hardGate: true, minScore: 95, artifactIds: ["source"] });
function fixture(status: "verified" | "partial" | "failed" = "verified", arm: "current" | "candidate" = "current") {
  vi.spyOn(Date, "now").mockReturnValue(now);
  const test = TestCaseSchema.parse({ id: "hidden", title: "whole", input: "all", expected: ["all"], hidden: true,
    criterionIds: [criterion.id], executionMode: "external-runner", tags: ["source-grounded-html-assertions"] });
  const binding: HtmlProtectionProofBinding = { missionId: "mission", testCaseId: test.id, criterionId: criterion.id, paperSha256: "a".repeat(64),
    original: { sourceArtifactId: "source", sha256: "b".repeat(64), byteLength: 100 },
    executed: { sourceArtifactId: "source", sha256: arm === "current" ? "b".repeat(64) : "c".repeat(64), byteLength: arm === "current" ? 100 : 110 },
    subject: arm === "current" ? { kind: "current", versionId: "v1" } : { kind: "candidate", candidateId: "C1" } };
  const required: HtmlProtectionObligation[] = (["static", "browser", "semantic", "visual"] as const).map((kind, index) => ({
    id: "O" + index, sourceArtifactId: "source", kind: ({ static: "html-format", browser: "browser-behavior", semantic: "core-method", visual: "visual-layout" } as const)[kind],
    target: "complete-original", description: "Complete independent scope", evidenceKind: kind, support: "supported" }));
  const evidence: HtmlProtectionEvidence[] = required.map((item, index) => ({ schemaVersion: "html-protection-evidence-v1", id: arm + "-E" + index,
    binding, kind: item.evidenceKind, producer: ({ static: "core-static", browser: "browser-runner", semantic: "semantic-runtime", visual: "visual-judge", manual: "human" } as const)[item.evidenceKind],
    obligationIds: [item.id], verificationStatus: index === 1 ? status : "verified", observedAt: "2026-10-14T12:00:00Z" }));
  const proof: HtmlProtectionProof = { schemaVersion: "html-protection-proof-v1", binding, requiredObligations: required, evidence,
    receipts: required.map((item, index) => ({ obligationId: item.id, verificationStatus: evidence[index]!.verificationStatus, evidenceIds: [evidence[index]!.id] })), verificationStatus: status };
  const run: TargetRunResult = { testCaseId: test.id, artifactHash: binding.executed.sha256, output: "Actual scoped observations retained", latencyMs: 1,
    cost: 0, trace: [], verificationStatus: status, htmlProtectionProof: proof };
  const project = { id: "mission", version: "v1", sourceArtifacts: [SourceArtifactSchema.parse({ id: "source", role: "target", name: "a.html", extension: "html", mimeType: "text/html", createdAt: "2026-10-14T00:00:00Z" })],
    acceptanceRubric: [criterion], evalSuite: [], hiddenEvalSuite: [test], protectedItems: ["all"], editableItems: ["refine"], candidates: [{ id: "C1", artifactSnapshots: [{ sourceArtifactId: "source", frozenArtifact: { sha256: "c".repeat(64), size: 110 } }] }],
    validationRun: { candidateId: "C1", status: "completed", validationMode: "full", runs: [], baselineRuns: [] } } as unknown as EvolveProject;
  const args = { project, testCase: test, proof, expectedBinding: binding, requiredObligations: required, trustedEvidence: evidence,
    canonicalRun: run, policyVersion: HTML_PROTECTION_AUTHORITY_POLICY, observedAt: "2026-10-14T12:00:00.100Z", expiresAt: "2026-10-14T12:10:00Z", now };
  return { project, test, criterion, binding, required, evidence, proof, run, args };
}
afterEach(() => vi.restoreAllMocks());
describe("independent whole protection authority", () => {
  it("uses registered complete observations while retaining the independent Judge decision", () => {
    const f = fixture(); const authority = createHtmlProtectionAuthority(f.args)!;
    expect(bindHtmlProtectionAuthorities(f.project, [authority])).toBe(true);
    expect(htmlProtectionCoverageGap(criterion, f.project, { testCases: [f.test], runs: [f.run] })).toBeUndefined();
    const settle = (pass: boolean) => settleAiEvaluation({ scope: f.project, criteria: [criterion], testCases: [f.test], runs: [f.run],
      ai: { accuracy: 100, evidence: 100, completeness: 100, riskCoverage: 100, safety: "PASS", cases: [], notes: [], failures: [],
        criteria: [{ criterionId: criterion.id, score: pass ? 100 : 60, pass, evidence: ["scoped actual observations"], gaps: [], testCaseIds: [f.test.id] }] } });
    expect(settle(true).criterionScores?.[0]).toMatchObject({ pass: true, verificationStatus: "verified" });
    expect(settle(false).criterionScores?.[0]).toMatchObject({ pass: false, score: 60, verificationStatus: "verified" });
    expect(htmlProtectionAcceptanceBlocker(f.project)).toContain("scope-pending");
  });
  it("does not accept an unregistered or serialized capability/proof", () => {
    const f = fixture(); const token = createHtmlProtectionAuthority(f.args)!;
    expect(bindHtmlProtectionAuthorities(f.project, [JSON.parse(JSON.stringify(token))])).toBe(false);
    expect(bindHtmlProtectionAuthorities(f.project, [{ capability: "html-protection-authority-v1" }])).toBe(false);
    expect(htmlProtectionCoverageGap(criterion, f.project, { testCases: [f.test], runs: [f.run] })).toContain("scope-pending");
  });
  it.each(["output", "trace", "status", "proof", "artifact", "duplicate"] as const)("refuses canonical run %s drift", kind => {
    const f = fixture(); bindHtmlProtectionAuthorities(f.project, [createHtmlProtectionAuthority(f.args)!]);
    const run = structuredClone(f.run);
    if (kind === "output") run.output += " changed";
    if (kind === "trace") run.trace.push({ id: "new", stage: "assertion", status: "pass", summary: "new" });
    if (kind === "status") run.verificationStatus = "partial";
    if (kind === "proof") run.htmlProtectionProof!.evidence.pop();
    if (kind === "artifact") run.artifactHash = "d".repeat(64);
    expect(htmlProtectionCriterionAuthority({ project: f.project, criterion, testCases: [f.test], runs: kind === "duplicate" ? [run, run] : [run] }).passed).toBe(false);
  });
  it.each(["goal", "rubric", "paper", "protected", "source"] as const)("refuses complete contract %s drift", kind => {
    const f = fixture(); bindHtmlProtectionAuthorities(f.project, [createHtmlProtectionAuthority(f.args)!]);
    if (kind === "goal") f.project.goal = "another";
    if (kind === "rubric") f.project.acceptanceRubric[0] = { ...criterion, minScore: 1 };
    if (kind === "paper") f.project.hiddenEvalSuite[0]!.input = "another";
    if (kind === "protected") f.project.protectedItems.push("another");
    if (kind === "source") f.project.sourceArtifacts[0]!.name = "changed.html";
    expect(htmlProtectionCriterionAuthority({ project: f.project, criterion, testCases: [f.test], runs: [f.run] }).passed).toBe(false);
  });
  it.each([NaN, Infinity, Date.parse("2026-10-14T11:59:59Z"), Date.parse("2026-10-14T12:10:00Z")])("refuses invalid, future or expired time %s", time => {
    const f = fixture(); expect(createHtmlProtectionAuthority({ ...f.args, now: time })).toBeUndefined();
  });
  it("retains actual failed scope despite other partial coverage and Judge high scores", () => {
    const f = fixture("failed"); f.required[2]!.support = "unresolved";
    f.evidence[2]!.verificationStatus = "unverified"; f.proof.receipts[2]!.verificationStatus = "unverified";
    const authority = createHtmlProtectionAuthority(f.args)!; expect(authority).toBeDefined();
    bindHtmlProtectionAuthorities(f.project, [authority]);
    const result = settleAiEvaluation({ scope: f.project, criteria: [criterion], testCases: [f.test], runs: [f.run], ai: {
      accuracy: 100, evidence: 100, completeness: 100, riskCoverage: 100, safety: "PASS", cases: [], notes: [], failures: [],
      criteria: [{ criterionId: criterion.id, score: 100, pass: true, evidence: [], gaps: [], testCaseIds: [f.test.id] }] } });
    expect(result.criterionScores?.[0]).toMatchObject({ pass: false, score: 0, verificationStatus: "verified" });
    expect(htmlProtectionAcceptanceBlocker(f.project)).toContain("scope-pending");
  });
  it("keeps truthful partial evidence incomplete", () => {
    const f = fixture("partial"); bindHtmlProtectionAuthorities(f.project, [createHtmlProtectionAuthority(f.args)!]);
    expect(htmlProtectionCriterionAuthority({ project: f.project, criterion, testCases: [f.test], runs: [f.run] }).passed).toBe(false);
  });
  it("requires every mapped same-arm case, including middle cases", () => {
    const f = fixture(); bindHtmlProtectionAuthorities(f.project, [createHtmlProtectionAuthority(f.args)!]);
    const middle = { ...f.test, id: "middle" };
    expect(htmlProtectionCriterionAuthority({ project: f.project, criterion, testCases: [f.test, middle], runs: [f.run] }).passed).toBe(false);
  });
  it("requires both independently bound Hidden arms for Gate F and preserves owned domain copies", () => {
    const current = fixture(); const candidate = fixture("verified", "candidate");
    const project = current.project;
    const first = createHtmlProtectionAuthority(current.args)!;
    const second = createHtmlProtectionAuthority({ ...candidate.args, project })!;
    project.validationRun.runs = [candidate.run]; project.validationRun.baselineRuns = [current.run];
    bindHtmlProtectionAuthorities(project, [first]); expect(hasHtmlProtectionAcceptanceAuthority(project, [criterion])).toBe(false);
    bindHtmlProtectionAuthorities(project, [first, second]); expect(hasHtmlProtectionAcceptanceAuthority(project, [criterion])).toBe(true);
    expect(htmlProtectionAcceptanceBlocker(project)).toBeUndefined();
    const clone = structuredClone(project); expect(htmlProtectionAcceptanceBlocker(clone)).toContain("scope-pending");
    inheritHtmlProtectionAuthorities(project, clone); expect(htmlProtectionAcceptanceBlocker(clone)).toBeUndefined();
    clone.validationRun.baselineRuns = [candidate.run]; expect(htmlProtectionAcceptanceBlocker(clone)).toContain("scope-pending");
  });
  it("ignores only envelope locator refs while binding every material run field", () => {
    const f = fixture(); bindHtmlProtectionAuthorities(f.project, [createHtmlProtectionAuthority(f.args)!]);
    const located = { ...f.run, htmlProtectionAuthorityRefs: [{ schemaVersion: "html-protection-authority-reference-v1" as const,
      blobId: "envelope", sha256: "f".repeat(64), byteLength: 100, criterionId: criterion.id, executionId: "run", jobId: "job", generation: 1,
      inputSha256: "1".repeat(64), planSha256: "2".repeat(64), scoringRouteFingerprint: "route", policyVersion: HTML_PROTECTION_AUTHORITY_POLICY,
      observedAt: "2026-10-14T12:00:00.100Z", expiresAt: "2026-10-14T12:10:00Z" }] };
    expect(htmlProtectionCriterionAuthority({ project: f.project, criterion, testCases: [f.test], runs: [located] }).passed).toBe(true);
    located.output += " clipped";
    expect(htmlProtectionCriterionAuthority({ project: f.project, criterion, testCases: [f.test], runs: [located] }).passed).toBe(false);
  });
  it.each(["input", "expected", "criterionIds", "hidden", "criterion"] as const)("refuses consumer same-ID %s drift", kind => {
    const f = fixture(); bindHtmlProtectionAuthorities(f.project, [createHtmlProtectionAuthority(f.args)!]);
    const test = structuredClone(f.test), suppliedCriterion = { ...criterion };
    if (kind === "input") test.input = "another physical paper";
    if (kind === "expected") test.expected = ["another expected"];
    if (kind === "criterionIds") test.criterionIds.push("another");
    if (kind === "hidden") test.hidden = false;
    if (kind === "criterion") suppliedCriterion.requirement = "changed definition";
    expect(htmlProtectionCriterionAuthority({ project: f.project, criterion: suppliedCriterion, testCases: [test], runs: [f.run] }).passed).toBe(false);
  });
  it.each(["content", "receipt", "blobId", "duplicate"] as const)("refuses same-Candidate-ID frozen %s drift", kind => {
    const f = fixture("verified", "candidate"); bindHtmlProtectionAuthorities(f.project, [createHtmlProtectionAuthority(f.args)!]);
    const snapshot = f.project.candidates[0]!.artifactSnapshots[0]!;
    if (kind === "content") snapshot.content = "different actual full snapshot";
    if (kind === "receipt") snapshot.frozenArtifact!.snapshotHash = "e".repeat(64);
    if (kind === "blobId") snapshot.frozenArtifact!.blobId = "other-file";
    if (kind === "duplicate") f.project.candidates.push(structuredClone(f.project.candidates[0]!));
    expect(htmlProtectionCriterionAuthority({ project: f.project, criterion, testCases: [f.test], runs: [f.run] }).passed).toBe(false);
  });
  it("refuses Current version relabeling and next-round reuse", () => {
    const f = fixture(); bindHtmlProtectionAuthorities(f.project, [createHtmlProtectionAuthority(f.args)!]);
    f.project.searchChampion = { candidate: { id: "other", artifactSnapshots: [] } } as unknown as EvolveProject["searchChampion"];
    expect(htmlProtectionCriterionAuthority({ project: f.project, criterion, testCases: [f.test], runs: [f.run] }).passed).toBe(false);
    f.project.searchChampion = undefined;
    f.project.campaign = { currentRound: 2 } as EvolveProject["campaign"];
    expect(htmlProtectionCriterionAuthority({ project: f.project, criterion, testCases: [f.test], runs: [f.run] }).passed).toBe(false);
  });
  it("carries only a registered exact built Candidate into owned settlement while the draft stays unchanged", () => {
    const f = fixture("verified", "candidate"), built = CandidateSchema.parse({ id: "C1", name: "built", change: "actual build", artifactBuildStatus: "ready", artifactSnapshots: [{
      id: "snapshot", sourceArtifactId: "source", name: "a.html", mimeType: "text/html", content: "actual full frozen HTML", createdAt: "2026-10-14T12:00:00Z",
      frozenArtifact: { sourceArtifactId: "source", sha256: "c".repeat(64), size: 110, blobId: "actual-file", snapshotHash: "e".repeat(64), name: "a.html", mimeType: "text/html",
        verifiedAt: "2026-10-14T12:00:00Z", checks: [], limitations: [] } }] });
    f.project.candidates = [built]; const token = createHtmlProtectionAuthority(f.args)!;
    const draft = CandidateSchema.parse({ id: "C1", name: "draft", change: "planned" }); f.project.candidates = [draft];
    expect(bindHtmlProtectionAuthorities(f.project, [token])).toBe(false);
    expect(bindHtmlProtectionAuthorities(f.project, [JSON.parse(JSON.stringify(token))], built)).toBe(false);
    expect(bindHtmlProtectionAuthorities(f.project, [token], built)).toBe(true);
    expect(f.project.candidates[0]!.artifactSnapshots).toEqual([]);
    expect(htmlProtectionCriterionAuthority({ project: f.project, criterion, testCases: [f.test], runs: [f.run] }).passed).toBe(true);
    const settled = { ...f.project, candidates: [{ ...built, status: "passed" as const }] };
    inheritHtmlProtectionAuthorities(f.project, settled);
    expect(htmlProtectionCriterionAuthority({ project: settled, criterion, testCases: [f.test], runs: [f.run] }).passed).toBe(true);
    settled.candidates[0]!.artifactSnapshots = structuredClone(built.artifactSnapshots);
    settled.candidates[0]!.artifactSnapshots[0]!.content += "different full body";
    expect(htmlProtectionCriterionAuthority({ project: settled, criterion, testCases: [f.test], runs: [f.run] }).passed).toBe(false);
    draft.artifactSnapshots = structuredClone(built.artifactSnapshots); draft.artifactSnapshots[0]!.frozenArtifact!.blobId = "foreign";
    expect(htmlProtectionCriterionAuthority({ project: f.project, criterion, testCases: [f.test], runs: [f.run] }).passed).toBe(false);
  });
  it("withdraws old positive authority before failed restoration without erasing immutable known losses", () => {
    const f = fixture(); bindHtmlProtectionAuthorities(f.project, [createHtmlProtectionAuthority(f.args)!]);
    invalidateHtmlProtectionAuthorities(f.project, { testCaseIds: [f.test.id], subject: "current" });
    expect(htmlProtectionCriterionAuthority({ project: f.project, criterion, testCases: [f.test], runs: [f.run] }).passed).toBe(false);
    const failed = fixture("failed"); bindHtmlProtectionAuthorities(failed.project, [createHtmlProtectionAuthority(failed.args)!]);
    invalidateHtmlProtectionAuthorities(failed.project, { testCaseIds: [failed.test.id], subject: "current" });
    expect(htmlProtectionCriterionAuthority({ project: failed.project, criterion, testCases: [failed.test], runs: [failed.run] }).observedFailure).toBe(true);
  });
  it.each(["draft-change", "draft-risk", "parent", "round"] as const)("rejects private built-scope %s drift", kind => {
    const f = fixture("verified", "candidate"), built = CandidateSchema.parse({ id: "C1", name: "build", change: "actual frozen body", artifactSnapshots: [{
      id: "s", sourceArtifactId: "source", name: "a.html", mimeType: "text/html", content: "full body", createdAt: "2026-10-14T12:00:00Z",
      frozenArtifact: { sourceArtifactId: "source", snapshotHash: "e".repeat(64), blobId: "actual", name: "a.html", mimeType: "text/html", sha256: "c".repeat(64), size: 110,
        verifiedAt: "2026-10-14T12:00:00Z", checks: [], limitations: [] } }] });
    f.project.candidates = [built]; const token = createHtmlProtectionAuthority(f.args)!;
    const draft = CandidateSchema.parse({ id: "C1", name: "draft", change: "planned" }); f.project.candidates = [draft];
    expect(bindHtmlProtectionAuthorities(f.project, [token], built)).toBe(true);
    if (kind === "draft-change") draft.change = "different intent";
    if (kind === "draft-risk") draft.risks.push("different plan");
    if (kind === "parent") f.project.searchChampion = { round: 1, candidate: { ...built, id: "previous" } } as never;
    if (kind === "round") f.project.campaign = { currentRound: 2 } as EvolveProject["campaign"];
    expect(htmlProtectionCriterionAuthority({ project: f.project, criterion, testCases: [f.test], runs: [f.run] }).passed).toBe(false);
  });
  it("admits only the explicitly compiled current-Baseline projection, never Hidden or Candidate projections", () => {
    const f = fixture(); f.test.hidden = false; f.test.criterionIds.push("SYS-PAIRWISE"); f.project.evalSuite = [f.test]; f.project.hiddenEvalSuite = [];
    f.project.acceptanceRubric.push(AcceptanceCriterionSchema.parse({ id: "SYS-PAIRWISE", title: "Pairwise", requirement: "Candidate comparison", hardGate: true }));
    f.project.campaign = { currentRound: 0 } as EvolveProject["campaign"];
    bindHtmlProtectionAuthorities(f.project, [createHtmlProtectionAuthority(f.args)!]);
    const projected = { ...f.test, criterionIds: [criterion.id] }, args = { project: f.project, criterion, testCases: [projected], runs: [f.run] };
    expect(htmlProtectionCriterionAuthority(args).passed).toBe(false);
    expect(htmlProtectionCriterionAuthority({ ...args, measurementPhase: "current-baseline" }).passed).toBe(true);
    expect(htmlProtectionCriterionAuthority({ ...args, testCases: [{ ...projected, expected: ["altered"] }], measurementPhase: "current-baseline" }).passed).toBe(false);
    expect(htmlProtectionCriterionAuthority({ ...args, testCases: [{ ...projected, hidden: true }], measurementPhase: "current-baseline" }).passed).toBe(false);
    const c = fixture("verified", "candidate"); bindHtmlProtectionAuthorities(c.project, [createHtmlProtectionAuthority(c.args)!]);
    expect(htmlProtectionCriterionAuthority({ project: c.project, criterion, testCases: [c.test], runs: [c.run], measurementPhase: "current-baseline" }).passed).toBe(false);
  });
  it("uses complete criterion-scoped proof for a normally bounded Judge case while preserving its partial status and independent Safety", () => {
    const f = fixture(); f.run.verificationStatus = "partial"; bindHtmlProtectionAuthorities(f.project, [createHtmlProtectionAuthority(f.args)!]);
    const result = settleAiEvaluation({ scope: f.project, criteria: [criterion], testCases: [f.test], runs: [f.run], ai: {
      accuracy: 100, evidence: 100, completeness: 100, riskCoverage: 100, safety: "REVIEW", cases: [], notes: [], failures: [],
      criteria: [{ criterionId: criterion.id, score: 100, pass: true, evidence: [], gaps: [], testCaseIds: [f.test.id] }] } });
    expect(f.run.verificationStatus).toBe("partial");expect(result.criterionScores?.[0]).toMatchObject({verificationStatus:"verified",pass:true});expect(result.safety).toBe("REVIEW");
  });
  it("binds the actual executed round across normal checkpoint settlement and rejects a next-round checkpoint", () => {
    const f = fixture(); f.project.campaign = { currentRound: 0, checkpoint: { round: 1 } } as EvolveProject["campaign"];
    bindHtmlProtectionAuthorities(f.project, [createHtmlProtectionAuthority(f.args)!]);
    const settled:EvolveProject = { ...f.project, campaign: { ...f.project.campaign, currentRound: 1, checkpoint: undefined } };
    inheritHtmlProtectionAuthorities(f.project, settled);
    expect(htmlProtectionCriterionAuthority({ project: settled, criterion, testCases: [f.test], runs: [f.run] }).passed).toBe(true);
    settled.campaign.checkpoint = { round: 2 } as EvolveProject["campaign"]["checkpoint"];
    expect(htmlProtectionCriterionAuthority({ project: settled, criterion, testCases: [f.test], runs: [f.run] }).passed).toBe(false);
  });
  it("keeps narrow non-authoritative evaluation scopes as unavailable without treating them as registered Domain authority", () => {
    const f = fixture(), narrow = { sourceArtifacts: f.project.sourceArtifacts } as EvolveProject;
    expect(() => htmlProtectionCoverageGap(criterion, narrow, { testCases: [f.test], runs: [f.run] })).not.toThrow();
    expect(htmlProtectionCoverageGap(criterion, narrow, { testCases: [f.test], runs: [f.run] })).toContain("scope-pending");
  });
  it("does not restore old authority for a new policy", () => {
    const f = fixture(); expect(createHtmlProtectionAuthority({ ...f.args, policyVersion: "html-whole-scope-required-v1" })).toBeUndefined();
  });
});

describe("stable Baseline and selected-route epoch", () => {
  it.each(["id", "startedAt", "fingerprint", "suite", "cases", "scoring-input", "scoring-route"] as const)("invalidates previous positive authority after %s drift", kind => {
    const f = fixture(); f.project.baselineRun = { id:"baseline-1",status:"running",startedAt:"2026-10-14T11:00:00Z",measurementFingerprint:"bound-1",suiteName:"Visible",totalCases:1,runs:[] };
    f.project.campaign = {currentRound:1,scoringInputFingerprint:"input-1",scoringRouteFingerprint:"direct-1"} as never;
    expect(bindHtmlProtectionAuthorities(f.project,[createHtmlProtectionAuthority(f.args)!])).toBe(true);
    if(kind==="id")f.project.baselineRun.id="baseline-2";
    if(kind==="startedAt")f.project.baselineRun.startedAt="2026-10-14T11:10:00Z";
    if(kind==="fingerprint")f.project.baselineRun.measurementFingerprint="bound-2";
    if(kind==="suite")f.project.baselineRun.suiteName="Other paper";
    if(kind==="cases")f.project.baselineRun.totalCases=2;
    if(kind==="scoring-input")f.project.campaign.scoringInputFingerprint="input-2";
    if(kind==="scoring-route")f.project.campaign.scoringRouteFingerprint="direct-2";
    expect(htmlProtectionCriterionAuthority({project:f.project,criterion,testCases:[f.test],runs:[f.run]}).passed).toBe(false);
  });
  it("carries the same measurement epoch through normal running-to-completed settlement only",()=>{
    const f=fixture();f.project.baselineRun={id:"baseline-1",status:"running",startedAt:"2026-10-14T11:00:00Z",measurementFingerprint:"bound-1",suiteName:"Visible",totalCases:1,runs:[]};
    bindHtmlProtectionAuthorities(f.project,[createHtmlProtectionAuthority(f.args)!]);
    const settled={...f.project,baselineRun:{...f.project.baselineRun,status:"completed" as const,completedAt:"2026-10-14T12:00:00Z",runs:[f.run]}};
    inheritHtmlProtectionAuthorities(f.project,settled);
    expect(htmlProtectionCriterionAuthority({project:settled,criterion,testCases:[f.test],runs:[f.run]}).passed).toBe(true);
  });
});

describe("owned authority copy source validity",()=>{
  it.each(["content","sha","blob","expiry"] as const)("never resurrects %s drift by projecting an old Champion snapshot",kind=>{
    const f=fixture("verified","candidate"),old=structuredClone(f.project.candidates[0]!);
    bindHtmlProtectionAuthorities(f.project,[createHtmlProtectionAuthority(f.args)!]);
    f.project.searchChampion={id:"old-champion",round:1,parentVersionId:"v1",candidate:old} as never;
    if(kind==="content")f.project.candidates[0]!.artifactSnapshots[0]!.content="changed full source";
    if(kind==="sha")f.project.candidates[0]!.artifactSnapshots[0]!.frozenArtifact!.sha256="e".repeat(64);
    if(kind==="blob")f.project.candidates[0]!.artifactSnapshots[0]!.frozenArtifact!.blobId="changed-source-blob";
    if(kind==="expiry")vi.spyOn(Date,"now").mockReturnValue(Date.parse("2026-10-14T12:10:00Z"));
    const projected={...f.project,candidates:[old]};inheritHtmlProtectionAuthorities(f.project,projected);
    expect(htmlProtectionCriterionAuthority({project:projected,criterion,testCases:[f.test],runs:[f.run]}).passed).toBe(false);
  });
});

describe("paired authority expiry snapshot",()=>{
  it("rejects absent or duplicate criterion coverage instead of accepting every(empty)",()=>{
    const current=fixture(),candidate=fixture("verified","candidate"),project=current.project;
    project.validationRun.runs=[candidate.run];project.validationRun.baselineRuns=[current.run];
    bindHtmlProtectionAuthorities(project,[createHtmlProtectionAuthority(current.args)!,createHtmlProtectionAuthority({...candidate.args,project})!]);
    expect(hasHtmlProtectionAcceptanceAuthority(project,[])).toBe(false);
    expect(hasHtmlProtectionAcceptanceAuthority(project,[criterion,criterion])).toBe(false);
  });

  it("uses one captured instant and rejects a jointly expired pair without empty-array acceptance",()=>{
    const current=fixture(),candidate=fixture("verified","candidate"),project=current.project;
    project.validationRun.runs=[candidate.run];project.validationRun.baselineRuns=[current.run];
    bindHtmlProtectionAuthorities(project,[createHtmlProtectionAuthority(current.args)!,createHtmlProtectionAuthority({...candidate.args,project})!]);
    const clock=vi.spyOn(Date,"now").mockReturnValueOnce(now).mockReturnValueOnce(now).mockReturnValue(Date.parse("2026-10-14T12:10:00Z"));
    expect(hasHtmlProtectionAcceptanceAuthority(project,[criterion])).toBe(true);expect(clock).toHaveBeenCalledTimes(1);
    clock.mockReset().mockReturnValue(Date.parse("2026-10-14T12:10:00Z"));
    expect(hasHtmlProtectionAcceptanceAuthority(project,[criterion])).toBe(false);
    project.validationRun.runs=[];project.validationRun.baselineRuns=[];
    expect(hasHtmlProtectionAcceptanceAuthority(project,[criterion])).toBe(false);
  });
});
