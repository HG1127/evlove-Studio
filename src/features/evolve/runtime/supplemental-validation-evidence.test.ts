import { describe, expect, it } from "vitest";
import type { Candidate, EvaluationResult, EvolveProject } from "../schemas";
import { evidenceFingerprint } from "./evidence-binding";
import { activeSupplementalEvidence, applySupplementalEvidenceToEvaluation } from "./supplemental-validation-evidence";

function fixture() {
  const candidate = {
    id: "cand-1",
    name: "Candidate 1",
    change: "visual update",
    artifactSnapshots: [{ id:"snap-1", sourceArtifactId:"src-1", name:"app.html", mimeType:"text/html", content:"<main>new</main>", contentHash:"hash-1", buildMode:"deterministic", notes:[], createdAt:"2026-09-16T00:00:00.000Z" }],
  } as unknown as Candidate;
  const project = {
    id:"project-1",
    sourceArtifacts:[{ id:"src-1", role:"target", textContent:"<main>old</main>" }],
    goal:"improve UI",
    evolutionCommand:"improve UI",
    protectedItems:[],
    metrics:[],
    hiddenEvalSuite:[],
    supplementalValidationEvidence:[],
    acceptanceRubric:[
      { id:"VISUAL",title:"视觉层级",requirement:"层级清晰",weight:60,minScore:90,hardGate:true,validationMethod:"visual-review" },
      { id:"MANUAL",title:"人工确认",requirement:"业务负责人确认",weight:40,minScore:85,hardGate:true,validationMethod:"manual-review" },
    ],
  } as unknown as EvolveProject;
  const evaluation = {
    accuracy:90,evidence:90,riskCoverage:90,completeness:90,safety:"PASS",notes:[],failures:[],averageCost:0,averageLatencyMs:0,
    rubricScore:0,verifiedRubricCoverage:0,unverifiedCriterionIds:["VISUAL","MANUAL"],criterionScores:[
      { criterionId:"VISUAL",score:0,pass:false,verificationStatus:"unverified",evidence:[],gaps:["missing"],testCaseIds:[] },
      { criterionId:"MANUAL",score:0,pass:false,verificationStatus:"unverified",evidence:[],gaps:["missing"],testCaseIds:[] },
    ],
  } as EvaluationResult;
  return { project, candidate, evaluation };
}

describe("supplemental validation evidence",()=>{
  it("applies exact-version visual/manual evidence and recalculates verified coverage",()=>{
    const {project,candidate,evaluation}=fixture();
    const fingerprint=evidenceFingerprint(project,candidate);
    project.supplementalValidationEvidence=[
      {id:"v1",criterionId:"VISUAL",candidateId:candidate.id,evidenceFingerprint:fingerprint,method:"visual-review",verdict:"pass",note:"当前截图层级清晰",screenshotIds:["shot-1"],artifactHashes:["hash-1"],createdAt:"2026-09-16T01:00:00.000Z"},
      {id:"m1",criterionId:"MANUAL",candidateId:candidate.id,evidenceFingerprint:fingerprint,method:"manual-review",verdict:"fail",note:"业务审批链仍缺一步",screenshotIds:[],artifactHashes:[],createdAt:"2026-09-16T01:01:00.000Z"},
    ];
    const applied=applySupplementalEvidenceToEvaluation(project,candidate,evaluation);
    expect(applied.verifiedRubricCoverage).toBe(100);
    expect(applied.unverifiedCriterionIds).toEqual([]);
    expect(applied.criterionScores?.find((item)=>item.criterionId==="VISUAL")).toMatchObject({verificationStatus:"verified",pass:true,score:90});
    const manual=applied.criterionScores?.find((item)=>item.criterionId==="MANUAL");
    expect(manual).toMatchObject({verificationStatus:"verified",pass:false});
    expect(manual?.score).toBeLessThan(85);
  });

  it("treats pre-migration projects without the evidence ledger as an empty ledger",()=>{
    const {project,candidate,evaluation}=fixture();
    const legacyProject={...project,supplementalValidationEvidence:undefined} as unknown as EvolveProject;
    expect(()=>activeSupplementalEvidence(legacyProject,candidate)).not.toThrow();
    expect(activeSupplementalEvidence(legacyProject,candidate).size).toBe(0);
    expect(applySupplementalEvidenceToEvaluation(legacyProject,candidate,evaluation)).toBe(evaluation);
  });

  it("ignores evidence from a stale artifact fingerprint",()=>{
    const {project,candidate,evaluation}=fixture();
    project.supplementalValidationEvidence=[{id:"old",criterionId:"VISUAL",candidateId:candidate.id,evidenceFingerprint:"old-fingerprint",method:"visual-review",verdict:"pass",note:"old screenshot",screenshotIds:["shot-old"],artifactHashes:["old"],createdAt:"2026-09-15T01:00:00.000Z"}];
    expect(activeSupplementalEvidence(project,candidate).size).toBe(0);
    const applied=applySupplementalEvidenceToEvaluation(project,candidate,evaluation);
    expect(applied.unverifiedCriterionIds).toContain("VISUAL");
  });
});

describe("whole HTML protection cannot be overwritten by supplemental notes", () => {
  it.each(["manual-review", "visual-review"] as const)("does not turn an incomplete or failed whole criterion into pass via %s", method => {
    for (const actualFailure of [false, true]) {
      const { project, candidate, evaluation } = fixture();
      const base = project.acceptanceRubric[1]!;
      project.acceptanceRubric = [{ ...base, id: "PROTECT-ALL", title: "保护所有原有内容", requirement: "保留全部原有内容和行为", protectedConstraint: true, validationMethod: method }];
      project.sourceArtifacts = [{ ...project.sourceArtifacts[0]!, name: "app.html", extension: "html", mimeType: "text/html" }];
      evaluation.criterionScores = [{ criterionId: "PROTECT-ALL", score: actualFailure ? 0 : 100, pass: false,
        verificationStatus: actualFailure ? "verified" : "partial", evidence: actualFailure ? ["native card assertion failed"] : ["search only"],
        gaps: ["[html-protection-scope-pending] missing complete protection", ...(actualFailure ? ["original card is missing"] : [])], testCaseIds: ["H1"] }];
      evaluation.verifiedRubricCoverage = actualFailure ? 100 : 0;
      evaluation.unverifiedCriterionIds = actualFailure ? [] : ["PROTECT-ALL"];
      project.supplementalValidationEvidence = [{ id: "note", criterionId: "PROTECT-ALL", candidateId: candidate.id,
        evidenceFingerprint: evidenceFingerprint(project, candidate), method, verdict: "pass", note: "all good",
        screenshotIds: method === "visual-review" ? ["shot"] : [], artifactHashes: ["hash-1"], createdAt: "2026-10-13T00:00:00Z" }];
      const applied = applySupplementalEvidenceToEvaluation(project, candidate, evaluation);
      expect(applied.criterionScores?.[0]).toMatchObject({ score: actualFailure ? 0 : 100, pass: false,
        verificationStatus: actualFailure ? "verified" : "partial" });
      expect(applied.criterionScores?.[0].gaps.join(" ")).toContain("scope-pending");
      if (actualFailure) expect(applied.criterionScores?.[0].evidence).toContain("native card assertion failed");
      else expect(applied.verifiedRubricCoverage).toBe(0);
      expect(project.supplementalValidationEvidence[0].note).toBe("all good");
    }
  });
});
