import {describe,expect,it} from "vitest";
import {CandidateSchema,SourceArtifactSchema,TestCaseSchema,type EvolveProject} from "@evolution/contracts";
import {boundedBaselineArtifacts,currentSemanticArtifactContext} from "./server-baseline-evidence";
import {candidateArtifactContext} from "./server-experiment-evidence";
import {executeServerExperimentCandidate} from "./server-experiment-runner";
import {executeServerCurrentArtifactSuite} from "./server-current-artifact-runner";

const quote="REFUND_APPROVAL_CASE 必须由主管批准并记录退款编号。";
const html="<html><head><style>"+".presentation-style{color:red}\n".repeat(2500)+"</style></head><body>"+"<p>其他章节</p>".repeat(6000)+"<article>"+quote+"</article>"+"<p>后续附件</p>".repeat(6000)+"</body></html>";
const source=SourceArtifactSchema.parse({id:"source",name:"sop.html",extension:"html",mimeType:"text/html",role:"target",artifactKind:"document",inputMode:"paste",parseStatus:"ready",textContent:html,size:html.length,createdAt:"2026-10-08T00:00:00.000Z"});
const testCase=TestCaseSchema.parse({id:"H1",title:"退款审批",input:quote,expected:[quote],criterionIds:["CONTENT"],executionMode:"artifact-runtime",hidden:true});
const project={id:"mission",version:"V1",goal:"细化流程",evolutionCommand:"细化流程",sourceArtifacts:[source],acceptanceRubric:[],evalSuite:[testCase],hiddenEvalSuite:[testCase]} as unknown as EvolveProject;
const candidate=CandidateSchema.parse({id:"C1",name:"candidate",change:"improve",artifactSnapshots:[{id:"snapshot",sourceArtifactId:source.id,name:source.name,mimeType:source.mimeType,content:html,createdAt:source.createdAt}]});

describe("same-paper semantic source context",()=>{
  it("retrieves a late current-source body clause for the actual paper",()=>{
    const item=boundedBaselineArtifacts(project)[0]!;
    expect(item.content).toContain(quote);expect(item.content).toContain("source body starts @");
    expect(item.content.length).toBeLessThanOrEqual(18000);expect(item.truncated).toBe(true);
  });
  it("retrieves a late Candidate body clause instead of repeating the style header",()=>{
    const item=candidateArtifactContext(project,candidate)[0]!;
    expect(item.content).toContain(quote);expect(item.content).toContain("source body starts @");
    expect(item.content.length).toBeLessThanOrEqual(20000);expect(item.truncated).toBe(true);
    expect(candidate.artifactSnapshots[0]!.content).toBe(html);
  });
  it("does not label a bounded Candidate model observation as full evidence",async()=>{
    const [run]=await executeServerExperimentCandidate(project,candidate,{
      executeSemanticBatch:async({artifactContext})=>{
        expect(artifactContext[0]!.truncated).toBe(true);
        return {results:[{testCaseId:testCase.id,output:"Found the supplied body clause",trace:[]}]};
      },
      judge:async()=>{throw Error("Execution must not judge");},
    },[testCase]);
    expect(run!.verificationStatus).toBe("partial");
  });
});

describe("semantic context completeness and paper isolation",()=>{
  it("forwards the selected Hidden paper to the actual current-file context port",async()=>{
    const visible=TestCaseSchema.parse({id:"V1",title:"visible",input:"other evidence",expected:[],criterionIds:[],executionMode:"artifact-runtime"});
    const stored={...project,sourceArtifacts:[{...source,inputMode:"upload" as const}],evalSuite:[visible]};
    await currentSemanticArtifactContext(stored,async({testCases})=>{
      expect(testCases).toEqual([testCase]);
      return [{id:source.id,content:"actual selected file context",truncated:true}];
    },[testCase]);
  });
  it("executes the current Hidden baseline using its selected paper",async()=>{
    const visible=TestCaseSchema.parse({id:"V1",title:"visible",input:"other evidence",expected:[],criterionIds:[],executionMode:"artifact-runtime"});
    const stored={...project,sourceArtifacts:[{...source,inputMode:"upload" as const}],evalSuite:[visible]};
    let observedPaper:unknown;
    const [run]=await executeServerCurrentArtifactSuite(stored,[testCase],{
      buildCurrentArtifactContext:async({testCases})=>{
        observedPaper=testCases;
        return [{id:source.id,content:quote,truncated:true}];
      },
      executeSemanticBatch:async()=>({results:[{testCaseId:testCase.id,output:quote,trace:[]}]}),
      judge:async()=>{throw Error("Execution must not judge");},
    });
    expect(observedPaper).toEqual([testCase]);
    expect(run!.verificationStatus).toBe("partial");
  });
  it("does not call an excerpt-only paste complete",()=>{
    const p={...project,sourceArtifacts:[{...source,textContent:undefined,textExcerpt:quote}]};
    expect(boundedBaselineArtifacts(p)[0]).toMatchObject({content:quote,truncated:true});
  });
  it.each(["UNVERIFIED: missing content",""])("preserves unavailable model output %s",async(output)=>{
    const [run]=await executeServerExperimentCandidate(project,candidate,{
      executeSemanticBatch:async()=>({results:[{testCaseId:testCase.id,output,trace:[]}]}),
      judge:async()=>{throw Error("Execution must not judge");},
    },[testCase]);
    expect(run!.verificationStatus).toBe("unverified");
  });
  it("keeps small complete context verbatim and its model observation verified",async()=>{
    const content="<html><body>Complete small source</body></html>";
    const small={...candidate,artifactSnapshots:[{...candidate.artifactSnapshots[0]!,content}]};
    const [run]=await executeServerExperimentCandidate(project,small,{
      executeSemanticBatch:async({artifactContext})=>{
        expect(artifactContext[0]).toMatchObject({content,originalChars:content.length,truncated:false});
        return {results:[{testCaseId:testCase.id,output:"Observed the complete supplied source",trace:[]}]};
      },
      judge:async()=>{throw Error("Execution must not judge");},
    },[testCase]);
    expect(run!.verificationStatus).toBe("verified");
  });
});
