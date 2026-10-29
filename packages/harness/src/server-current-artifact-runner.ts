import type {
  EvaluateAiResult,
  ExecuteArtifactBatchAiResult,
  EvolveProject,
  TargetRunResult,
  TestCase,
} from "@evolution/contracts";
import { criteriaRequiringJudge, settleDeterministicEvaluation, settleAiEvaluation } from "@evolution/core";
import {
  baselineLocalEvidence,
  compactBaselineRunOutput,
  currentSemanticArtifactContext,
  semanticEvidenceStatus,
  serverBaselineCurrentViewGap,
  storedBaselineEvidence,
  unavailableBaselineRun,
} from "./server-baseline-evidence";
import { indexUniqueBatchResults } from "./server-batch-results";
import { groundedOriginalCitationDefect, groundedOriginalDocumentProtection } from "./server-grounded-baseline-defect";
import { currentHtmlDocumentTextObservation } from "./server-current-document-evidence";
import { measuredDocumentObservations, SERVER_MEASURED_REVIEW_VERSION,SERVER_NATIVE_REVIEW_INSTRUCTION } from "./server-measured-review-evidence";
import {assertServerHtmlNativePaymentAvailable,collectServerHtmlNativeRuns,bindServerHtmlNativeOriginalReferences,serverHtmlNativePaymentBlockedRuns,type ServerHtmlNativePort} from "./server-html-native-runs";

export type ServerCurrentArtifactPorts = ServerHtmlNativePort & {
  executeSemanticBatch(args: {
    project: EvolveProject;
    testCases: TestCase[];
    artifactContext: Array<Record<string, unknown>>;
  }): Promise<ExecuteArtifactBatchAiResult>;
  executeStoredEvidence?(args: { project: EvolveProject; testCase: TestCase }): Promise<TargetRunResult>;
  buildCurrentArtifactContext?(args: { project: EvolveProject; testCases?: TestCase[] }): Promise<Array<Record<string, unknown>>>;
  executeExternalBatch?(args: {
    project: EvolveProject;
    testCases: TestCase[];
  }): Promise<TargetRunResult[]>;
  judge(payload: unknown): Promise<EvaluateAiResult>;
};

function deterministicOnly(project:EvolveProject,testCases:TestCase[],runs:TargetRunResult[]){
  return settleDeterministicEvaluation({
    criteria:project.acceptanceRubric,testCases,runs,
    notes:["当前同卷 Baseline 仅获得确定性证据；未测量的通用质量维度保持 0，不代表产品失败。"],
  });
}

export async function executeServerCurrentArtifactSuite(
  project:EvolveProject,
  testCases:TestCase[],
  ports:ServerCurrentArtifactPorts,
){
  const ordered=await collectServerHtmlNativeRuns(project,testCases,ports);
  bindServerHtmlNativeOriginalReferences(ordered,project.baselineRun.originalReferences??[],project.id);
  const paymentBlocked=serverHtmlNativePaymentBlockedRuns(testCases,ordered);if(paymentBlocked)return paymentBlocked;
  const semanticCases:TestCase[]=[];
  const externalCases:TestCase[]=[];
  for(const testCase of testCases){
    if(ordered.has(testCase.id))continue;
    if(testCase.browserSteps?.length&&!["external-runner","visual-review"].includes(testCase.executionMode)){
      ordered.set(testCase.id,{...unavailableBaselineRun(testCase,"声明的浏览器断言必须经真实浏览器执行通道完成，不能回落为语义/静态证据。"),error:"SERVER_BROWSER_ASSERTION_MODE_UNAVAILABLE"});
      continue;
    }
    const stored=await storedBaselineEvidence(project,testCase,ports.executeStoredEvidence);
    if(stored){ordered.set(testCase.id,stored);continue;}
    const gap=testCase.executionMode==="artifact-runtime"&&ports.buildCurrentArtifactContext
      ?undefined:serverBaselineCurrentViewGap(project,testCase);
    if(gap){ordered.set(testCase.id,unavailableBaselineRun(testCase,gap));continue;}
    const local=baselineLocalEvidence(project,testCase);
    if(local){ordered.set(testCase.id,local);continue;}
    if(testCase.executionMode==="external-runner"||testCase.executionMode==="visual-review"){externalCases.push(testCase);continue;}
    if(testCase.executionMode==="artifact-runtime"){semanticCases.push(testCase);continue;}
    ordered.set(testCase.id,unavailableBaselineRun(testCase,`Server 当前版本暂不支持 executionMode=${testCase.executionMode} 的真实执行。`));
  }
  if(externalCases.length){
    if(!ports.executeExternalBatch){
      for(const testCase of externalCases)ordered.set(testCase.id,unavailableBaselineRun(testCase,"Server External Runner / Sandbox 未连接。"));
    }else{
      try{
        const results=await ports.executeExternalBatch({project,testCases:externalCases});
        const {byId,duplicateIds}=indexUniqueBatchResults(results);
        for(const testCase of externalCases)ordered.set(testCase.id,duplicateIds.has(testCase.id)
          ?unavailableBaselineRun(testCase,"Server External Runner 对本题返回了重复结果，证据身份不明确。")
          :byId.get(testCase.id)??unavailableBaselineRun(testCase,"Server External Runner 没有返回本题结果。"));
      }catch(error){
        const message=error instanceof Error?error.message:String(error);
        for(const testCase of externalCases)ordered.set(testCase.id,unavailableBaselineRun(testCase,`Server External Runner 未完成：${message}`));
      }
    }
  }
  if(semanticCases.length){
    const started=Date.now();
    let artifactContext:Array<Record<string,unknown>>|undefined;
    try{
      artifactContext=await currentSemanticArtifactContext(project,ports.buildCurrentArtifactContext,semanticCases);
      const result=await ports.executeSemanticBatch({project,testCases:semanticCases,artifactContext});
      const {byId,duplicateIds}=indexUniqueBatchResults(result.results);
      const latency=Math.max(1,Math.round((Date.now()-started)/Math.max(1,semanticCases.length)));
      for(const testCase of semanticCases){
        const item=byId.get(testCase.id);
        ordered.set(testCase.id,duplicateIds.has(testCase.id)
          ?unavailableBaselineRun(testCase,"Server AI Batch 对本题返回了重复结果，证据身份不明确。")
          :item ? groundedOriginalCitationDefect({project,testCase,output:item.output,artifactContext})
            ?? groundedOriginalDocumentProtection({project,testCase,artifactContext})
            ?? currentHtmlDocumentTextObservation(project,testCase,artifactContext) ?? {
          testCaseId:testCase.id,output:item.output,latencyMs:latency,cost:0,
          verificationStatus:artifactContext.some((artifact)=>artifact.truncated)&&semanticEvidenceStatus(item.output)==="verified"?"partial":semanticEvidenceStatus(item.output),
          trace:[{id:`server-current-semantic-${testCase.id}`,stage:"AI 语义核查",summary:"Server AI 读取当前版本并定位同卷证据",status:"info",detail:"仅提供当前成果观察；独立 Judge 负责 Rubric 结算。"},...item.trace],
        }:unavailableBaselineRun(testCase,"Server AI Batch 未返回本题结果。"));
      }
    }catch(error){
      const message=error instanceof Error?error.message:String(error);
      for(const testCase of semanticCases){
        // Only exact, complete, directly pasted document text may provide a
        // deterministic negative observation or written protection instruction.
        // A provider's invalid JSON never turns a behavioral/remote test into success.
        const grounded=artifactContext && (
          groundedOriginalCitationDefect({project,testCase,output:"UNVERIFIED: batch provider failed",artifactContext})
          ?? groundedOriginalDocumentProtection({project,testCase,artifactContext})
          ?? currentHtmlDocumentTextObservation(project,testCase,artifactContext)
        );
        ordered.set(testCase.id,grounded??unavailableBaselineRun(testCase,`Server AI Artifact Runtime 未完成：${message}`));
      }
    }
  }
  return testCases.map((testCase)=>ordered.get(testCase.id)??unavailableBaselineRun(testCase,"当前版本同卷执行未返回结果。"));
}

export async function judgeServerCurrentArtifactSuite(
  project:EvolveProject,
  testCases:TestCase[],
  runs:TargetRunResult[],
  ports:ServerCurrentArtifactPorts,
){
  assertServerHtmlNativePaymentAvailable(runs);
  const judgeCriteria=criteriaRequiringJudge(project.acceptanceRubric,testCases,runs);
  const judgeIds=new Set(judgeCriteria.map((criterion)=>criterion.id));
  const evaluableIds=new Set(runs.filter((run)=>run.verificationStatus==="verified"||run.verificationStatus==="partial").map((run)=>run.testCaseId));
  const judgeCases=testCases.filter((testCase)=>evaluableIds.has(testCase.id)&&(testCase.criterionIds.length===0||testCase.criterionIds.some((id)=>judgeIds.has(id))));
  const judgeCaseIds=new Set(judgeCases.map((testCase)=>testCase.id));
  const effectiveCriteria=judgeCriteria.filter((criterion)=>judgeCases.some((testCase)=>testCase.criterionIds.includes(criterion.id)));
  if(!judgeCases.length||!effectiveCriteria.length)return deterministicOnly(project,testCases,runs);
  const ai=await ports.judge({
    mode:"server-holdout-baseline",
    measuredReviewVersion:SERVER_MEASURED_REVIEW_VERSION,
    measuredCurrentDocuments:measuredDocumentObservations(runs.filter(run=>judgeCaseIds.has(run.testCaseId))),
    project:{goal:project.goal,metrics:project.metrics,acceptanceRubric:effectiveCriteria},
    acceptanceRubric:effectiveCriteria,
    evaluatorInstruction:"Judge only supplied CURRENT VERSION evidence from the hidden same-paper baseline. Read existing measuredCurrentDocuments before treating compact excerpts as missing document content. Respect their omissions: document text cannot establish scripts, styles, visual or runtime behavior. UNVERIFIED tests are omitted and must not be invented as failures. Never cite diagnosis, plan or Candidate claims. "+SERVER_NATIVE_REVIEW_INSTRUCTION,
    testCases:judgeCases.map((testCase)=>({id:testCase.id,title:testCase.title,input:testCase.input.slice(0,1600),expected:testCase.expected,tags:testCase.tags,criterionIds:testCase.criterionIds,executionMode:testCase.executionMode,evidenceScope:testCase.evidenceScope})),
    runs:runs.filter((run)=>judgeCaseIds.has(run.testCaseId)).map((run)=>{
      const testCase=testCases.find((item)=>item.id===run.testCaseId);
      const query=`${testCase?.title??""} ${testCase?.input??""} ${(testCase?.expected??[]).join(" ")}`;
      return {testCaseId:run.testCaseId,verificationStatus:run.verificationStatus,outputChunks:[compactBaselineRunOutput(run.output,query)],trace:run.trace.slice(0,12).map((step)=>({stage:step.stage,status:step.status,summary:step.summary}))};
    }),
  });
  return {...settleAiEvaluation({
    criteria:project.acceptanceRubric,testCases,runs,ai,
    notes:["Server Hidden Holdout：当前版本已在隐藏同卷执行并独立 Judge。",...(runs.some((run)=>run.verificationStatus==="unverified")?["部分隐藏题缺真实执行能力；对应 Criterion 保持 UNVERIFIED。"]:[])],
  }),measuredReviewVersion:SERVER_MEASURED_REVIEW_VERSION};
}
