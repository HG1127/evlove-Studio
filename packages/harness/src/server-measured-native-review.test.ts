import {describe,expect,it} from "vitest";
import {htmlNativeEvidenceFixture} from "@evolution/testkit";
import {measuredNativeObservations} from "./server-measured-native-review";
import {measuredDocumentObservations} from "./server-measured-review-evidence";

describe("measured native facts for review, never automatic acceptance",()=>{
  it("projects a matched V2 body focus as qualification booleans without disclosing its DOM path",()=>{
    const run=htmlNativeEvidenceFixture(),state={requestedHref:"#c01",locationHref:"#c01",activeHref:"#c01",focusedHref:null,menuOpen:false,focus:{path:"HTML:0/BODY:1",documentFocused:true}};
    for(const row of run.nativeHtmlProof!.observation.styleComparison)row.state={policy:"source-navigation-style-v2",original:structuredClone(state),subject:structuredClone(state)};
    const facts=measuredNativeObservations([run]).observations[0]!.facts;
    expect(facts.styleComparison[0]!.state).toEqual({policy:"source-navigation-style-v2",originalMatchesSource:true,subjectMatchesSource:true});
    expect(JSON.stringify(facts)).not.toContain("HTML:0/BODY:1");
  });
  it("carries state qualification without raw navigation attributes, and never invents it for legacy observations",()=>{
    const run=htmlNativeEvidenceFixture(),legacy=measuredNativeObservations([run]);
    expect(legacy.observations[0]!.facts.styleComparison[0]).not.toHaveProperty("state");
    const state={requestedHref:"#c01",locationHref:"#c01",activeHref:"#c01",focusedHref:"#c01",menuOpen:false};
    for(const row of run.nativeHtmlProof!.observation.styleComparison)row.state={policy:"source-navigation-style-v1",original:{...state},subject:{...state}};
    const projected=measuredNativeObservations([run]).observations[0]!.facts.styleComparison[0]!;
    expect(projected.state).toEqual({policy:"source-navigation-style-v1",originalMatchesSource:true,subjectMatchesSource:true});
    expect(projected.state).not.toHaveProperty("original");expect(JSON.stringify(projected.state)).not.toContain("#c01");
    run.nativeHtmlProof!.observation.styleComparison[0]!.state!.subject.activeHref="#other";
    run.nativeHtmlProof!.observation.styleComparison[0]!.pass=false;
    expect(measuredNativeObservations([run]).observations[0]!.facts.styleComparison[0]!.state).toMatchObject({originalMatchesSource:true,subjectMatchesSource:false});
  });
  it("carries source/hashes and exact measured control/style counts without granting a Criterion score",()=>{
    const run=htmlNativeEvidenceFixture(),result=measuredNativeObservations([run]);
    expect(result.observations).toHaveLength(1);
    expect(result.observations[0]).toMatchObject({testCaseIds:[run.testCaseId],facts:{scope:"known-renderer-physical-observations-only",sourceArtifactId:"source-html",profilePass:true,
      original:{sha256:"e".repeat(64)},subject:{sha256:run.artifactHash},styleComparison:[{width:1440,propertyCount:50,pass:true},{width:390,propertyCount:50,pass:true}]}});
    expect(JSON.stringify(result)).not.toContain('"score"');
  });
  it("deduplicates the same physical report across distinct actual case identities",()=>{
    const first=htmlNativeEvidenceFixture(),second=structuredClone(first);second.testCaseId="other-case";second.nativeHtmlProof!.testCaseId=second.testCaseId;
    const result=measuredNativeObservations([first,second]);
    expect(result.observations).toHaveLength(1);expect(result.observations[0]!.testCaseIds).toEqual([first.testCaseId,second.testCaseId]);
  });
  it("retains complete measured failures instead of dropping negative physical observations",()=>{
    const run=htmlNativeEvidenceFixture(),o=run.nativeHtmlProof!.observation;
    o.subject.checks.find(check=>check.id==="no-runtime-errors")!.pass=false;o.subject.failures=["no-runtime-errors"];
    expect(measuredNativeObservations([run]).observations[0]!.facts).toMatchObject({profilePass:false,failures:["no-runtime-errors"],subject:{failedCheckCount:1}});
  });
  it("preserves measured original-block loss without claiming an unavailable observer",()=>{
    const run=htmlNativeEvidenceFixture(),o=run.nativeHtmlProof!.observation;o.originalCodeBlocksRetained=false;
    o.codeBlockRetention={policy:"original-text-with-numbered-instruction-append-v1",originalCount:2,retainedCount:1,exactCount:1,extendedInstructionCount:0,retained:false};
    expect(measuredNativeObservations([run]).observations[0]!.facts).toMatchObject({profilePass:false,retention:{retained:false},failures:["original-code-block-loss"]});
  });
  it.each(["body-hash","case-id","artifact-hash","partial","error","missing-style","unhealthy-original"])("omits %s evidence instead of strengthening it",kind=>{
    const run=htmlNativeEvidenceFixture();
    if(kind==="body-hash")run.renderedDocumentEvidence!.text+="unmeasured";
    if(kind==="case-id")run.nativeHtmlProof!.testCaseId="different";
    if(kind==="artifact-hash")run.artifactHash="f".repeat(64);
    if(kind==="partial")run.verificationStatus="partial";
    if(kind==="error")run.error="not complete";
    if(kind==="missing-style")run.nativeHtmlProof!.observation.styleComparison.pop();
    if(kind==="unhealthy-original"){const o=run.nativeHtmlProof!.observation;o.original.checks.find(c=>c.id==="no-runtime-errors")!.pass=false;o.original.failures=["no-runtime-errors"];}
    expect(measuredNativeObservations([run])).toEqual({observations:[],omittedTestCaseIds:[run.testCaseId]});
  });
  it("rejects duplicate case identities even when their receipts look individually valid",()=>{
    const run=htmlNativeEvidenceFixture();expect(measuredNativeObservations([run,structuredClone(run)])).toEqual({observations:[],omittedTestCaseIds:[run.testCaseId]});
  });
  it("does not echo query text, style group contents, unknown raw fields or producer prose",()=>{
    const run=htmlNativeEvidenceFixture(),o=run.nativeHtmlProof!.observation,secret="RAW_SCRIPT_STYLE_SECRET";
    o.subject.checks[0]!.query=secret;Object.assign(o.subject.checks[0]!,{rawStyle:secret});o.limitations=[secret];
    o.styleComparison[0]!.missingGroups=[secret];o.styleComparison[0]!.pass=false;
    const result=measuredNativeObservations([run]);expect(result.observations).toHaveLength(1);
    expect(result.observations[0]!.facts.styleComparison[0]).toMatchObject({missingGroupCount:1,pass:false});
    expect(JSON.stringify(result)).not.toContain(secret);
  });
  it("reports native-fact budget omissions and keeps measured body observations separate",()=>{
    const run=htmlNativeEvidenceFixture();expect(measuredNativeObservations([run],1)).toEqual({observations:[],omittedTestCaseIds:[run.testCaseId]});
    const result=measuredDocumentObservations([run],1);expect(result.observations).toEqual([]);expect(result.nativeObservations).toHaveLength(1);
  });
  it.each(["source","subject","original","duplicate-binding"])("rejects a %s mismatch against trusted Candidate bindings",kind=>{
    const run=htmlNativeEvidenceFixture(),binding={sourceArtifactId:"source-html",subjectSha256:run.artifactHash!,originalSha256:"e".repeat(64)};
    if(kind==="source")binding.sourceArtifactId="other-source";
    if(kind==="subject")binding.subjectSha256="f".repeat(64);
    if(kind==="original")binding.originalSha256="f".repeat(64);
    const result=measuredDocumentObservations([run],undefined,kind==="duplicate-binding"?[binding,binding]:[binding]);
    expect(result.observations).toEqual([]);expect(result.nativeObservations).toEqual([]);expect(result.omittedNativeTestCaseIds).toEqual([run.testCaseId]);
  });
});
