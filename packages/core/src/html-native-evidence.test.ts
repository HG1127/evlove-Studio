import {describe,expect,it} from "vitest";
import {AcceptanceCriterionSchema,TestCaseSchema} from "@evolution/contracts";
import {htmlNativeEvidenceFixture} from "@evolution/testkit";
import {inspectHtmlNativeEvidence} from "./html-native-evidence";
import {deriveCriterionScores} from "./evaluation-settlement";

const criterion=AcceptanceCriterionSchema.parse({id:"PROTECT-ALL",title:"保护原有功能",requirement:"保留原有交互与样式",source:"user-command",weight:1,minScore:95,hardGate:true,validationMethod:"executable-test",artifactIds:["source-html"]});
const test=TestCaseSchema.parse({id:"native-case",title:"保护测试",input:"检查交互",expected:["保持功能"],criterionIds:[criterion.id],executionMode:"external-runner",tags:["source-grounded-html-assertions"]});
const judge=[{criterionId:criterion.id,score:99,pass:true,evidence:["Independent semantic review"],gaps:[],testCaseIds:[test.id]}];

describe("bound native HTML evidence",()=>{
  it.each(["matched-body-focus","different-focus","independent-code-loss","computed-style-loss"])("qualifies V2 %s without inventing a new artifact failure or losing an independent one",kind=>{
    const run=htmlNativeEvidenceFixture(),o=run.nativeHtmlProof!.observation;
    const state={requestedHref:"#c01",locationHref:"#c01",activeHref:"#c01",focusedHref:null,menuOpen:false,focus:{path:"HTML:0/BODY:1",documentFocused:true}};
    for(const row of o.styleComparison)row.state={policy:"source-navigation-style-v2",original:structuredClone(state),subject:structuredClone(state)};
    if(kind==="different-focus"||kind==="independent-code-loss"){
      const row=o.styleComparison[0]!;if(row.state?.policy!=="source-navigation-style-v2")throw Error('Missing V2 fixture');
      row.state.subject.focus.path="HTML:0/BODY:1/BUTTON:0";row.pass=false;
    }
    if(kind==="independent-code-loss"){
      o.originalCodeBlocksRetained=false;o.codeBlockRetention={policy:"original-text-with-numbered-instruction-append-v1",originalCount:57,retainedCount:55,exactCount:55,extendedInstructionCount:0,retained:false};
    }
    if(kind==="computed-style-loss"){o.styleComparison[0]!.changedNamed=["source-element"];o.styleComparison[0]!.pass=false;}
    const result=inspectHtmlNativeEvidence(run,test.id);
    if(kind==="matched-body-focus")expect(result).toMatchObject({originalHealthy:true,complete:true,pass:true,styleMeasurementPending:false});
    if(kind==="different-focus")expect(result).toMatchObject({originalHealthy:true,complete:false,pass:false,styleMeasurementPending:true,failures:[]});
    if(kind==="independent-code-loss"){
      expect(result).toMatchObject({complete:true,pass:false,styleMeasurementPending:true,failures:["original-code-block-loss"]});
      expect(deriveCriterionScores([criterion],[test],[],[run],judge).criterionScores[0]).toMatchObject({score:0,pass:false,verificationStatus:"verified"});
    }
    if(kind==="computed-style-loss")expect(result).toMatchObject({complete:true,pass:false,styleMeasurementPending:false,failures:["rendered-style-1440"]});
  });
  it.each(["candidate-state","original-state","missing-viewport","foreign-target"])("keeps %s style-state evidence truthful",kind=>{
    const run=htmlNativeEvidenceFixture(),o=run.nativeHtmlProof!.observation;
    const state={requestedHref:"#c01",locationHref:"#c01",activeHref:"#c01",focusedHref:"#c01",menuOpen:false};
    for(const row of o.styleComparison)row.state={policy:"source-navigation-style-v1",original:{...state},subject:{...state}};
    expect(inspectHtmlNativeEvidence(run,test.id)).toMatchObject({complete:true,pass:true});
    const row=o.styleComparison[0]!;
    if(kind==="candidate-state"){row.state!.subject.activeHref="#c02";row.pass=false;}
    if(kind==="original-state"){row.state!.original.activeHref="#c02";row.pass=false;}
    if(kind==="missing-viewport")delete row.state;
    if(kind==="foreign-target")for(const s of [row.state!.original,row.state!.subject])Object.assign(s,{requestedHref:"#other",locationHref:"#other",activeHref:"#other",focusedHref:"#other"});
    const measured=inspectHtmlNativeEvidence(run,test.id);
    if(kind==="candidate-state")expect(measured).toMatchObject({complete:true,pass:false,originalHealthy:true,failures:["rendered-style-1440"]});
    if(kind==="original-state")expect(measured).toMatchObject({complete:false,pass:false,originalHealthy:false});
    if(kind==="missing-viewport"||kind==="foreign-target")expect(measured).toBeUndefined();
  });
  it("does not reuse an old physical report for newly declared browser predicates",()=>{
    const run=htmlNativeEvidenceFixture(),stepped={...test,browserSteps:[{action:"visible" as const,selector:"#search"}]};
    expect(inspectHtmlNativeEvidence(run,test.id,undefined,undefined,stepped.browserSteps)).toBeUndefined();
    expect(deriveCriterionScores([criterion],[stepped],[],[run],judge).criterionScores[0]).toMatchObject({pass:false,verificationStatus:"partial"});
  });
  it("requires every declared predicate on both physical subjects, preserves negative steps, and still requires Judge",()=>{
    const run=htmlNativeEvidenceFixture(),o=run.nativeHtmlProof!.observation;
    const steps=[{action:"visible" as const,selector:"#search"},{action:"count" as const,selector:".slide-card.search-hidden",count:0}];
    const stepped={...test,browserSteps:steps};
    o.browserAssertions={schemaVersion:"source-grounded-browser-assertions-v1",plans:[steps]};
    for(const subject of [o.original,o.subject])subject.checks.push(...steps.map((_,index)=>({id:`declared-browser-0-${index}`,pass:true,tested:1,failed:0})));
    expect(inspectHtmlNativeEvidence(run,test.id,undefined,undefined,steps)).toMatchObject({complete:true,pass:true});
    expect(deriveCriterionScores([criterion],[stepped],[],[run]).criterionScores[0]).toMatchObject({pass:false,verificationStatus:"unverified"});
    expect(deriveCriterionScores([criterion],[stepped],[],[run],judge).criterionScores[0]).toMatchObject({pass:true,verificationStatus:"verified"});
    const last=o.subject.checks.at(-1)!;last.pass=false;last.failed=1;o.subject.failures=[last.id];
    expect(deriveCriterionScores([criterion],[stepped],[],[run],judge).criterionScores[0]).toMatchObject({score:0,pass:false,verificationStatus:"verified"});
    expect(inspectHtmlNativeEvidence(run,test.id,undefined,undefined,[...steps].reverse())).toBeUndefined();
    o.original.checks.pop();
    expect(inspectHtmlNativeEvidence(run,test.id,undefined,undefined,steps)).toBeUndefined();
  });
  it("rejects duplicate plans and a declared step with no execution count",()=>{
    const run=htmlNativeEvidenceFixture(),o=run.nativeHtmlProof!.observation,steps=[{action:"visible" as const,selector:"#search"}];
    o.browserAssertions={schemaVersion:"source-grounded-browser-assertions-v1",plans:[steps,steps]};
    expect(inspectHtmlNativeEvidence(run,test.id)).toBeUndefined();
    o.browserAssertions.plans=[steps];
    for(const subject of [o.original,o.subject])subject.checks.push({id:"declared-browser-0-0",pass:true});
    expect(inspectHtmlNativeEvidence(run,test.id)).toBeUndefined();
  });
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
