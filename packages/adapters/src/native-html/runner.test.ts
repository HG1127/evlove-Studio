// @vitest-environment node
import type {Sandbox} from "@vercel/sandbox";
import {describe,expect,it,vi} from "vitest";
import {HTML_NATIVE_PROFILE_ID,ExecuteArtifactAiResultSchema,ExecuteArtifactBatchAiResultSchema} from "@evolution/contracts";
import {htmlNativeProgramIdentity} from "@evolution/core";
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
    styleComparison:[1440,390].map(width=>({width,propertyCount:50,namedElementsCompared:1,styleGroupsCompared:2,changedNamed:[],missingGroups:[],infiniteAnimations:0,pass:true}))};
}
function runtime(result=rawResult(),exitCode=0){
  const writeFiles=vi.fn(),stop=vi.fn(),runCommand=vi.fn(async(args:{cmd:string})=>args.cmd==="mkdir"?{exitCode:0}:{exitCode,stdout:async()=>JSON.stringify(result)});
  const sandbox={cwd:"/vercel",writeFiles,stop,runCommand} as unknown as Sandbox;
  return {sandbox,writeFiles,stop,runCommand,create:vi.fn(async()=>sandbox)};
}
describe("known isolated native HTML transport",()=>{
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
