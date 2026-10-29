import {describe,expect,it} from "vitest";
import {htmlNativeEvidenceFixture} from "@evolution/testkit";
import {ExecuteArtifactAiResultSchema,ExecuteArtifactBatchAiResultSchema} from "./ai-schemas";
import {HtmlNativeBrowserAssertionsSchema,HtmlNativeStyleComparisonSchema,SandboxHtmlNativeResponseSchema} from "./html-native-observation-contract";

describe("native observation trust boundary",()=>{
  it("retains legacy unavailable responses and permits only the explicit payment-required reason code",()=>{
    const legacy={status:"unavailable",reason:"Unsupported profile"};
    expect(SandboxHtmlNativeResponseSchema.parse(legacy)).toEqual(legacy);
    expect(SandboxHtmlNativeResponseSchema.parse({...legacy,reasonCode:"payment-required"})).toHaveProperty("reasonCode","payment-required");
    expect(SandboxHtmlNativeResponseSchema.safeParse({...legacy,reasonCode:"success"}).success).toBe(false);
    expect(SandboxHtmlNativeResponseSchema.safeParse({...legacy,httpStatus:402}).success).toBe(false);
  });
  it("preserves legacy style receipts without inventing matching UI state",()=>{
    const legacy=htmlNativeEvidenceFixture().nativeHtmlProof!.observation.styleComparison[0]!;
    expect(HtmlNativeStyleComparisonSchema.parse(legacy)).toEqual(legacy);
    expect(HtmlNativeStyleComparisonSchema.parse(legacy)).not.toHaveProperty("state");
  });
  it("qualifies an explicit source navigation state without hiding failed comparisons",()=>{
    const legacy=htmlNativeEvidenceFixture().nativeHtmlProof!.observation.styleComparison[0]!,state={requestedHref:"#c01",locationHref:"#c01",activeHref:"#c01",focusedHref:"#c01",menuOpen:false};
    const value={...legacy,state:{policy:"source-navigation-style-v1",original:{...state},subject:{...state}}};
    expect(HtmlNativeStyleComparisonSchema.safeParse(value).success).toBe(true);
    value.state.subject.activeHref="#c02";expect(HtmlNativeStyleComparisonSchema.safeParse(value).success).toBe(false);
    value.pass=false;expect(HtmlNativeStyleComparisonSchema.parse(value).state!.subject.activeHref).toBe("#c02");
  });
  it("keeps V1 prescribed focus unchanged while V2 compares complete observed focus",()=>{
    const base=htmlNativeEvidenceFixture().nativeHtmlProof!.observation.styleComparison[0]!,nav={requestedHref:"#c01",locationHref:"#c01",activeHref:"#c01",focusedHref:null,menuOpen:false};
    const legacy={...base,state:{policy:"source-navigation-style-v1",original:{...nav},subject:{...nav}}};
    expect(HtmlNativeStyleComparisonSchema.safeParse(legacy).success).toBe(false);
    expect(HtmlNativeStyleComparisonSchema.parse({...legacy,pass:false}).pass).toBe(false);
    const current={...base,state:{policy:"source-navigation-style-v2",original:{...nav,focus:{path:"HTML:0/BODY:1",documentFocused:true}},subject:{...nav,focus:{path:"HTML:0/BODY:1",documentFocused:true}}}};
    expect(HtmlNativeStyleComparisonSchema.parse(current)).toEqual(current);
    current.state.subject.focus.path="HTML:0/BODY:1/BUTTON:0";expect(HtmlNativeStyleComparisonSchema.safeParse(current).success).toBe(false);
    expect(HtmlNativeStyleComparisonSchema.parse({...current,pass:false}).pass).toBe(false);
    current.state.subject.focus.path="HTML:0/BODY:1";current.state.subject.focus.documentFocused=false;
    expect(HtmlNativeStyleComparisonSchema.safeParse(current).success).toBe(false);
    const missing=structuredClone(current);delete (missing.state.original as {focus?:unknown}).focus;
    expect(HtmlNativeStyleComparisonSchema.safeParse(missing).success).toBe(false);
  });
  it("accepts only a bounded, versioned predicate plan, without arbitrary actions, question prose or duplicate plans",()=>{
    const plan={schemaVersion:"source-grounded-browser-assertions-v1",plans:[[{action:"visible",selector:"#search"}]]};
    expect(HtmlNativeBrowserAssertionsSchema.parse(plan)).toEqual(plan);
    for(const value of [{...plan,question:"reserved"},{...plan,plans:[[{action:"click",selector:"#search"}]]},
      {...plan,plans:[[{action:"count",selector:"#search"}]]},{...plan,plans:[plan.plans[0],plan.plans[0]]},
      {...plan,plans:[[{action:"fill",selector:"#search",value:"x".repeat(81)}]]},
      {...plan,plans:[[{action:"visible",selector:"#search",expected:"secret answer"}]]}]){
      expect(HtmlNativeBrowserAssertionsSchema.safeParse(value).success).toBe(false);
    }
  });
  it("does not accept server-only native or rendered-document proof from a single AI execute response",()=>{
    const {nativeHtmlProof,renderedDocumentEvidence}=htmlNativeEvidenceFixture();
    const result=ExecuteArtifactAiResultSchema.parse({output:"Model claim",nativeHtmlProof,renderedDocumentEvidence});
    expect(result).not.toHaveProperty("nativeHtmlProof");expect(result).not.toHaveProperty("renderedDocumentEvidence");
  });
  it("does not accept server-only proof from an AI batch row",()=>{
    const {nativeHtmlProof,renderedDocumentEvidence}=htmlNativeEvidenceFixture();
    const result=ExecuteArtifactBatchAiResultSchema.parse({results:[{testCaseId:"native-case",output:"Model claim",nativeHtmlProof,renderedDocumentEvidence}]});
    expect(result.results[0]).not.toHaveProperty("nativeHtmlProof");expect(result.results[0]).not.toHaveProperty("renderedDocumentEvidence");
  });
});
