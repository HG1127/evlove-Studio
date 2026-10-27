// @vitest-environment node
import {afterEach,describe,expect,it,vi} from "vitest";
import {applyExactEdits,bindHtmlBuildBodyNodeEdits,bindHtmlBuildTextEditAnchors,htmlBuildBodyEditAnchors} from "@evolution/core";
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

describe("request-issued HTML build node protocol",()=>{
  const nodeScope={project:{currentTargets:[{...target,bodyAnchorPolicy:"issued-body-nodes-v1"}]}};
  const node=anchors.filter(a=>a.before==="重复")[1]!;
  const nodes=(edits:unknown[])=>({...result([]),artifacts:[{...result([]).artifacts[0]!,content:JSON.stringify({kind:"html-build-body-node-edits-v1",edits})}]});
  const edit={anchorId:node.anchorId,after:"重复</p><p>新增具体配置与检查"};
  it("disambiguates repeated labels by issued ID while preserving raw markup replacements",()=>{
    const parsed=serverAiBuildContract(nodeScope).parser.parse(nodes([edit]));
    const bound=bindHtmlBuildBodyNodeEdits(parsed.artifacts[0]!.content,context);
    expect(applyExactEdits(html,bound,{strict:true})).toBe(html.slice(0,node.start)+edit.after+html.slice(node.end));
    expect(serverAiBuildContract(scope).parser.safeParse(nodes([edit])).success).toBe(false);
  });
  it("rejects unknown/duplicate IDs, raw legacy anchors and model-owned binding fields",()=>{
    const contract=serverAiBuildContract(nodeScope);
    for(const payload of [nodes([{...edit,anchorId:"invented"}]),nodes([edit,edit]),nodes([{...edit,before:"重复"}]),result([{before:"重复",after:"新的说明"}])])expect(contract.parser.safeParse(payload).success).toBe(false);
    expect(()=>serverAiBuildContract({project:{currentTargets:[{id:"source",bodyAnchorPolicy:"issued-body-nodes-v1"}]}})).toThrow("body index");
    expect(()=>serverAiBuildContract({project:{currentTargets:[{...nodeScope.project.currentTargets[0],htmlBuildBodyContext:{...context,anchors:[...anchors,anchors[0]]}}]}})).toThrow(/unique/);
  });
  it("keeps malformed-JSON correction instructions within the selected node protocol",()=>{
    const response=nodes([edit]);response.artifacts[0]!.content="{";
    const parsed=serverAiBuildContract(nodeScope).parser.safeParse(response);expect(parsed.success).toBe(false);
    if(!parsed.success)expect(parsed.error.issues[0]!.message).toContain("html-build-body-node-edits-v1");
  });
  it("retains range and spreadsheet formats in a mixed request",()=>{
    const contract=serverAiBuildContract({project:{currentTargets:[nodeScope.project.currentTargets[0],{...target,id:"range"},{id:"sheet"}]}});
    const range={...result([{before:body,after:"完成检查"}]).artifacts[0]!,sourceArtifactId:"range"};
    const sheet={sourceArtifactId:"sheet",name:"x.xlsx",mimeType:"application/xlsx",notes:[],content:JSON.stringify({kind:"spreadsheet",sheets:[{name:"S",cells:[{address:"A1",value:1}]}]})};
    expect(contract.parser.parse({...nodes([edit]),artifacts:[...nodes([edit]).artifacts,range,sheet]}).artifacts[2]!.content).toBe(sheet.content);
    expect(contract.instruction).toContain("issued-body-ranges-v1");expect(contract.instruction).toContain("issued-body-nodes-v1");
  });
  it.each(["corrected","still-invalid"] as const)("keeps the one schema correction bound for %s node IDs",async mode=>{
    const requests:Array<{messages:Array<{content:string}>}>=[];
    vi.stubGlobal("fetch",vi.fn(async(_url:unknown,init?:RequestInit)=>{
      requests.push(JSON.parse(String(init?.body)));const response=requests.length===1||mode==="still-invalid"?nodes([{...edit,anchorId:"invented"}]):nodes([edit]);
      return new Response(JSON.stringify({choices:[{finish_reason:"stop",message:{content:JSON.stringify(response)}}]}),{status:200});
    }));
    const run=withExplicitServerAiConnection({connectionId:"node-build-test",label:"Test",apiKey:"synthetic-private",baseUrl:"https://build.example.test/v1",model:"test-model",protocol:"chat-completions",responseFormat:"json-object"},()=>runServerAi("build-candidate",nodeScope));
    if(mode==="corrected")expect((await run).artifacts[0]!.content).toBe(nodes([edit]).artifacts[0]!.content);else await expect(run).rejects.toMatchObject({code:"AI_OUTPUT_SCHEMA_MISMATCH"});
    expect(requests).toHaveLength(2);expect(requests[1]!.messages[0]!.content).toContain("unknown or duplicate issued anchorId");
  });
});
