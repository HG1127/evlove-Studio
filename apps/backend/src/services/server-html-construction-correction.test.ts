// @vitest-environment node
import {beforeEach,describe,expect,it,vi} from "vitest";
import {CandidateSchema,SourceArtifactSchema,type EvolveProject} from "@evolution/contracts";
import {assertHtmlKnownSemanticLayout} from "@evolution/core";
import {buildServerExperimentCandidate,verifyServerCandidateFrozenArtifact} from "./server-experiment-artifacts";
const {blobs,ai}=vi.hoisted(()=>({blobs:new Map<string,Blob>(),ai:vi.fn()}));
vi.mock("./artifact-runtime",()=>({getServerArtifactStore:()=>({get:async(id:string)=>blobs.get(id),put:async(id:string,blob:Blob)=>{blobs.set(id,blob);}})}));
vi.mock("./ai-gateway",()=>({runServerAi:ai}));
// Synthetic profile port; the real adapter's program-hash eligibility is tested separately. No document code runs here.
vi.mock("./server-html-derived-metadata",()=>({compileServerHtmlDerivedMetadata:async(args:{content:string;readOriginal:()=>Promise<string>})=>{
  assertHtmlKnownSemanticLayout(await args.readOriginal(),args.content);return {content:args.content,checks:[]};
}}));
const component='<div class="content-block"><div class="text-lines"><p>非常适合</p><p>内部工具</p></div></div>';
const original='<html><head><meta charset="utf-8"></head><body><article class="slide-card" id="slide-11"><div class="slide-body">'+component+'</div></article></body></html>';
const output=(after:string)=>({summary:"正文增加完成检查",artifacts:[{sourceArtifactId:"source",name:"guide.html",mimeType:"text/html",content:JSON.stringify({kind:"text-edits",edits:[{before:component,after}]}),notes:[]}]});
function fixture(){
  const source=SourceArtifactSchema.parse({id:"source",name:"guide.html",extension:"html",mimeType:"text/html",artifactKind:"document",role:"target",size:Buffer.byteLength(original),inputMode:"upload",parseStatus:"ready",createdAt:"2026-10-26T00:00:00.000Z"});
  const candidate=CandidateSchema.parse({id:"child",name:"完成检查",change:"补充原有完成检查",patches:[{id:"plan",component:"code",operation:"update",target:"语义分类正文",content:"增加可核验的完成检查说明",rationale:"保留原有信息"}]});
  const project={id:"synthetic-semantic-construction",name:"Synthetic",version:"V1",sourceArtifacts:[source],goal:"细化配置说明并保留原版",evolutionCommand:"增加完成检查",protectedItems:[],editableItems:[],acceptanceRubric:[]} as unknown as EvolveProject;
  blobs.set(source.id,new Blob([original],{type:"text/html"}));return {project,candidate};
}
beforeEach(()=>{blobs.clear();ai.mockReset();});
describe("same-parent semantic layout construction correction",()=>{
  it("rejects before any frozen write, corrects once against identical context, and freezes only the corrected proposal",async()=>{
    const x=fixture(),broken=component.replace("</p></div>","</p><p>完成检查：记录结果。</p></div>");
    ai.mockResolvedValueOnce(output(broken)).mockImplementationOnce(async(_operation,payload)=>{
      expect(blobs.size).toBe(1);expect(payload.project.currentTargets).toEqual(ai.mock.calls[0]![1].project.currentTargets);
      expect(payload.constructionCorrection.code).toBe("HTML_SEMANTIC_LAYOUT_INVALID");
      expect(JSON.stringify(payload)).not.toContain("finalHoldout");return output(component+"<p>完成检查：记录结果。</p>");
    });
    const built=await buildServerExperimentCandidate(x.project,x.candidate);
    expect(ai).toHaveBeenCalledTimes(2);expect(built.artifactSnapshots[0]!.content).toBe(original.replace(component,component+"<p>完成检查：记录结果。</p>"));
    expect(await verifyServerCandidateFrozenArtifact(built.artifactSnapshots[0]!)).toBe(true);
  });
  it("stops after one failed correction without writing or renaming a Candidate",async()=>{
    const x=fixture();ai.mockResolvedValue(output(component.replace("</p></div>","</p><p>仍然破坏组件</p></div>")));
    await expect(buildServerExperimentCandidate(x.project,x.candidate)).rejects.toMatchObject({code:"HTML_SEMANTIC_LAYOUT_INVALID"});
    expect(ai).toHaveBeenCalledTimes(2);expect(blobs.size).toBe(1);
  });
});
