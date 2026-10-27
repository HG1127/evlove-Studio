// @vitest-environment node
import {afterEach,beforeEach,describe,expect,it,vi} from "vitest";
import {CandidateSchema,SourceArtifactSchema,type EvolveProject} from "@evolution/contracts";
import {buildServerExperimentCandidate,verifyServerCandidateFrozenArtifact} from "./server-experiment-artifacts";

const {blobs,ai}=vi.hoisted(()=>({blobs:new Map<string,Blob>(),ai:vi.fn()}));
vi.mock("./artifact-runtime",()=>({getServerArtifactStore:()=>({get:async(id:string)=>blobs.get(id),put:async(id:string,blob:Blob)=>{blobs.set(id,blob);}})}));
vi.mock("./ai-gateway",()=>({runServerAi:ai}));
const before="环境变量、回滚方式、负责人、反馈入口明确。",after=before+" 输入项目名，保存后检查回读值。";
const original='<html><head><script>const PRIVATE_PROGRAM=true;</script><style>p{color:blue}</style></head><body><article id="slide-93" data-search="'+before+'"><p>'+before+'</p></article></body></html>';
function fixture(content=original){
  const source=SourceArtifactSchema.parse({id:"source",name:"guide.html",extension:"html",mimeType:"text/html",artifactKind:"document",role:"target",size:Buffer.byteLength(content),inputMode:"upload",parseStatus:"ready",createdAt:"2026-10-27T00:00:00.000Z"});
  const candidate=CandidateSchema.parse({id:"child",name:"配置说明",change:"补充完成检查",patches:[{id:"plan",component:"code",operation:"update",target:"配置说明段落",content:after,rationale:"补足操作说明"}]});
  const project={id:"body-anchor-mission",name:"Body anchors",version:"V1",sourceArtifacts:[source],goal:"细化说明并保留其余文件",evolutionCommand:"增加完成检查",protectedItems:[],editableItems:[],acceptanceRubric:[]} as unknown as EvolveProject;
  blobs.set(source.id,new Blob([content],{type:source.mimeType}));return {project,candidate};
}
const output=(edits:Array<{before:string;after:string;start?:number;end?:number}>)=>({summary:"补充配置说明",artifacts:[{sourceArtifactId:"source",name:"guide.html",mimeType:"text/html",content:JSON.stringify({kind:"text-edits",edits}),notes:[]}]});
beforeEach(()=>{blobs.clear();ai.mockReset();vi.stubEnv("EVOLUTION_AI_FULL_REPAIR_TEXT_MISSIONS","body-anchor-mission");});
afterEach(()=>vi.unstubAllEnvs());

describe("server binding of issued complete HTML body anchors",()=>{
  it("uses the unique issued body position when search attributes duplicate text and the model omits offsets",async()=>{
    const x=fixture();ai.mockImplementationOnce(async(_operation,payload)=>{
      expect(payload.project.currentTargets[0].htmlBuildBodyContext.anchors).toHaveLength(1);
      expect(JSON.stringify(payload)).not.toContain("PRIVATE_PROGRAM");return output([{before,after}]);
    });
    const built=await buildServerExperimentCandidate(x.project,x.candidate),snapshot=built.artifactSnapshots[0]!;
    expect(snapshot.content).toBe(original.replace('<p>'+before+'</p>','<p>'+after+'</p>'));
    expect(await verifyServerCandidateFrozenArtifact(snapshot)).toBe(true);expect(ai).toHaveBeenCalledTimes(1);
  });
  it("preserves ambiguous real body text as a failed construction without any frozen write",async()=>{
    const x=fixture(original.replace('</article>','<p>'+before+'</p></article>'));ai.mockResolvedValue(output([{before,after}]));
    await expect(buildServerExperimentCandidate(x.project,x.candidate)).rejects.toMatchObject({code:"TEXT_EDIT_ANCHOR_INVALID"});
    expect(ai).toHaveBeenCalledTimes(2);expect(blobs.size).toBe(1);
  });
  it("does not enable body resolution outside the exact Mission consent",async()=>{
    vi.stubEnv("EVOLUTION_AI_FULL_REPAIR_TEXT_MISSIONS","another-mission");const x=fixture();ai.mockResolvedValue(output([{before,after}]));
    await expect(buildServerExperimentCandidate(x.project,x.candidate)).rejects.toMatchObject({code:"TEXT_EDIT_ANCHOR_INVALID"});
    expect(blobs.size).toBe(1);
  });
  it("still rejects changed full parent bytes before freezing a resolved local anchor",async()=>{
    const x=fixture();ai.mockImplementationOnce(async()=>{
      blobs.set("source",new Blob([original.replace("PRIVATE_PROGRAM","CHANGED_PROGRAM")],{type:"text/html"}));return output([{before,after}]);
    });
    await expect(buildServerExperimentCandidate(x.project,x.candidate)).rejects.toMatchObject({code:"CANDIDATE_BUILD_PARENT_CHANGED"});
    expect(ai).toHaveBeenCalledTimes(1);expect(blobs.size).toBe(1);
  });
  it("resolves the corrected proposal against the identical issued context without partially writing earlier edits",async()=>{
    const x=fixture();ai.mockResolvedValueOnce(output([{before,after},{before:"invented anchor",after:"bad"}]))
      .mockImplementationOnce(async(_operation,payload)=>{
        expect(blobs.size).toBe(1);expect(payload.constructionCorrection.editIndex).toBe(1);
        expect(payload.project.currentTargets).toEqual(ai.mock.calls[0]![1].project.currentTargets);return output([{before,after}]);
      });
    const built=await buildServerExperimentCandidate(x.project,x.candidate);
    expect(built.artifactSnapshots[0]!.content).toContain('<p>'+after+'</p>');expect(ai).toHaveBeenCalledTimes(2);
  });
  it.each([false,true])("binds only its HTML Target and preflights the entire mixed-file proposal (invalid second=%s)",async(invalid)=>{
    const x=fixture(),retained="保留其他文件的全部条款。";
    const other=SourceArtifactSchema.parse({...x.project.sourceArtifacts[0],id:"other",name:"notes.md",extension:"md",mimeType:"text/markdown",size:Buffer.byteLength(retained)});
    x.project.sourceArtifacts.push(other);blobs.set(other.id,new Blob([retained],{type:other.mimeType}));
    const proposal=output([{before,after}]);proposal.artifacts.push({sourceArtifactId:other.id,name:other.name,mimeType:other.mimeType,
      content:invalid?JSON.stringify({kind:"text-edits",edits:[{before:"absent second-file anchor",after:"bad"}]}):retained,notes:[]});
    ai.mockResolvedValue(proposal);
    if(invalid){
      await expect(buildServerExperimentCandidate(x.project,x.candidate)).rejects.toMatchObject({code:"TEXT_EDIT_ANCHOR_INVALID"});
      expect(blobs.size).toBe(2);expect(ai).toHaveBeenCalledTimes(2);
    }else{
      const built=await buildServerExperimentCandidate(x.project,x.candidate);
      expect(built.artifactSnapshots[0]!.content).toContain('<p>'+after+'</p>');
      expect(built.artifactSnapshots[1]!.content).toBe(retained);expect(ai).toHaveBeenCalledTimes(1);
      for(const snapshot of built.artifactSnapshots)expect(await verifyServerCandidateFrozenArtifact(snapshot)).toBe(true);
    }
  });
});
