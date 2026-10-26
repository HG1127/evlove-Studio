import {describe,expect,it} from "vitest";
import {AcceptanceCriterionSchema,TestCaseSchema} from "@evolution/contracts";
import {htmlNativeEvidenceFixture} from "@evolution/testkit";
import {inspectHtmlNativeEvidence} from "./html-native-evidence";
import {deriveCriterionScores} from "./evaluation-settlement";

const criterion=AcceptanceCriterionSchema.parse({id:"PROTECT-ALL",title:"保护原有功能",requirement:"保留原有交互与样式",source:"user-command",weight:1,minScore:95,hardGate:true,validationMethod:"executable-test",artifactIds:["source-html"]});
const test=TestCaseSchema.parse({id:"native-case",title:"保护测试",input:"检查交互",expected:["保持功能"],criterionIds:[criterion.id],executionMode:"external-runner",tags:["source-grounded-html-assertions"]});
const judge=[{criterionId:criterion.id,score:99,pass:true,evidence:["Independent semantic review"],gaps:[],testCaseIds:[test.id]}];

describe("bound native HTML evidence",()=>{
  it("does not accept contradictory code retention counts",()=>{
    const run=htmlNativeEvidenceFixture();
    run.nativeHtmlProof!.observation.codeBlockRetention={policy:"original-text-with-numbered-instruction-append-v1",originalCount:2,retainedCount:2,exactCount:1,extendedInstructionCount:1,retained:true};
    expect(inspectHtmlNativeEvidence(run,test.id,"source-html","a".repeat(64))).toMatchObject({complete:true,pass:true});
    run.nativeHtmlProof!.observation.codeBlockRetention.exactCount=2;
    expect(inspectHtmlNativeEvidence(run,test.id,"source-html","a".repeat(64))).toBeUndefined();
  });
  it("recognizes complete observations without generating a semantic verdict",()=>{
    const run=htmlNativeEvidenceFixture();
    expect(inspectHtmlNativeEvidence(run,test.id,"source-html","a".repeat(64))).toMatchObject({complete:true,pass:true});
    expect(deriveCriterionScores([criterion],[test],[],[run]).criterionScores[0]).toMatchObject({pass:false,verificationStatus:"unverified"});
    expect(deriveCriterionScores([criterion],[test],[],[run],judge).criterionScores[0]).toMatchObject({pass:true,verificationStatus:"verified"});
  });
  it.each(["case","source","hash","text","paragraphs","missing-check","duplicate-check","tested","query","style","failed-count"])("rejects a %s mismatch",kind=>{
    const run=htmlNativeEvidenceFixture(),observation=run.nativeHtmlProof!.observation;
    if(kind==="case")run.testCaseId="different";
    if(kind==="source")run.nativeHtmlProof!.sourceArtifactId="other-source";
    if(kind==="hash")run.artifactHash="f".repeat(64);
    if(kind==="text")run.renderedDocumentEvidence!.text+=" altered";
    if(kind==="paragraphs")run.renderedDocumentEvidence!.paragraphs[0]!.viewport=900;
    if(kind==="missing-check")observation.subject.checks.shift();
    if(kind==="duplicate-check")observation.subject.checks.push(observation.subject.checks[0]!);
    if(kind==="tested")observation.subject.checks.find(row=>row.id==="all-checklist-items-toggle-and-restore")!.tested=0;
    if(kind==="query")observation.subject.checks.find(row=>row.id.startsWith("content-search"))!.query="different";
    if(kind==="style")observation.styleComparison[0]!.namedElementsCompared=1;
    if(kind==="failed-count")observation.subject.checks.find(row=>row.tested===1)!.failed=1;
    expect(inspectHtmlNativeEvidence(run,test.id,"source-html")).toBeUndefined();
  });
  it("settles an actual new-content search regression as a failure even if Judge says 99/pass",()=>{
    const run=htmlNativeEvidenceFixture(),observation=run.nativeHtmlProof!.observation;
    const check=observation.subject.checks.find(row=>row.id.startsWith("content-search"))!;
    check.matched=false;check.pass=false;observation.subject.failures=[check.id];
    expect(inspectHtmlNativeEvidence(run,test.id)).toMatchObject({complete:true,pass:false,failures:[check.id]});
    expect(deriveCriterionScores([criterion],[test],[],[run],judge).criterionScores[0]).toMatchObject({score:0,pass:false,verificationStatus:"verified"});
  });
  it("retains a measured loss of original code blocks as a complete negative observation",()=>{
    const run=htmlNativeEvidenceFixture(),observation=run.nativeHtmlProof!.observation;
    observation.originalCodeBlocksRetained=false;
    observation.codeBlockRetention={policy:"original-text-with-numbered-instruction-append-v1",originalCount:57,retainedCount:55,
      exactCount:55,extendedInstructionCount:0,retained:false};
    expect(inspectHtmlNativeEvidence(run,test.id)).toMatchObject({complete:true,pass:false,failures:["original-code-block-loss"]});
    expect(deriveCriterionScores([criterion],[test],[],[run],judge).criterionScores[0]).toMatchObject({score:0,pass:false,verificationStatus:"verified"});
    // Positive tool checks still cannot substitute for an independent semantic verdict.
    expect(deriveCriterionScores([criterion],[test],[],[run]).criterionScores[0]).toMatchObject({score:0,pass:false,verificationStatus:"verified"});
  });
  it("does not turn code-loss counts into coverage for unknown controls or an unhealthy Original",()=>{
    const run=htmlNativeEvidenceFixture(),observation=run.nativeHtmlProof!.observation;
    observation.originalCodeBlocksRetained=false;
    observation.codeBlockRetention={policy:"original-text-with-numbered-instruction-append-v1",originalCount:57,retainedCount:55,
      exactCount:55,extendedInstructionCount:0,retained:false};
    observation.subject.inventory.unknownControls=[{tag:"BUTTON",type:"submit",id:"unknown"}];
    expect(inspectHtmlNativeEvidence(run,test.id)?.complete).toBe(false);
    observation.subject.inventory.unknownControls=[];
    observation.original.checks[0]!.pass=false;observation.original.failures=[observation.original.checks[0]!.id];
    expect(inspectHtmlNativeEvidence(run,test.id)?.complete).toBe(false);
  });
  it.each(["unhealthy-original","unknown-control","changed-code"])("keeps %s incomplete rather than inventing success or failure",kind=>{
    const run=htmlNativeEvidenceFixture(),observation=run.nativeHtmlProof!.observation;
    if(kind==="unhealthy-original"){observation.original.checks[0]!.pass=false;observation.original.failures=[observation.original.checks[0]!.id];}
    if(kind==="unknown-control")observation.subject.inventory.unknownControls=[{tag:"BUTTON",type:"submit",id:"unknown"}];
    if(kind==="changed-code")observation.originalCodeBlocksRetained=false;
    expect(inspectHtmlNativeEvidence(run,test.id)?.complete).toBe(false);
    expect(deriveCriterionScores([criterion],[test],[],[run],judge).criterionScores[0]).toMatchObject({pass:false,verificationStatus:"partial"});
  });
});
