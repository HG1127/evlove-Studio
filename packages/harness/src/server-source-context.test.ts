import { describe, expect, it } from "vitest";
import { SourceArtifactSchema, type EvolveProject } from "@evolution/contracts";
import { compactServerSourceArtifacts } from "./server-source-context";

function source(text:string,id="source",role:"target"|"reference"="target",extension="html"){
  return SourceArtifactSchema.parse({id,name:id+"."+extension,extension,role,artifactKind:"document",mimeType:extension==="html"?"text/html":"text/plain",inputMode:"paste",parseStatus:"ready",textContent:text,size:text.length,createdAt:"2026-10-08T00:00:00.000Z"});
}
function project(artifacts:EvolveProject["sourceArtifacts"],goal="退款审批"){
  return {sourceArtifacts:artifacts,goal,evolutionCommand:goal};
}
const quote="退款审批 REFUND_APPROVAL_CASE 必须由主管批准。";
const largeHtml="<html><head><style>"+".presentation-style { color: red; }\n".repeat(2500)+"</style></head><body data-kind='sop'>"+quote+"<p>后续正文</p>".repeat(5000)+"</body></html>";

describe("bounded Server source context",()=>{
  it("keeps a complete small file verbatim",()=>{
    const full="<html><head><title>SOP</title></head><body>完整内容</body></html>";
    expect(compactServerSourceArtifacts(project([source(full)]))[0]).toMatchObject({content:full,originalChars:full.length,truncated:false,contextSource:"parsed-text"});
  });
  it("includes actual HTML body even when the goal preferentially matches header CSS",()=>{
    const p=project([source(largeHtml)],"presentation-style CSS");
    const result=compactServerSourceArtifacts(p)[0]!;
    expect(result.content.includes(quote)).toBe(true);
    expect(result.content).toContain("source body starts @");
    expect(result.content).toContain("chunk offsets relative to body");
    expect(result.content.length).toBeLessThanOrEqual(20_000);
    expect(result.truncated).toBe(true);
    expect(p.sourceArtifacts[0]!.textContent).toBe(largeHtml);
  });
  it("ignores fake body tags in comments, attributes and header scripts/styles",()=>{
    const head="<html><head><!-- <body> --><meta data-example='<body>'><title>Example <body></title><script>const template='<body>';</script><style>"+".example { content: '<body>'; }\n".repeat(2500)+"</style></head>";
    const opening="<BODY data-note='a > b'>";
    const full=head+opening+quote+"<p>后续正文</p>".repeat(5000)+"</BODY></html>";
    const result=compactServerSourceArtifacts(project([source(full)],"example content"))[0]!;
    expect(result.content).toContain("source body starts @"+(head.length+opening.length));
    expect(result.content.includes(quote)).toBe(true);
  });
  it("retrieves late non-HTML source from the entire available text",()=>{
    const full="unrelated preface\n".repeat(5000)+quote+"\n"+"unrelated appendix\n".repeat(4000);
    const result=compactServerSourceArtifacts(project([source(full,"source","target","md")]))[0]!;
    expect(result.content.includes(quote)).toBe(true);
    expect(result.content).not.toContain("source body starts");
    expect(result.content.length).toBeLessThanOrEqual(20_000);
  });
  it("uses retrieval when HTML has no body markup instead of claiming complete content",()=>{
    const full="<!-- unrelated content -->\n".repeat(3000)+quote;
    const result=compactServerSourceArtifacts(project([source(full)]))[0]!;
    expect(result.content.includes(quote)).toBe(true);expect(result.truncated).toBe(true);
  });
  it("prioritizes Targets over earlier references within the aggregate budget",()=>{
    const artifacts=[source(largeHtml,"reference","reference"),...Array.from({length:7},(_,i)=>source(largeHtml,"target-"+i))];
    const p=project(artifacts);const originalIds=artifacts.map(x=>x.id);
    const result=compactServerSourceArtifacts(p);
    expect(result[0]!.id).toBe("target-0");
    expect(result.reduce((sum,item)=>sum+item.content.length,0)).toBeLessThanOrEqual(60_000);
    expect(result.every(item=>item.content.length<=20_000)).toBe(true);
    expect(result.filter(item=>item.role==="target")).toHaveLength(7);
    expect(result.some(item=>item.role==="target"&&item.content==="")).toBe(true);
    expect(p.sourceArtifacts.map(x=>x.id)).toEqual(originalIds);
  });
  it("labels excerpt-only input as incomplete even when that excerpt fits",()=>{
    const artifact=source("");artifact.textContent=undefined;artifact.textExcerpt=quote;
    expect(compactServerSourceArtifacts(project([artifact]))[0]).toMatchObject({content:quote,truncated:true,contextSource:"text-excerpt"});
  });
  it("retains a missing Target without inventing source text",()=>{
    const result=compactServerSourceArtifacts(project([source("")]))[0]!;
    expect(result).toMatchObject({id:"source",content:"",originalChars:0});
  });
  it("handles an absent Mission",()=>{expect(compactServerSourceArtifacts(undefined)).toEqual([]);});
});
