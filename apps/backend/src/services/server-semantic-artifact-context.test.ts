// @vitest-environment node
import {createHash} from "node:crypto";
import {beforeEach,describe,expect,it,vi} from "vitest";
import {SourceArtifactSchema,TestCaseSchema,type EvolveProject} from "@evolution/contracts";
import {buildServerCurrentSemanticArtifactContext} from "./server-current-semantic-context";
const {blobs}=vi.hoisted(()=>({blobs:new Map<string,Blob>()}));
vi.mock("./artifact-runtime",()=>({getServerArtifactStore:()=>({get:async(id:string)=>blobs.get(id)})}));
const quote="REFUND_APPROVAL_CASE 必须由主管批准并记录退款编号。";
const html="<html><head><style>"+".presentation-style{color:red}\n".repeat(2500)+"</style></head><body>"+"<p>其他章节</p>".repeat(6000)+"<article>"+quote+"</article>"+"<p>后续附件</p>".repeat(6000)+"</body></html>";
const testCase=TestCaseSchema.parse({id:"H1",title:"退款审批",input:quote,expected:[quote],criterionIds:["CONTENT"],executionMode:"artifact-runtime",hidden:true});
const source=SourceArtifactSchema.parse({id:"source",name:"sop.html",extension:"html",mimeType:"text/html",role:"target",artifactKind:"document",inputMode:"upload",parseStatus:"ready",textContent:"STALE PARSED INDEX",storageRef:"original",size:Buffer.byteLength(html),createdAt:"2026-10-08T00:00:00.000Z"});
const project={id:"mission",version:"V1",goal:"细化流程",evolutionCommand:"细化流程",sourceArtifacts:[source],acceptanceRubric:[],evalSuite:[testCase]} as unknown as EvolveProject;
beforeEach(()=>{blobs.clear();blobs.set("original",new Blob([html],{type:"text/html"}));});
describe("actual-file semantic body context",()=>{
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
