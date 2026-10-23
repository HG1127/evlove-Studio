// @vitest-environment node
import {createHash} from "node:crypto";
import {beforeEach,describe,expect,it,vi} from "vitest";
import {SourceArtifactSchema,TestCaseSchema,type EvolveProject} from "@evolution/contracts";
import {buildServerCurrentSemanticArtifactContext} from "./server-current-semantic-context";
const {blobs,metadata}=vi.hoisted(()=>({blobs:new Map<string,Blob>(),metadata:vi.fn()}));
vi.mock("./artifact-runtime",()=>({getServerArtifactStore:()=>({get:async(id:string)=>blobs.get(id),getMetadata:metadata})}));
const quote="REFUND_APPROVAL_CASE 必须由主管批准并记录退款编号。";
const html="<html><head><style>"+".presentation-style{color:red}\n".repeat(2500)+"</style></head><body>"+"<p>其他章节</p>".repeat(12000)+"<article>"+quote+"</article>"+"<p>后续附件</p>".repeat(12000)+"</body></html>";
const testCase=TestCaseSchema.parse({id:"H1",title:"退款审批",input:quote,expected:[quote],criterionIds:["CONTENT"],executionMode:"artifact-runtime",hidden:true});
const source=SourceArtifactSchema.parse({id:"source",name:"sop.html",extension:"html",mimeType:"text/html",role:"target",artifactKind:"document",inputMode:"upload",parseStatus:"ready",textContent:"STALE PARSED INDEX",storageRef:"original",size:Buffer.byteLength(html),createdAt:"2026-10-08T00:00:00.000Z"});
const project={id:"mission",version:"V1",goal:"细化流程",evolutionCommand:"细化流程",sourceArtifacts:[source],acceptanceRubric:[],evalSuite:[testCase]} as unknown as EvolveProject;
beforeEach(()=>{blobs.clear();blobs.set("original",new Blob([html],{type:"text/html"}));metadata.mockReset();metadata.mockResolvedValue(undefined);});
describe("actual-file semantic body context",()=>{
  it("supplies a complete expanded body above the previous capacity without dropping its tail",async()=>{
    const body="配置项含义、填写方法、保存与检查。".repeat(2200)+"TAIL_EXPANDED_CONFIGURATION";
    const actual='<html><head><style>PRIVATE_STYLE</style></head><body><p>'+body+'</p><script>PRIVATE_SCRIPT</script></body></html>';
    blobs.set("original",new Blob([actual],{type:"text/html"}));
    const [item]=await buildServerCurrentSemanticArtifactContext({project:{...project,sourceArtifacts:[{...source,size:Buffer.byteLength(actual)}]}});
    expect(item).toMatchObject({truncated:false,contextRepresentation:"complete-html-static-text-projection"});
    expect(item!.content).toContain("TAIL_EXPANDED_CONFIGURATION");
    expect(item!.content).not.toMatch(/PRIVATE_STYLE|PRIVATE_SCRIPT/);
  });
  it("supplies every chapter when large HTML has a complete body within the existing review budget",async()=>{
    const chapters=Array.from({length:111},(_,index)=>`<article id="chapter-${index}"><h3>第${index+1}章</h3><p>${"具体配置的用途、默认值和操作步骤。".repeat(11)} 结束标记-${index}</p></article>`).join("");
    const actual=`<html><head><style>${".layout{color:red}".repeat(3000)}</style></head><body>${chapters}<script>SECRET_SCRIPT_CONTENT</script></body></html>`;
    blobs.set("original",new Blob([actual],{type:"text/html"}));
    const [item]=await buildServerCurrentSemanticArtifactContext({project:{...project,sourceArtifacts:[{...source,size:Buffer.byteLength(actual)}]}});
    expect(item).toMatchObject({originalChars:actual.length,truncated:false,contextRepresentation:"complete-html-static-text-projection",
      artifactSha256:createHash("sha256").update(actual).digest("hex"),excludes:["scripts","styles","visual-fidelity","runtime-behavior"]});
    for(let index=0;index<111;index++)expect(item!.content).toContain(`结束标记-${index}`);
    expect((item!.content as string).length).toBeLessThanOrEqual(28000);
    expect(item!.content).not.toContain("SECRET_SCRIPT_CONTENT");
    expect(await blobs.get("original")!.text()).toBe(actual);
  });

  it("reads the complete actual upload then selects late body evidence on the same paper",async()=>{
    const [item]=await buildServerCurrentSemanticArtifactContext({project});
    expect(item!.content).toContain(quote);expect(item!.content).toContain("source body starts @");
    expect((item!.content as string).length).toBeLessThanOrEqual(18000);
    expect(item).toMatchObject({originalChars:html.length,truncated:true,artifactSha256:createHash("sha256").update(html).digest("hex")});
    expect(item!.content).not.toContain("STALE PARSED INDEX");
    expect(await blobs.get("original")!.text()).toBe(html);
  });
});

describe("actual semantic file boundaries",()=>{
  it("locks an Original reference only from matching Mission-bound storage metadata and actual bytes",async()=>{
    const sha256=createHash("sha256").update(html).digest("hex");
    metadata.mockResolvedValue({id:"original",missionId:"mission",kind:"source",sizeBytes:Buffer.byteLength(html),sha256});
    const [item]=await buildServerCurrentSemanticArtifactContext({project});
    expect(item!.originalReference).toMatchObject({schemaVersion:"original-artifact-reference-v1",missionId:"mission",
      sourceArtifactId:"source",blobId:"original",sizeBytes:Buffer.byteLength(html),sha256});
    metadata.mockResolvedValue({id:"original",missionId:"another",kind:"source",sizeBytes:Buffer.byteLength(html),sha256});
    expect((await buildServerCurrentSemanticArtifactContext({project}))[0]!.originalReference).toBeUndefined();
    metadata.mockResolvedValue({id:"original",missionId:"mission",kind:"source",sizeBytes:Buffer.byteLength(html),sha256:"f".repeat(64)});
    await expect(buildServerCurrentSemanticArtifactContext({project})).rejects.toThrow("元数据与实际文件字节不一致");
  });
  it("uses the Hidden paper explicitly instead of a visible-suite default",async()=>{
    const visible=TestCaseSchema.parse({id:"V1",title:"visible",input:"other evidence",expected:[],criterionIds:[],executionMode:"artifact-runtime"});
    const [item]=await buildServerCurrentSemanticArtifactContext({project:{...project,evalSuite:[visible]},testCases:[testCase]});
    expect(item!.content).toContain(quote);
  });
  it("refuses a missing upload rather than using the stale parsed index",async()=>{
    blobs.clear();
    await expect(buildServerCurrentSemanticArtifactContext({project})).rejects.toThrow("当前文件缺失");
  });
});
