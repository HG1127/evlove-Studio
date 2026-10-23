import {describe,expect,it} from "vitest";
import {AcceptanceCriterionSchema,SourceArtifactSchema} from "@evolution/contracts";
import {normalizeAcceptanceRubric} from "./acceptance-rubric";
import {rubricTargetBindingIssues,rubricValidation} from "./rubric-readiness";

const target=SourceArtifactSchema.parse({
  id:"real-upload",name:"research.md",role:"target",artifactKind:"document",
  extension:"md",mimeType:"text/markdown",size:66,
  textContent:"# 研究规范\n请清楚标注来源与引用。",
  createdAt:"2026-10-20T00:00:00Z",
});
const other={...target,id:"other-target",name:"other.md"};
const reference={...target,id:"reference",role:"reference" as const,name:"source-example.md"};
const stale=AcceptanceCriterionSchema.parse({
  id:"C-SOURCE-BOUND",title:"研究规范来源约束",
  requirement:"研究报告的关键信息必须核实，并保留证据来源。",
  source:"source-understanding",weight:100,hardGate:true,judgeType:"structural",
  validationMethod:"static-structure",minScore:85,evidenceExpected:["实际规范的来源字段"],
  protectedConstraint:false,artifactIds:["provisional-intake-id"],category:"outcome",
});
const input=(sourceArtifacts:typeof target[],criteria=[stale])=>({
  sourceArtifacts,protectedItems:[],evolutionCommand:"补齐并验证研究来源",
  acceptanceRubric:criteria,
});

describe("Acceptance Rubric Target binding",()=>{
  it("maps one provisional AI ID to the only real Target before checking the contract",()=>{
    const project=input([target]);
    const normalized=normalizeAcceptanceRubric([stale],project);
    const bound=normalized.find(x=>x.id===stale.id);
    expect(bound?.artifactIds).toEqual([target.id]);
    expect(rubricTargetBindingIssues(normalized,project.sourceArtifacts)).toEqual([]);
    expect(normalizeAcceptanceRubric(normalized,project).find(x=>x.id===stale.id)?.artifactIds).toEqual([target.id]);
  });
  it("refuses to guess a provisional ID when multiple Targets exist",()=>{
    const project=input([target,other]);
    const normalized=normalizeAcceptanceRubric([stale],project);
    expect(normalized.find(x=>x.id===stale.id)?.artifactIds).toEqual(stale.artifactIds);
    const issues=rubricTargetBindingIssues(normalized,project.sourceArtifacts);
    expect(issues.join(" ")).toContain("provisional-intake-id");
    expect(rubricValidation(normalized,project.sourceArtifacts).ready).toBe(false);
  });
  it("does not silently rewrite a real reference artifact into a Target",()=>{
    const criterion={...stale,artifactIds:[reference.id]};
    const project=input([target,reference],[criterion]);
    const normalized=normalizeAcceptanceRubric([criterion],project);
    expect(normalized.find(x=>x.id===stale.id)?.artifactIds).toEqual([reference.id]);
    expect(rubricTargetBindingIssues(normalized,project.sourceArtifacts).join(" ")).toContain("参考材料");
  });
  it("blocks mixed valid and stale IDs even in a single Target project",()=>{
    const criterion={...stale,artifactIds:[target.id,"expired-target-id"]};
    const project=input([target],[criterion]);
    const normalized=normalizeAcceptanceRubric([criterion],project);
    expect(rubricTargetBindingIssues(normalized,project.sourceArtifacts).join(" ")).toContain("expired-target-id");
    expect(rubricValidation(normalized,project.sourceArtifacts).ready).toBe(false);
  });
  it("does not rewrite a historical Candidate contract after validation began",()=>{
    const attempted={...input([target]),baselineRun:{
      id:"measured-baseline",status:"completed" as const,suiteName:"Audit",totalCases:0,runs:[],
    }};
    const normalized=normalizeAcceptanceRubric([stale],attempted);
    expect(normalized.find(x=>x.id===stale.id)?.artifactIds).toEqual(stale.artifactIds);
    expect(rubricTargetBindingIssues(normalized,[target]).length).toBeGreaterThan(0);
  });
  it("allows an intentionally global criterion with an empty Artifact ID scope",()=>{
    expect(rubricTargetBindingIssues([{...stale,artifactIds:[]}],[target])).toEqual([]);
  });
});
