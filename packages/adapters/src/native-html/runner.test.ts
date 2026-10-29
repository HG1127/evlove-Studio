// @vitest-environment node
import type {Sandbox} from "@vercel/sandbox";
import {describe,expect,it,vi} from "vitest";
import {HTML_NATIVE_PROFILE_ID,ExecuteArtifactAiResultSchema,ExecuteArtifactBatchAiResultSchema,type HtmlNativeBrowserAssertions} from "@evolution/contracts";
import {htmlNativeProgramIdentity,sourceGroundedHtmlSearchSteps} from "@evolution/core";
import {nativeHtmlSha256,type HtmlNativeProfile} from "./profile";
import {runKnownHtmlNativeProfile} from "./runner";

const original='<html><head><style>p{color:red}</style><script>const keep=true;</script></head><body><article id="slide-1" class="slide-card" data-search="old"><div class="slide-body"><p>old</p></div></article></body></html>';
const subject=original.replace('<p>old</p>','<p>new_configuration</p>');
const identity=htmlNativeProgramIdentity(original,nativeHtmlSha256);
const profiles:HtmlNativeProfile[]=[{id:HTML_NATIVE_PROFILE_ID,programSignature:identity.signature,styleSignature:identity.styleSignature}];
const args=()=>({original:new TextEncoder().encode(original),subject:new TextEncoder().encode(subject),expectedOriginalSha256:nativeHtmlSha256(original),expectedSubjectSha256:nativeHtmlSha256(subject)});
const paragraphViews=[1440,390].map(viewport=>({viewport,paragraphs:[]}));
function rawResult(){
  const inventory={cards:1,menu:1,top:1,progress:1,pageCopy:1,promptCopy:0,editablePrompts:0,checkItems:1,checkPanels:1,details:0,internalLinks:["#c01"],unknownControls:[]};
  const measured=(label:string,sha256:string)=>({label,sha256,inventory,checks:[{id:"initial-card-inventory",pass:true,count:1}],failures:[] as string[],elapsedMs:10,renderedParagraphs:paragraphViews,bodyText:label==="original"?"old":"new_configuration"});
  return {observedAt:"2026-10-23T13:00:00.000Z",results:[measured("original",nativeHtmlSha256(original)),measured("candidate",nativeHtmlSha256(subject))],
    styleComparison:[1440,390].map(width=>({width,propertyCount:50,namedElementsCompared:1,styleGroupsCompared:2,changedNamed:[],missingGroups:[],infiniteAnimations:0,pass:true,
      state:{policy:"source-navigation-style-v2",original:{requestedHref:"#c01",locationHref:"#c01",activeHref:"#c01",focusedHref:null as string|null,menuOpen:false,focus:{path:"HTML:0/BODY:1",documentFocused:true}},subject:{requestedHref:"#c01",locationHref:"#c01",activeHref:"#c01",focusedHref:null as string|null,menuOpen:false,focus:{path:"HTML:0/BODY:1",documentFocused:true}}}}))};
}
function envelope(payload:Uint8Array){return {schemaVersion:"native-html-output-v1",sizeBytes:payload.length,sha256:nativeHtmlSha256(payload),payloadBase64:Buffer.from(payload).toString("base64")};}
function runtime(result=rawResult(),exitCode=0,wire=envelope(Buffer.from(JSON.stringify(result)))){
  const writeFiles=vi.fn(),stop=vi.fn(),runCommand=vi.fn(async(args:{cmd:string})=>args.cmd==="mkdir"?{exitCode:0}:{exitCode,stdout:async()=>JSON.stringify(wire)});
  const sandbox={cwd:"/vercel",writeFiles,stop,runCommand} as unknown as Sandbox;
  return {sandbox,writeFiles,stop,runCommand,create:vi.fn(async()=>sandbox)};
}
describe("known isolated native HTML transport",()=>{
  it.each([402,401,403,429,503])("classifies actual SDK HTTP %s provenance without preserving raw service errors",async status=>{
    const create=vi.fn(async()=>{throw Object.assign(new Error("PRIVATE_KEY and Hobby plan usage limit exceeded"),{response:new Response("PRIVATE_BODY",{status})});});
    const result=await runKnownHtmlNativeProfile(args(),create,profiles);
    expect(create).toHaveBeenCalledOnce();expect(result.status).toBe("unavailable");
    expect(result).not.toHaveProperty("observation");expect(JSON.stringify(result)).not.toMatch(/PRIVATE|Hobby/);
    if(status===402)expect(result).toMatchObject({reasonCode:"payment-required"});else expect(result).not.toHaveProperty("reasonCode");
  });
  it("does not classify a plain error message or an unsupported source as a payment limit",async()=>{
    const create=vi.fn(async()=>{throw Error("Status code 402: Hobby plan usage limit exceeded");});
    expect(await runKnownHtmlNativeProfile(args(),create,profiles)).not.toHaveProperty("reasonCode");
    expect(await runKnownHtmlNativeProfile(args(),create,[])).not.toHaveProperty("reasonCode");expect(create).toHaveBeenCalledOnce();
  });
  it.each(["missing","missing-focus","legacy-policy","foreign-source","foreign-subject","foreign-equal-target","wrong-active","wrong-location","wrong-focus","wrong-focus-path","wrong-document-focus","open-menu"])("rejects a claimed passing style comparison with %s navigation state",async kind=>{
    const raw=rawResult(),row=raw.styleComparison[0]!;
    if(kind==="missing")delete (row as {state?:unknown}).state;
    if(kind==="missing-focus")delete (row.state.subject as {focus?:unknown}).focus;
    if(kind==="legacy-policy"){Object.assign(row.state,{policy:"source-navigation-style-v1"});for(const s of [row.state.original,row.state.subject]){delete (s as {focus?:unknown}).focus;s.focusedHref=s.requestedHref;}}
    if(kind==="foreign-source")row.state.original.requestedHref="#foreign";
    if(kind==="foreign-subject")row.state.subject.requestedHref="#foreign";
    if(kind==="foreign-equal-target")for(const state of [row.state.original,row.state.subject])Object.assign(state,{requestedHref:"#foreign",locationHref:"#foreign",activeHref:"#foreign",focusedHref:"#foreign"});
    if(kind==="wrong-active")row.state.subject.activeHref="#other";
    if(kind==="wrong-location")row.state.subject.locationHref="#other";
    if(kind==="wrong-focus")row.state.subject.focusedHref="#other";
    if(kind==="wrong-focus-path")row.state.subject.focus.path="HTML:0/BODY:1/BUTTON:0";
    if(kind==="wrong-document-focus")row.state.subject.focus.documentFocused=false;
    if(kind==="open-menu")row.state.subject.menuOpen=true;
    const vm=runtime(raw),result=await runKnownHtmlNativeProfile(args(),vm.create,profiles);
    expect(result.status).toBe("unavailable");expect(vm.stop).toHaveBeenCalledTimes(1);
  });
  it("preserves observed unequal navigation states as a failing comparison rather than relabelling them equal",async()=>{
    const raw=rawResult();raw.styleComparison[0]!.state.subject.activeHref="#other";raw.styleComparison[0]!.pass=false;
    const result=await runKnownHtmlNativeProfile(args(),runtime(raw).create,profiles);
    expect(result.status).toBe("observed");if(result.status==="observed")expect(result.observation.styleComparison[0]).toMatchObject({pass:false,state:{subject:{activeHref:"#other"}}});
  });
  it("transports only source-derived plans and refuses a missing or substituted execution receipt",async()=>{
    const source=original.replace("<body>",'<body><input id="search"><span id="searchCount"></span>').replace("p{color:red}","p{color:red}.search-hidden{display:none}")
      .replace("const keep=true;","const keep=true;search.addEventListener('input',()=>card.dataset.search.includes(search.value));");
    const id=htmlNativeProgramIdentity(source,nativeHtmlSha256),steps=sourceGroundedHtmlSearchSteps(source)!;
    const assertions:HtmlNativeBrowserAssertions={schemaVersion:"source-grounded-browser-assertions-v1",plans:[steps]};
    const request={original:Buffer.from(source),subject:Buffer.from(source),expectedOriginalSha256:nativeHtmlSha256(source),expectedSubjectSha256:nativeHtmlSha256(source),browserAssertions:assertions};
    const allowed:HtmlNativeProfile[]=[{id:HTML_NATIVE_PROFILE_ID,programSignature:id.signature,styleSignature:id.styleSignature}];
    const raw:ReturnType<typeof rawResult>&{browserAssertions?:HtmlNativeBrowserAssertions}=rawResult();
    for(const subject of raw.results)subject.sha256=nativeHtmlSha256(source);
    const missing=runtime(raw);expect((await runKnownHtmlNativeProfile(request,missing.create,allowed)).status).toBe("unavailable");
    expect(missing.stop).toHaveBeenCalledTimes(1);
    raw.browserAssertions=assertions;
    const vm=runtime(raw),result=await runKnownHtmlNativeProfile(request,vm.create,allowed);
    expect(result.status==="observed"&&result.observation.browserAssertions).toEqual(assertions);
    const files=vm.writeFiles.mock.calls[0]![0] as Array<{path:string;content:Buffer}>;
    const input=JSON.parse(files.find(file=>file.path.endsWith("native-input.json"))!.content.toString());
    expect(input.browserAssertions).toEqual(assertions);expect(input).not.toHaveProperty("testCases");
    const changed=structuredClone(request);changed.browserAssertions.plans[0]![0]!.selector="#custom";
    const rejected=runtime(raw);expect((await runKnownHtmlNativeProfile(changed,rejected.create,allowed)).status).toBe("unavailable");
    expect(rejected.create).not.toHaveBeenCalled();
  });
  it("preserves multibyte body text across every possible log byte boundary",async()=>{
    const raw=rawResult(),text="中文配置：提交后检查 🚀 é；原文包含真实替换字符 �";
    raw.results[1]!.bodyText=text;
    const encoded=Buffer.from(JSON.stringify(envelope(Buffer.from(JSON.stringify(raw)))));
    for(let split=0;split<=encoded.length;split++){
      const received=encoded.subarray(0,split).toString("utf8")+encoded.subarray(split).toString("utf8");
      expect(JSON.parse(received)).toEqual(JSON.parse(encoded.toString("utf8")));
    }
    const result=await runKnownHtmlNativeProfile(args(),runtime(raw).create,profiles);
    expect(result.status==="observed"&&result.subjectText).toBe(text);
  });
  it.each(["size","hash","payload","legacy","invalid-utf8"])("rejects %s wire corruption and stops the VM",async kind=>{
    const raw=rawResult();let wire:object=envelope(Buffer.from(JSON.stringify(raw)));
    if(kind==="size")wire={...wire,sizeBytes:1};
    if(kind==="hash")wire={...wire,sha256:"f".repeat(64)};
    if(kind==="payload")wire={...wire,payloadBase64:"e30="};
    if(kind==="legacy")wire=raw;
    if(kind==="invalid-utf8")wire=envelope(new Uint8Array([0xff]));
    const vm=runtime(raw,0,wire as ReturnType<typeof envelope>);
    expect((await runKnownHtmlNativeProfile(args(),vm.create,profiles)).status).toBe("unavailable");
    expect(vm.stop).toHaveBeenCalledTimes(1);
  });
  it("transports exact source bytes and emits observations without claiming acceptance or monetary cost",async()=>{
    const vm=runtime();const result=await runKnownHtmlNativeProfile(args(),vm.create,profiles);
    expect(result.status).toBe("observed");if(result.status!=="observed")throw Error("missing observed result");
    expect(result.observation.subject.sha256).toBe(args().expectedSubjectSha256);
    expect(result.subjectText).toBe("new_configuration");expect(result.observation.billingStatus).toBe("unavailable");
    expect(result.observation.contentSearchQueries).toEqual([{cardId:"slide-1",query:"new_configuration"}]);
    const files=vm.writeFiles.mock.calls[0]![0] as Array<{path:string;content:Buffer}>;
    expect(files.find(file=>file.path.endsWith('/candidate.html'))?.content.toString()).toBe(subject);
    expect(JSON.parse(files.find(file=>file.path.endsWith('/native-input.json'))!.content.toString())).toMatchObject({expectedCardCount:1,subjectSha256:args().expectedSubjectSha256});
    for(const [command] of vm.runCommand.mock.calls)expect(command).not.toHaveProperty("env");
    expect(vm.stop).toHaveBeenCalledTimes(1);
  });
  it("does not turn a measured failing assertion into a passing observation",async()=>{
    const raw=rawResult();raw.results[1]!.checks[0]!.pass=false;raw.results[1]!.failures=["initial-card-inventory"];
    const vm=runtime(raw),result=await runKnownHtmlNativeProfile(args(),vm.create,profiles);
    expect(result.status).toBe("observed");if(result.status==="observed")expect(result.observation.subject.checks[0]?.pass).toBe(false);
  });
  it.each(["unsupported","hash","changed-program","changed-style"])("never starts a VM for %s subjects",async kind=>{
    const vm=runtime(),request=args();
    if(kind==="hash")request.expectedSubjectSha256="f".repeat(64);
    if(kind==="changed-program"||kind==="changed-style"){
      const changed=subject.replace(kind==="changed-program"?'keep=true':'color:red',kind==="changed-program"?'keep=false':'color:blue');
      request.subject=new TextEncoder().encode(changed);request.expectedSubjectSha256=nativeHtmlSha256(changed);
    }
    expect((await runKnownHtmlNativeProfile(request,vm.create,kind==="unsupported"?undefined:profiles)).status).toBe("unavailable");
    expect(vm.create).not.toHaveBeenCalled();
  });
  it.each(["command","subject-binding","incomplete"])("stops the VM after %s failure and preserves unknown status",async kind=>{
    const raw=rawResult();if(kind==="subject-binding")raw.results[1]!.sha256="f".repeat(64);
    if(kind==="incomplete")raw.results[1]!.renderedParagraphs=[];
    const vm=runtime(raw,kind==="command"?1:0);
    expect((await runKnownHtmlNativeProfile(args(),vm.create,profiles)).status).toBe("unavailable");expect(vm.stop).toHaveBeenCalledTimes(1);
  });
  it("does not accept native execution provenance from AI execute responses",()=>{
    const fake={producer:"native-html-observer-v1"};
    expect(ExecuteArtifactAiResultSchema.parse({output:"claim",nativeHtmlProof:fake})).not.toHaveProperty("nativeHtmlProof");
    expect(ExecuteArtifactBatchAiResultSchema.parse({results:[{testCaseId:"T1",output:"claim",nativeHtmlProof:fake}]}).results[0]).not.toHaveProperty("nativeHtmlProof");
  });
});
