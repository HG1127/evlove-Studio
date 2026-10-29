// @vitest-environment node
import {readFileSync} from "node:fs";
import {describe,expect,it,vi} from "vitest";
import {HTML_NATIVE_PROFILE_ID} from "@evolution/contracts";
import {htmlNativeProgramIdentity} from "@evolution/core";
import {nativeHtmlSha256,type HtmlNativeProfile} from "./profile";
import {runLocalKnownHtmlNativeProfile,type LocalHtmlNativeKernelPort} from "./local-runner";
import {HTML_NATIVE_KERNEL_SOURCE} from "./kernel";
import {HTML_NATIVE_DECLARED_STEPS_SOURCE} from "./declared-steps";

const original='<html><head><style>p{color:red}</style><script>const keep=true;</script></head><body><article id="slide-1" class="slide-card" data-search="old"><div class="slide-body"><p>old</p></div></article></body></html>';
const subject=original.replace('<p>old</p>','<p>new_configuration</p>');
const id=htmlNativeProgramIdentity(original,nativeHtmlSha256);
const profiles:HtmlNativeProfile[]=[{id:HTML_NATIVE_PROFILE_ID,programSignature:id.signature,styleSignature:id.styleSignature}];
const request=()=>({original:Buffer.from(original),subject:Buffer.from(subject),expectedOriginalSha256:nativeHtmlSha256(original),expectedSubjectSha256:nativeHtmlSha256(subject)});
function fixture(){
  const inventory={cards:1,menu:1,top:1,progress:1,pageCopy:1,promptCopy:0,editablePrompts:0,checkItems:1,checkPanels:1,details:0,internalLinks:["#c01"],unknownControls:[]};
  const measured=(label:string,text:string)=>({label,sha256:nativeHtmlSha256(text),inventory,checks:[{id:"initial-card-inventory",pass:true,count:1}],failures:[] as string[],elapsedMs:10,renderedParagraphs:[1440,390].map(viewport=>({viewport,paragraphs:[]})),bodyText:label==="original"?"old":"new_configuration"});
  const state={requestedHref:"#c01",locationHref:"#c01",activeHref:"#c01",focusedHref:null,menuOpen:false,focus:{path:"HTML:0/BODY:1",documentFocused:true}};
  const result={kernelSha256:"a".repeat(64),runId:"local-native-fixture",browserVersion:"156.0",measurement:{observedAt:"2026-10-29T06:00:00.000Z",results:[measured("original",original),measured("candidate",subject)],styleComparison:[1440,390].map(width=>({width,propertyCount:50,namedElementsCompared:1,styleGroupsCompared:2,changedNamed:[],missingGroups:[],infiniteAnimations:0,pass:true,state:{policy:"source-navigation-style-v2",original:structuredClone(state),subject:structuredClone(state)}}))}};
  return {result,port:{kernelSha256:result.kernelSha256,execute:vi.fn(async(args:Parameters<LocalHtmlNativeKernelPort["execute"]>[0])=>{void args;return result;})}};
}
describe("local native admission",()=>{
  it("preserves the complete VM assertion body and declared steps verbatim",()=>{
    const local=readFileSync("tools/local-runner/native-html-observer.mjs","utf8").replaceAll("\r\n","\n");
    const body=(value:string)=>value.slice(value.indexOf("      await runDeclaredBrowserPlans"),value.indexOf("fs.writeFileSync(new URL('../private/protection-observations.json'"));
    const localEnd=local.indexOf("return {observedAt:");
    expect(local.slice(local.indexOf("      await runDeclaredBrowserPlans"),localEnd)).toBe(body(HTML_NATIVE_KERNEL_SOURCE));
    expect(local).toContain(HTML_NATIVE_DECLARED_STEPS_SOURCE);
  });
  it("binds exact bytes and local provenance without claiming a cloud VM or semantic acceptance",async()=>{
    const {result,port}=fixture(),r=request(),out=await runLocalKnownHtmlNativeProfile(r,port,profiles);
    expect(out.status).toBe("observed");if(out.status!=="observed")throw Error("missing receipt");
    expect(out.observation.schemaVersion).toBe("html-native-observation-v2-local-browser");
    expect(out.observation).toHaveProperty("executionBoundary",expect.objectContaining({chromiumSandbox:true,headless:true,freshProcessPerSubject:true,browserVersion:result.browserVersion}));
    expect(port.execute.mock.calls[0]![0]).toEqual({inputs:{originalSha256:r.expectedOriginalSha256,subjectSha256:r.expectedSubjectSha256,expectedCardCount:1,contentSearchQueries:[{cardId:"slide-1",query:"new_configuration"}]},subjects:{original:new Uint8Array(r.original),candidate:new Uint8Array(r.subject)},timeoutMs:170000});
  });
  it.each(["profile","hash","script","style","predicate"])("does not execute %s inputs",async kind=>{
    const {port}=fixture(),r=request();
    if(kind==="hash")r.expectedSubjectSha256="f".repeat(64);
    if(kind==="script"||kind==="style"){r.subject=Buffer.from(subject.replace(kind==="script"?"keep=true":"color:red",kind==="script"?"keep=false":"color:blue"));r.expectedSubjectSha256=nativeHtmlSha256(r.subject);}
    const value=kind==="predicate"?{...r,browserAssertions:{schemaVersion:"source-grounded-browser-assertions-v1" as const,plans:[[{action:"visible" as const,selector:"#unknown"}]]}}:r;
    expect((await runLocalKnownHtmlNativeProfile(value,port,kind==="profile"?[]:profiles)).status).toBe("unavailable");expect(port.execute).not.toHaveBeenCalled();
  });
  it.each(["kernel","subject","incomplete","navigation","exception"])("keeps %s failures unverified",async kind=>{
    const {result,port}=fixture();
    if(kind==="kernel")result.kernelSha256="f".repeat(64);
    if(kind==="subject")result.measurement.results[1]!.sha256="f".repeat(64);
    if(kind==="incomplete")result.measurement.results[1]!.renderedParagraphs=[];
    if(kind==="navigation")result.measurement.styleComparison[0]!.state.subject.activeHref="#wrong";
    if(kind==="exception")port.execute.mockRejectedValue(Error("private infrastructure error"));
    const out=await runLocalKnownHtmlNativeProfile(request(),port,profiles);
    expect(out.status).toBe("unavailable");expect(JSON.stringify(out)).not.toContain("private infrastructure error");
  });
  it("preserves a real failed assertion and a real style difference",async()=>{
    const {result,port}=fixture();result.measurement.results[1]!.checks[0]!.pass=false;result.measurement.results[1]!.failures=["initial-card-inventory"];
    result.measurement.styleComparison[0]!.state.subject.activeHref="#wrong";result.measurement.styleComparison[0]!.pass=false;
    const out=await runLocalKnownHtmlNativeProfile(request(),port,profiles);
    expect(out.status).toBe("observed");if(out.status==="observed"){expect(out.observation.subject.failures).toEqual(["initial-card-inventory"]);expect(out.observation.styleComparison[0]!.pass).toBe(false);}
  });
});
