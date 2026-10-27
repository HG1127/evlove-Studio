// @vitest-environment node
import {afterEach,describe,expect,it,vi} from "vitest";
import {applyExactEdits,bindHtmlBuildTextEditAnchors,htmlBuildBodyEditAnchors} from "@evolution/core";
import {serverAiBuildContract} from "./server-ai-build-contract";
import {runServerAi} from "./ai-gateway";
import {withExplicitServerAiConnection} from "./server-ai-connection";

const sha="a".repeat(64),body="正文说明",html='<html><body><article data-search="正文说明"><p>正文说明</p><p>重复</p><p>重复</p></article></body></html>';
const anchors=htmlBuildBodyEditAnchors(html,sha),context={schemaVersion:"html-build-body-context-v1",parentSha256:sha,anchors,components:[]};
const target={id:"source",bodyAnchorPolicy:"issued-body-ranges-v1",htmlBuildBodyContext:context};
const scope={project:{currentTargets:[target]}};
const result=(edits:unknown[])=>({summary:"具体说明",artifacts:[{sourceArtifactId:"source",name:"file.html",mimeType:"text/html",notes:[],content:JSON.stringify({kind:"text-edits",edits})}]});
const edit={before:body,after:"正文说明与完成检查"};
const bad=result([{...edit,start:0,end:body.length}]);
afterEach(()=>vi.unstubAllGlobals());
describe("request-bound HTML build ranges",()=>{
  it("keeps legacy parsing and the strict materializer unchanged",()=>{
    for(const payload of [undefined,{}, {project:{currentTargets:[{oldContext:true}]}}])expect(serverAiBuildContract(payload).parser.safeParse(bad).success).toBe(true);
    expect(()=>applyExactEdits(html,bindHtmlBuildTextEditAnchors(bad.artifacts[0]!.content,context),{strict:true})).toThrow(/不唯一/);
  });
  it("rejects conflicting ranges with measured issued positions, allowing an omitted unique body range",()=>{
    const contract=serverAiBuildContract(scope),parsed=contract.parser.safeParse(bad),anchor=anchors.find(a=>a.before===body)!;
    expect(parsed.success).toBe(false);
    if(!parsed.success)expect(parsed.error.issues[0]!.message).toContain('"start":'+anchor.start);
    const allowed=result([edit]);expect(contract.parser.parse(allowed).artifacts[0]!.content).toBe(allowed.artifacts[0]!.content);
    const bound=bindHtmlBuildTextEditAnchors(allowed.artifacts[0]!.content,context);
    expect(applyExactEdits(html,bound,{strict:true})).toBe(html.replace('<p>正文说明</p>','<p>正文说明与完成检查</p>'));
    expect(contract.parser.safeParse(result([{...edit,start:anchor.start}])).success).toBe(false);
    expect(contract.parser.safeParse(result([{...edit,start:anchor.start,end:anchor.end}])).success).toBe(true);
  });
  it("keeps genuinely repeated body nodes explicit and rejects invented or duplicated selections",()=>{
    const contract=serverAiBuildContract(scope),a=anchors.filter(a=>a.before==="重复")[1]!;
    expect(contract.parser.safeParse(result([{before:"重复",after:"新增说明"}])).success).toBe(false);
    const explicit={before:a.before,after:"新增说明",start:a.start,end:a.end};
    expect(contract.parser.safeParse(result([explicit])).success).toBe(true);
    expect(contract.parser.safeParse(result([explicit,explicit])).success).toBe(false);
    expect(contract.parser.safeParse(result([{before:"不存在的正文",after:"新增说明"}])).success).toBe(false);
    expect(contract.parser.safeParse(result([{before:"正文",after:"只改子串"}])).success).toBe(false);
  });
  it("fails closed for missing indexes, malformed parent bindings or changed Target identities",()=>{
    expect(()=>serverAiBuildContract({project:{currentTargets:[{id:"source",bodyAnchorPolicy:"issued-body-ranges-v1"}]}})).toThrow("body index");
    expect(()=>serverAiBuildContract({project:{currentTargets:[{...target,htmlBuildBodyContext:{...context,parentSha256:"b".repeat(64)}}]}})).toThrow();
    expect(()=>serverAiBuildContract({project:{currentTargets:[target,target]}})).toThrow("duplicate");
    const contract=serverAiBuildContract(scope),unknown=result([edit]);unknown.artifacts[0]!.sourceArtifactId="foreign";
    expect(contract.parser.safeParse(unknown).success).toBe(false);
    expect(contract.parser.safeParse({...result([edit]),artifacts:[]}).success).toBe(false);
    expect(contract.parser.safeParse({...result([edit]),artifacts:[...result([edit]).artifacts,...result([edit]).artifacts]}).success).toBe(false);
  });
  it("retains an ordinary native Target's blueprint beside the selected HTML body Target",()=>{
    const contract=serverAiBuildContract({project:{currentTargets:[target,{id:"sheet"}]}});
    const spreadsheet=JSON.stringify({kind:"spreadsheet",sheets:[{name:"Sheet1",cells:[{address:"A1",value:"config"}]}]});
    const mixed={...result([edit]),artifacts:[...result([edit]).artifacts,{sourceArtifactId:"sheet",name:"config.xlsx",mimeType:"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",content:spreadsheet,notes:[]}]};
    expect(contract.parser.parse(mixed).artifacts[1]!.content).toBe(spreadsheet);
    expect(contract.parser.safeParse(result([edit])).success).toBe(false);
  });
  it.each(["corrected","still-invalid"] as const)("uses only the existing one schema correction for %s positions",async mode=>{
    const requests:Array<{messages:Array<{content:string}>}>=[];
    vi.stubGlobal("fetch",vi.fn(async(_url:unknown,init?:RequestInit)=>{
      requests.push(JSON.parse(String(init?.body)));
      const response=requests.length===1||mode==="still-invalid"?bad:result([edit]);
      return new Response(JSON.stringify({choices:[{finish_reason:"stop",message:{content:JSON.stringify(response)}}]}),{status:200});
    }));
    const run=withExplicitServerAiConnection({connectionId:"build-test",label:"Test",apiKey:"test-private-key",baseUrl:"https://build.example.test/v1",model:"test-model",protocol:"chat-completions",responseFormat:"json-object"},()=>runServerAi("build-candidate",scope));
    if(mode==="corrected")expect((await run).artifacts[0]!.content).toBe(result([edit]).artifacts[0]!.content);
    else await expect(run).rejects.toMatchObject({code:"AI_OUTPUT_SCHEMA_MISMATCH"});
    const bodyAnchor=anchors.find(a=>a.before===body)!;
    expect(requests).toHaveLength(2);expect(requests[1]!.messages[0]!.content).toContain("expected issued body ranges");
    expect(requests[1]!.messages[0]!.content).toContain(JSON.stringify({start:bodyAnchor.start,end:bodyAnchor.end}));
  });
});
