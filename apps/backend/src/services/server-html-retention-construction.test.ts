// @vitest-environment node
import {afterEach,beforeEach,describe,expect,it,vi} from "vitest";
import {CandidateSchema,ExperimentPolicySchema,SourceArtifactSchema,type EvolveProject} from "@evolution/contracts";
import {htmlNativeCodeRetention} from "@evolution/core";
import {buildServerExperimentCandidate,verifyServerCandidateFrozenArtifact} from "./server-experiment-artifacts";

const {blobs,ai,known}=vi.hoisted(()=>({blobs:new Map<string,Blob>(),ai:vi.fn(),known:vi.fn()}));
vi.mock("./artifact-runtime",()=>({getServerArtifactStore:()=>({get:async(id:string)=>blobs.get(id),put:async(id:string,blob:Blob)=>{blobs.set(id,blob);}})}));
vi.mock("./ai-gateway",()=>({runServerAi:ai}));
// The real renderer eligibility and lossless compilation have separate adapter tests.
// This port keeps the compiled bytes unchanged to exercise the subsequent retention guard.
vi.mock("@evolution/adapters/html-native-profile",()=>({isKnownHtmlNativeSubject:known,compileKnownHtmlDerivedMetadata:(_original:string,subject:string)=>({html:subject,updatedIds:[],reflowedIds:[]})}));
const code="npm install\nnpm run build",block='<pre class="code-block"><code>'+code+'</code></pre>';
const paragraph='<p>后续说明。</p>',explanation='<p>后续说明。完成后记录实际构建结果。</p>';
const original='<html><head><script>const KEEP=true;</script><style>p{color:blue}</style></head><body><article class="slide-card" id="slide-43"><div class="slide-body">'+block+paragraph+'</div></article></body></html>';
function fixture(){
  const source=SourceArtifactSchema.parse({id:"source",name:"guide.html",extension:"html",mimeType:"text/html",artifactKind:"document",role:"target",size:Buffer.byteLength(original),inputMode:"upload",parseStatus:"ready",createdAt:"2026-10-27T00:00:00.000Z"});
  const candidate=CandidateSchema.parse({id:"child",name:"配置说明",change:"补充完成检查",patches:[{id:"plan",component:"code",operation:"update",target:"配置说明段落",content:explanation,rationale:"保留原始命令"}]});
  const project={id:"retention-build-mission",name:"Retention",version:"V1",sourceArtifacts:[source],goal:"细化说明并保留原有代码",evolutionCommand:"增加完成检查",protectedItems:[],editableItems:[],acceptanceRubric:[]} as unknown as EvolveProject;
  blobs.set(source.id,new Blob([original],{type:source.mimeType}));return {project,candidate};
}
const output=(before=code,after=code+"\n完成检查：记录结果。")=>({summary:"补充说明",artifacts:[{sourceArtifactId:"source",name:"guide.html",mimeType:"text/html",content:JSON.stringify({kind:"text-edits",edits:[{before,after}]}),notes:[]}]});
beforeEach(()=>{blobs.clear();ai.mockReset();known.mockReset();known.mockReturnValue(true);vi.stubEnv("EVOLUTION_AI_FULL_REPAIR_TEXT_MISSIONS","retention-build-mission");});
afterEach(()=>vi.unstubAllEnvs());

describe("pre-freeze original code and instruction retention",()=>{
  it.each([true,false])("preserves exactly one paragraph construction correction with the node protocol (corrected=%s)",async corrected=>{
    const x=fixture();x.project.experimentPolicy=ExperimentPolicySchema.parse({htmlBuildAnchorValidation:"issued-body-nodes-v1"});
    ai.mockImplementation(async(_operation,payload)=>{
      const target=payload.project.currentTargets[0],node=target.htmlBuildBodyContext.anchors.find((a:{before:string})=>a.before==="后续说明。");
      expect(target.mutationMode).toBe("html-build-body-node-edits-v1");
      if(ai.mock.calls.length===2){
        expect(blobs.size).toBe(1);expect(payload.project.currentTargets).toEqual(ai.mock.calls[0]![1].project.currentTargets);
        expect(payload.constructionCorrection.code).toBe("HTML_PARAGRAPH_CONSTRUCTION_BUDGET_EXCEEDED");
        expect(JSON.parse(payload.constructionCorrection.invalidProposal[0].content).kind).toBe("html-build-body-node-edits-v1");
      }
      return {summary:"配置说明",artifacts:[{sourceArtifactId:"source",name:"guide.html",mimeType:"text/html",notes:[],content:JSON.stringify({kind:"html-build-body-node-edits-v1",edits:[{anchorId:node.anchorId,after:corrected&&ai.mock.calls.length===2?"后续说明。完成后记录结果。":"字".repeat(1112)}]})}]};
    });
    const run=buildServerExperimentCandidate(x.project,x.candidate);
    if(corrected){const built=await run;expect(await verifyServerCandidateFrozenArtifact(built.artifactSnapshots[0]!)).toBe(true);}
    else{await expect(run).rejects.toMatchObject({code:"HTML_PARAGRAPH_CONSTRUCTION_BUDGET_EXCEEDED"});expect(blobs.size).toBe(1);}
    expect(ai).toHaveBeenCalledTimes(2);
  });
  it("rejects a wall of prose before writes and corrects it once using the same full context",async()=>{
    const x=fixture();ai.mockResolvedValueOnce(output("后续说明。","字".repeat(1112))).mockImplementationOnce(async(_operation,payload)=>{
      expect(blobs.size).toBe(1);expect(payload.project.currentTargets).toEqual(ai.mock.calls[0]![1].project.currentTargets);
      expect(payload.htmlParagraphConstructionInstruction).toContain("known-sop-paragraph-budget-v1");
      expect(payload.constructionCorrection).toMatchObject({code:"HTML_PARAGRAPH_CONSTRUCTION_BUDGET_EXCEEDED",issues:[{section:"slide-43",chars:1112,maxChars:240}]});
      return output("后续说明。","后续说明。完成后记录实际构建结果。");
    });
    const built=await buildServerExperimentCandidate(x.project,x.candidate);
    expect(ai).toHaveBeenCalledTimes(2);expect(await verifyServerCandidateFrozenArtifact(built.artifactSnapshots[0]!)).toBe(true);
  });
  it.each(["paragraph","anchor"])("shares one correction after an earlier %s error and never freezes another oversized proposal",async kind=>{
    const x=fixture();ai.mockResolvedValueOnce(kind==="anchor"?output("absent","invalid"):output("后续说明。","字".repeat(1112)))
      .mockResolvedValueOnce(output("后续说明。","字".repeat(1112)));
    await expect(buildServerExperimentCandidate(x.project,x.candidate)).rejects.toMatchObject({code:"HTML_PARAGRAPH_CONSTRUCTION_BUDGET_EXCEEDED"});
    expect(ai).toHaveBeenCalledTimes(2);expect(blobs.size).toBe(1);
  });
  it("rejects before writing and uses the single construction correction to put new prose outside the original block",async()=>{
    const x=fixture();ai.mockResolvedValueOnce(output()).mockImplementationOnce(async(_operation,payload)=>{
      expect(blobs.size).toBe(1);expect(payload.project.currentTargets).toEqual(ai.mock.calls[0]![1].project.currentTargets);
      expect(payload.constructionCorrection).toMatchObject({code:"HTML_ORIGINAL_CODE_RETENTION_FAILED",retention:{originalCount:2,retainedCount:0,retained:false}});
      expect(JSON.stringify(payload.constructionCorrection)).not.toContain("independentFinal");
      return output(paragraph,explanation);
    });
    const built=await buildServerExperimentCandidate(x.project,x.candidate),snapshot=built.artifactSnapshots[0]!;
    expect(snapshot.content).toBe(original.replace(paragraph,explanation));expect(ai).toHaveBeenCalledTimes(2);
    expect(htmlNativeCodeRetention(original,snapshot.content)).toMatchObject({retained:true,exactCount:2});
    expect(await verifyServerCandidateFrozenArtifact(snapshot)).toBe(true);
  });
  it("stops after one invalid construction correction with no frozen Candidate",async()=>{
    const x=fixture();ai.mockResolvedValue(output());
    await expect(buildServerExperimentCandidate(x.project,x.candidate)).rejects.toMatchObject({code:"HTML_ORIGINAL_CODE_RETENTION_FAILED"});
    expect(ai).toHaveBeenCalledTimes(2);expect(blobs.size).toBe(1);
  });
  it("shares the same one correction with an earlier anchor error instead of adding a retention retry",async()=>{
    const x=fixture();ai.mockResolvedValueOnce(output("absent anchor","invalid"))
      .mockResolvedValueOnce(output());
    await expect(buildServerExperimentCandidate(x.project,x.candidate)).rejects.toMatchObject({code:"HTML_ORIGINAL_CODE_RETENTION_FAILED"});
    expect(ai).toHaveBeenCalledTimes(2);expect(blobs.size).toBe(1);
  });
  it("does not impose the known SOP policy on an unknown HTML renderer",async()=>{
    const x=fixture();known.mockReturnValue(false);ai.mockResolvedValue(output());
    const built=await buildServerExperimentCandidate(x.project,x.candidate);
    expect(built.artifactSnapshots[0]!.content).toContain(code+"\n完成检查：记录结果。");expect(ai).toHaveBeenCalledTimes(1);
  });
});
