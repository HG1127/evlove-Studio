// @vitest-environment node
import {afterEach,beforeEach,describe,expect,it,vi} from "vitest";
import {CandidateSchema,ExperimentPolicySchema,SourceArtifactSchema,type EvolveProject} from "@evolution/contracts";
import {buildServerExperimentCandidate,verifyServerCandidateFrozenArtifact} from "./server-experiment-artifacts";
const {blobs,ai}=vi.hoisted(()=>({blobs:new Map<string,Blob>(),ai:vi.fn()}));
vi.mock("./artifact-runtime",()=>({getServerArtifactStore:()=>({get:async(id:string)=>blobs.get(id),put:async(id:string,b:Blob)=>{blobs.set(id,b);}})}));
vi.mock("./ai-gateway",()=>({runServerAi:ai}));
vi.mock("@evolution/adapters/html-native-profile",async()=>{
  const {assertHtmlKnownSemanticLayout}=await import("@evolution/core");
  return {isKnownHtmlNativeSubject:()=>true,compileKnownHtmlDerivedMetadata:(source:string,subject:string)=>{
    assertHtmlKnownSemanticLayout(source,subject);return {html:subject,updatedIds:[],reflowedIds:[]};
  }};
});
const original='<html><head><script>const KEEP=true;</script><style>p{color:blue}</style></head><body><article class="slide-card" id="slide-11"><div class="slide-body"><div class="content-block"><div class="text-lines"><p>非常适合</p><p>说明</p></div></div><pre><code>npm run build</code></pre><p>后续说明。</p></div></article></body></html>';
beforeEach(()=>{blobs.clear();ai.mockReset();blobs.set("source",new Blob([original],{type:"text/html"}));vi.stubEnv("EVOLUTION_AI_FULL_REPAIR_TEXT_MISSIONS","multi-check-build");});
afterEach(()=>vi.unstubAllEnvs());
describe("one construction correction for simultaneous failures",()=>{
  it.each([true,false])("preserves one correction and zero preflight writes (all corrected=%s)",async corrected=>{
    const source=SourceArtifactSchema.parse({id:"source",name:"guide.html",extension:"html",mimeType:"text/html",role:"target",artifactKind:"document",size:Buffer.byteLength(original),inputMode:"upload",parseStatus:"ready",createdAt:"2026-10-28T00:00:00Z"});
    const candidate=CandidateSchema.parse({id:"candidate",name:"Improve guide",change:"Clarify completion",patches:[{id:"patch",component:"prompt",operation:"update",target:"explanatory paragraph",content:"完成后记录结果。",rationale:"clarify"}]});
    const project={id:"multi-check-build",name:"Guide",version:"V1",sourceArtifacts:[source],goal:"clarify and preserve source",evolutionCommand:"improve",protectedItems:[],editableItems:[],acceptanceRubric:[],experimentPolicy:ExperimentPolicySchema.parse({htmlBuildAnchorValidation:"issued-body-nodes-v1"})} as unknown as EvolveProject;
    ai.mockImplementation(async(_operation,payload)=>{
      const context=payload.project.currentTargets[0].htmlBuildBodyContext,find=(before:string)=>context.anchors.find((a:{before:string})=>a.before===before).anchorId;
      if(ai.mock.calls.length===2){
        expect(blobs.size).toBe(1);expect(payload.project.currentTargets).toEqual(ai.mock.calls[0]![1].project.currentTargets);
        expect(payload.constructionCorrection).toMatchObject({code:"HTML_CONSTRUCTION_PREFLIGHT_FAILED",violations:[{code:"HTML_SEMANTIC_LAYOUT_INVALID"},{code:"HTML_ORIGINAL_CODE_RETENTION_FAILED"}]});
      }
      const edits=ai.mock.calls.length===1?[{anchorId:find('非常适合'),after:'changed label'},{anchorId:find('npm run build'),after:'npm run unsafe'}]
        :[{anchorId:find('后续说明。'),after:'后续说明。完成后记录结果。'},...(!corrected?[{anchorId:find('npm run build'),after:'npm run unsafe'}]:[])];
      return {summary:"construction",artifacts:[{sourceArtifactId:"source",name:"guide.html",mimeType:"text/html",content:JSON.stringify({kind:"html-build-body-node-edits-v1",edits}),notes:[]}]};
    });
    const run=buildServerExperimentCandidate(project,candidate);
    if(corrected){const built=await run;expect(built.artifactSnapshots[0]!.content).toBe(original.replace('后续说明。','后续说明。完成后记录结果。'));expect(await verifyServerCandidateFrozenArtifact(built.artifactSnapshots[0]!)).toBe(true);}
    else{await expect(run).rejects.toMatchObject({code:"HTML_ORIGINAL_CODE_RETENTION_FAILED"});expect(blobs.size).toBe(1);}
    expect(ai).toHaveBeenCalledTimes(2);
  });
});
