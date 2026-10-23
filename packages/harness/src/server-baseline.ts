import type {
  BaselineRun,
  EvaluateAiResult,
  ExecuteArtifactBatchAiResult,
  EvolveProject,
  TargetRunResult,
  TestCase,
  OriginalArtifactReferenceProof,
} from "@evolution/contracts";
import {OriginalArtifactReferenceProofSchema} from "@evolution/contracts";
import {
  baselineReadiness,
  campaignLiveObservationFresh,
  campaignObservesLiveTarget,
  campaignRootBaselineForMeasurement,
  campaignScoringInputBlocker,
  campaignScoringInputFingerprint,
  criteriaRequiringJudge,
  rubricSuiteCoverage,
  rubricValidation,
  settleAiEvaluation,
  settleDeterministicEvaluation,
  originalBaselineReferenceCriteria,
} from "@evolution/core";
import {
  baselineLocalEvidence,
  compactBaselineRunOutput,
  currentSemanticArtifactContext,
  serverBaselineCurrentViewGap,
  semanticEvidenceStatus,
  serverBaselineFingerprint,
  storedBaselineEvidence,
  unavailableBaselineRun,
} from "./server-baseline-evidence";
import { indexUniqueBatchResults } from "./server-batch-results";
import {groundedOriginalCitationDefect,groundedOriginalDocumentProtection} from "./server-grounded-baseline-defect";
import { serverExperimentRecoveryCheckpoint } from "./server-experiment-wait";
import {currentHtmlDocumentTextObservation} from "./server-current-document-evidence";

export { trustedServerBaselineChampion, serverBaselineFingerprint } from "./server-baseline-evidence";

/** Stop durable Campaign comparisons before a changed Server AI scoring route can reuse old scores. */
export function serverCampaignScoringRouteBlocker(project: EvolveProject, routeFingerprint?: string): string | undefined {
  if (!routeFingerprint || project.campaign.currentRound === 0) return undefined;
  if (project.campaign.scoringRouteFingerprint === routeFingerprint) return undefined;
  return "[server-campaign-scoring-route-changed] 服务端执行或评审配置已变化，旧 Campaign 分数不可直接比较；请重置搜索后重新运行。生产发布状态不会被重置。";
}
/** A ready score is reusable only for the exact current Target, tests, Champion and Server AI route. */
export function canReuseServerBaseline(project: EvolveProject, routeFingerprint?: string, nowMs = Date.now()): boolean {
  if (campaignObservesLiveTarget(project) && (project.campaign.checkpoint?.round !== project.campaign.currentRound + 1
    || !campaignLiveObservationFresh(project, project.baselineRun.completedAt, nowMs))) return false;

  return baselineReadiness(project).ready
    && project.baselineRun.measurementFingerprint === serverBaselineFingerprint(project, routeFingerprint);
}
export type ServerBaselinePorts = {
  scoringRouteFingerprint?: string;
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

export type ServerBaselineOutcome = {
  project: EvolveProject;
  baseline: BaselineRun;
  ready: boolean;
  reason: string;
  capabilityGaps: string[];
};

/**
 * A fully read Original can lack a NEW soft quality dimension. That is not a
 * missing Runner and must not prevent searching for a Candidate which adds it.
 * Preserve its UNVERIFIED score: this is not a VERIFIED failure or a PASS.
 *
 * Only defer when the source was actually inspected by the semantic Runner;
 * missing/duplicate/transport results carry warning traces and still block.
 * Mixed Hard Gate cases never qualify.
 */
function deferrableOriginalSoftObservation(
  project:EvolveProject,testCase:TestCase,run:TargetRunResult|undefined,
):boolean{
  if(!run||run.error||run.verificationStatus!=="unverified"
    ||!/^\s*UNVERIFIED\b/i.test(run.output)
    ||!testCase.criterionIds.length
    ||run.trace.some(trace=>trace.status==="warning")
    ||!run.trace.some(trace=>trace.stage==="AI 语义核查"&&trace.status==="info")
    ||!run.trace.some(trace=>trace.status==="fail"))return false;
  const rubric=new Map(project.acceptanceRubric.map(criterion=>[criterion.id,criterion]));
  return testCase.criterionIds.every(id=>rubric.get(id)?.hardGate===false);
}

/**
 * Run the visible Baseline on the server without React/browser runtime dependencies.
 * Missing capabilities remain UNVERIFIED; infrastructure absence is never converted to product failure.
 */
export async function runServerBaseline(
  inputProject: EvolveProject,
  ports: ServerBaselinePorts,
  options?: { now?: () => string },
): Promise<ServerBaselineOutcome> {
  const now = options?.now ?? (() => new Date().toISOString());
  const startedAt = now();
  const scoringBlocker = campaignScoringInputBlocker(inputProject) ?? serverCampaignScoringRouteBlocker(inputProject, ports.scoringRouteFingerprint);
  if (scoringBlocker) {
    const paused: EvolveProject = {
      ...inputProject,
      campaign: {
        ...inputProject.campaign,
        status: "paused",
        stopReason: scoringBlocker,
        schedule: { ...inputProject.campaign.schedule, enabled: false, nextRunAt: undefined },
      },
      updatedAt: startedAt,
    };
    return { project: paused, baseline: paused.baselineRun, ready: false, reason: scoringBlocker, capabilityGaps: ["server-scoring-contract"] };
  }
  const targetGate = inputProject.gates.find((gate) => gate.id === "target-ready");
  if (targetGate?.status !== "approved") throw new Error("Target Ready gate is not approved");
  if (!inputProject.evalSuite.length) throw new Error("Project evalSuite is empty");
  const rubricCheck = rubricValidation(inputProject.acceptanceRubric,inputProject.sourceArtifacts);
  if (!rubricCheck.ready) throw new Error(`Acceptance Rubric is not ready: ${rubricCheck.warnings.join("；")}`);
  const coverage = rubricSuiteCoverage(inputProject.acceptanceRubric, inputProject.evalSuite, inputProject.hiddenEvalSuite);
  if (!coverage.ready) {
    throw new Error(`Eval Suite does not cover current Acceptance Rubric: ${[
      ...coverage.uncovered,
      ...coverage.hiddenHardGateMissing.map((criterion) => criterion.id),
    ].join(", ")}`);
  }

  const project: EvolveProject = {
    ...inputProject,
    baselineRun: {
      ...inputProject.baselineRun,
      id: `baseline-server-${Date.parse(startedAt) || Date.now()}`,
      status: "running",
      startedAt,
      completedAt: undefined,
      totalCases: inputProject.evalSuite.length,
      runs: [],
      result: undefined,
      originalReferences:undefined,referenceOnlyCriterionIds:undefined,
      measurementFingerprint: serverBaselineFingerprint(inputProject, ports.scoringRouteFingerprint),
    },
    stage: "baseline",
    updatedAt: startedAt,
  };

  const ordered = new Map<string, TargetRunResult>();
  let currentArtifactContext:Array<Record<string,unknown>>=[];
  let referenceOnlyCriterionIds=new Set<string>();
  let originalReferences:OriginalArtifactReferenceProof[]=[];
  const semanticCases: TestCase[] = [];
  const externalCases: TestCase[] = [];
  for (const testCase of project.evalSuite) {
    const stored = await storedBaselineEvidence(project, testCase, ports.executeStoredEvidence);
    if (stored) { ordered.set(testCase.id, stored); continue; }
    const currentViewGap = testCase.executionMode === "artifact-runtime" && ports.buildCurrentArtifactContext
      ? undefined : serverBaselineCurrentViewGap(project, testCase);
    if (currentViewGap) {
      ordered.set(testCase.id, unavailableBaselineRun(testCase, currentViewGap));
      continue;
    }
    const local = baselineLocalEvidence(project, testCase);
    if (local) {
      ordered.set(testCase.id, local);
      continue;
    }
    if (testCase.executionMode === "external-runner" || testCase.executionMode === "visual-review") {
      externalCases.push(testCase);
      continue;
    }
    if (testCase.executionMode === "artifact-runtime") {
      semanticCases.push(testCase);
      continue;
    }
    ordered.set(testCase.id, unavailableBaselineRun(testCase, `Server Baseline 暂不支持 executionMode=${testCase.executionMode} 的真实执行。`));
  }

  if (externalCases.length) {
    if (!ports.executeExternalBatch) {
      for (const testCase of externalCases) ordered.set(testCase.id, unavailableBaselineRun(testCase, "Server External Runner / Sandbox 未连接。"));
    } else {
      try {
        const results = await ports.executeExternalBatch({ project, testCases: externalCases });
        const { byId, duplicateIds } = indexUniqueBatchResults(results);
        for (const testCase of externalCases) {
          ordered.set(testCase.id, duplicateIds.has(testCase.id)
            ? unavailableBaselineRun(testCase, "Server External Runner 对本题返回了重复结果，证据身份不明确。")
            : byId.get(testCase.id) ?? unavailableBaselineRun(testCase, "Server External Runner 没有返回本题结果。"));
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        for (const testCase of externalCases) ordered.set(testCase.id, unavailableBaselineRun(testCase, `Server External Runner 未完成：${message}`));
      }
    }
  }

  if (semanticCases.length) {
    const semanticStarted=Date.now();
    try {
      const artifactContext=await currentSemanticArtifactContext(project,ports.buildCurrentArtifactContext,semanticCases);
      currentArtifactContext=artifactContext;
      const references=artifactContext.flatMap(entry=>{
        const proof=OriginalArtifactReferenceProofSchema.safeParse(entry.originalReference);
        return proof.success&&proof.data.sourceArtifactId===entry.id&&proof.data.sha256===entry.artifactSha256?[proof.data]:[];
      });
      referenceOnlyCriterionIds=new Set(originalBaselineReferenceCriteria(project,references));
      originalReferences=references;
      for(const testCase of semanticCases){
        // Complete original bytes may directly prove a written defect or protected
        // instruction. This is evidence of document text, not Agent behavior.
        const direct=groundedOriginalCitationDefect({
          project,testCase,output:"UNVERIFIED: pre-candidate exact source evidence",artifactContext,
        })??groundedOriginalDocumentProtection({project,testCase,artifactContext})
          ??currentHtmlDocumentTextObservation(project,testCase,artifactContext);
        if(direct)ordered.set(testCase.id,direct);
      }
      const remaining=semanticCases.filter(testCase=>!ordered.has(testCase.id));
      if(remaining.length){
        const result=await ports.executeSemanticBatch({project,testCases:remaining,artifactContext});
        const {byId,duplicateIds}=indexUniqueBatchResults(result.results);
        const latency=Math.max(1,Math.round((Date.now()-semanticStarted)/Math.max(1,remaining.length)));
        for(const testCase of remaining){
          const item=byId.get(testCase.id);
          const status=item?semanticEvidenceStatus(item.output):"unverified";
          ordered.set(testCase.id,duplicateIds.has(testCase.id)
            ?unavailableBaselineRun(testCase,"Server AI Batch 对本题返回了重复结果，证据身份不明确。")
            :item?{
              testCaseId:testCase.id,output:item.output,latencyMs:latency,cost:0,
              verificationStatus:artifactContext.some(artifact=>artifact.truncated)&&status==="verified"?"partial":status,
              trace:[{id:"server-semantic-"+testCase.id,stage:"AI 语义核查",
                summary:"Server AI 读取当前 Baseline 成果并按本题定位显性内容",status:"info",
                detail:"这是成果观察证据；独立 Judge 仍负责 Rubric 结算。"},...item.trace],
            }:unavailableBaselineRun(testCase,"Server AI Batch 未返回本题结果。"));
        }
      }
    } catch(error) {
      const message=error instanceof Error?error.message:String(error);
      // A later provider failure must never erase already grounded source evidence.
      for(const testCase of semanticCases){
        if(!ordered.has(testCase.id))ordered.set(testCase.id,
          unavailableBaselineRun(testCase,"Server AI Artifact Runtime 未完成："+message));
      }
    }
  }
  const runs = project.evalSuite.map((testCase) => ordered.get(testCase.id) ?? unavailableBaselineRun(testCase, "Baseline 执行未返回结果。"));
  const evaluableRuns = runs.filter((run) => run.verificationStatus === "verified" || run.verificationStatus === "partial");
  if (!evaluableRuns.length) {
    const baseline: BaselineRun = {
      ...project.baselineRun,
      status: "failed",
      completedAt: now(),
      runs,
    };
    const reason = "[server-campaign-baseline-evidence-pending] Server Baseline 没有获得任何 VERIFIED/PARTIAL 证据；禁止进入诊断。";
    const nextProject = {
      ...project,
      baselineRun: baseline,
      campaign: {
        ...project.campaign,
        status: "paused" as const,
        stopReason: reason,
        schedule: { ...project.campaign.schedule, enabled: false, nextRunAt: undefined },
      },
      updatedAt: now(),
    };
    return { project: nextProject, baseline, ready: false, reason, capabilityGaps: runs.map((run) => run.testCaseId) };
  }

  const comparisonOnlyCriterionIds=new Set(["SYS-PAIRWISE",...referenceOnlyCriterionIds]);
  // A shared case score may support an intrinsic requirement without proving
  // a comparison whose Candidate side does not yet exist. Keep actual runs
  // unchanged; remove only those mappings from this Baseline's settlement paper.
  const scoringCases=project.evalSuite.map(test=>({...test,
    criterionIds:test.criterionIds.filter(id=>!comparisonOnlyCriterionIds.has(id)),
  }));
  const judgeCriteria = criteriaRequiringJudge(project.acceptanceRubric, scoringCases, runs)
    .filter(criterion=>!comparisonOnlyCriterionIds.has(criterion.id));
  const referenceNotes=referenceOnlyCriterionIds.size
    ?["原版对照已从不可变 Storage 字节锁定；以下保护项在初次 Baseline 只建立参照，不宣告候选通过，必须在 Candidate / Hidden / 独立终验逐项结算："+[...referenceOnlyCriterionIds].join("、")]
    :[];
  const judgeIds = new Set(judgeCriteria.map((criterion) => criterion.id));
  const evaluableIds = new Set(
    project.evalSuite
      .filter((testCase) => testCase.criterionIds.length === 0 || testCase.criterionIds.some((id) => judgeIds.has(id)))
      .map((testCase) => testCase.id),
  );
  const judgeRuns = evaluableRuns.filter((run) => evaluableIds.has(run.testCaseId));
  const judgeRunIds = new Set(judgeRuns.map((run) => run.testCaseId));
  const judgeCases = project.evalSuite.filter((testCase) => judgeRunIds.has(testCase.id));
  const effectiveCriteria = judgeCriteria.filter((criterion) => judgeCases.some((testCase) => testCase.criterionIds.includes(criterion.id)));
  const judgePayload = {
    mode: "server-baseline",
    project: {
      goal: project.goal,
      metrics: project.metrics,
      acceptanceRubric: effectiveCriteria,
    },
    acceptanceRubric: effectiveCriteria,
    artifactContext:currentArtifactContext,
    evaluatorInstruction: "Judge only supplied current Baseline evidence. Independently inspect artifactContext when provided, rather than trusting an execution model's summary as source truth. Respect its representation, truncation and excluded runtime/visual scope. Never cite diagnosis, plans or patches. UNVERIFIED tests are omitted and must not be invented as failures. PARTIAL evidence cannot fully satisfy a hard gate.",
    testCases: judgeCases.map((testCase) => ({
      id: testCase.id,
      title: testCase.title,
      input: testCase.input.slice(0, 1600),
      expected: testCase.expected,
      tags: testCase.tags,
      criterionIds: testCase.criterionIds.filter(id=>judgeIds.has(id)),
      executionMode: testCase.executionMode,
      evidenceScope: testCase.evidenceScope,
    })),
    runs: judgeRuns.map((run) => {
      const testCase = project.evalSuite.find((item) => item.id === run.testCaseId);
      const query = `${testCase?.title ?? ""} ${testCase?.input ?? ""} ${(testCase?.expected ?? []).join(" ")}`;
      return {
        testCaseId: run.testCaseId,
        verificationStatus: run.verificationStatus,
        outputChunks: [compactBaselineRunOutput(run.output, query)],
        trace: run.trace.slice(0, 12).map((step) => ({ stage: step.stage, status: step.status, summary: step.summary })),
      };
    }),
  };

  let evaluation;
  try {
    if (!judgeRuns.length || !effectiveCriteria.length) {
      evaluation = settleDeterministicEvaluation({
        criteria: project.acceptanceRubric,
        testCases: scoringCases,
        runs,
        notes: ["Server Baseline：仅结算已获得的确定性证据；缺失语义评审的标准保持 UNVERIFIED，通用质量维度未测量。",...referenceNotes],
      });
    } else {
      const judged = await ports.judge(judgePayload);
      evaluation = settleAiEvaluation({
        criteria: project.acceptanceRubric,
        testCases: scoringCases,
        runs,
        ai: judged,
        notes: [
          "Server Baseline：执行与独立 Judge 均在 Durable Workflow 后端完成。",
          ...referenceNotes,
          ...(runs.some((run) => run.verificationStatus === "unverified")
            ? ["部分测试仍缺真实执行能力；对应 Criterion 保持 UNVERIFIED/PARTIAL，不按产品失败处理。"]
            : []),
        ],
      });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const baseline: BaselineRun = {
      ...project.baselineRun,
      status: "failed",
      completedAt: now(),
      runs,
    };
    const reason = `[server-campaign-baseline-judge-pending] Baseline 执行已有证据，但独立 Server Judge 未完成：${message}`;
    const nextProject = {
      ...project,
      baselineRun: baseline,
      campaign: {
        ...project.campaign,
        status: "paused" as const,
        stopReason: reason,
        schedule: { ...project.campaign.schedule, enabled: false, nextRunAt: undefined },
      },
      updatedAt: now(),
    };
    return { project: nextProject, baseline, ready: false, reason, capabilityGaps: ["server-judge"] };
  }

  evaluation={...evaluation,criterionScores:evaluation.criterionScores?.map(score=>comparisonOnlyCriterionIds.has(score.criterionId)
    ?{...score,gaps:["当前 Baseline 只观察原版或当前版本，尚无本次 Candidate 的双侧对照证据；保持未验证，不宣告改进或保护项通过"],
      testCaseIds:project.evalSuite.filter(test=>test.criterionIds.includes(score.criterionId)).map(test=>test.id)}
    :score)};
  const baseline: BaselineRun = {
    ...project.baselineRun,
    status: "completed",
    completedAt: now(),
    runs,
    result: evaluation,
    originalReferences,referenceOnlyCriterionIds:[...referenceOnlyCriterionIds],
  };
  const runById = new Map(runs.map((run) => [run.testCaseId, run]));
  const deferrableSoft=project.evalSuite.filter(testCase=>
    deferrableOriginalSoftObservation(project,testCase,runById.get(testCase.id)));
  const deferredIds=new Set(deferrableSoft.map(testCase=>testCase.id));
  const requiredCapabilityGaps = project.evalSuite.filter((testCase) => {
    const comparisonOnly = testCase.criterionIds.length > 0 && testCase.criterionIds.every((id) => id === "SYS-PAIRWISE");
    if (comparisonOnly || deferredIds.has(testCase.id)) return false;
    const status = runById.get(testCase.id)?.verificationStatus ?? "unverified";
    return status === "unverified" || status === "failed";
  });
  const criterionById = new Map((evaluation.criterionScores ?? []).map((item) => [item.criterionId, item]));
  // SYS-PAIRWISE compares the evolved Candidate with its source, so it cannot be
  // VERIFIED before a Candidate exists. An initial locked Original also supplies
  // only the reference for scoped preservation comparisons, never a Candidate pass.
  const hardGateGaps = project.acceptanceRubric.filter((criterion) =>
    criterion.hardGate && criterion.id !== "SYS-PAIRWISE"&&!referenceOnlyCriterionIds.has(criterion.id)
    && criterionById.get(criterion.id)?.verificationStatus !== "verified");
  const measured: EvolveProject = {
    ...project,
    baselineRun: baseline,
    campaign: {
      ...project.campaign,
      rootBaseline: campaignRootBaselineForMeasurement(project, evaluation, ports.scoringRouteFingerprint, true),
      scoringRouteFingerprint: project.campaign.currentRound === 0 ? ports.scoringRouteFingerprint ?? project.campaign.scoringRouteFingerprint : project.campaign.scoringRouteFingerprint,
      scoringInputFingerprint: project.campaign.currentRound === 0 ? campaignScoringInputFingerprint(project) : project.campaign.scoringInputFingerprint,
    },
    updatedAt: now(),
  };
  const readiness = baselineReadiness(measured);
  if (requiredCapabilityGaps.length || hardGateGaps.length || !readiness.ready) {
    const details = [
      ...readiness.blockers,
      ...(requiredCapabilityGaps.length ? [`未完成真实执行：${requiredCapabilityGaps.map((item) => item.id).join("、")}`] : []),
      ...(hardGateGaps.length ? [`Hard Gate 未获得 VERIFIED 证据：${hardGateGaps.map((item) => item.id).join("、")}`] : []),
    ];
    const reason = `[server-campaign-baseline-evidence-pending] Server Baseline 已完成，但证据仍不足以进入自动诊断：${details.join("；")}`;
    const paused: EvolveProject = {
      ...measured,
      stage: "baseline",
      campaign: {
        ...measured.campaign,
        status: "paused",
        stopReason: reason,
        schedule: { ...measured.campaign.schedule, enabled: false, nextRunAt: undefined },
      },
      updatedAt: now(),
    };
    return {
      project: paused,
      baseline,
      ready: false,
      reason,
      capabilityGaps: [...new Set([
        ...requiredCapabilityGaps.map((testCase) => testCase.id),
        ...hardGateGaps.map((criterion) => `criterion:${criterion.id}`),
      ])],
    };
  }

  const checkpointAt = now();
  // A fresh comparison reruns observations without discarding checkpoint-bound frozen construction.
  const experimentCheckpoint = serverExperimentRecoveryCheckpoint(inputProject) ? inputProject.campaign.checkpoint : undefined;
  const readyProject: EvolveProject = {
    ...measured,
    stage: experimentCheckpoint ? "experiment" : "problem",
    campaign: {
      ...measured.campaign,
      status: "running",
      stopReason: undefined,
      checkpoint: experimentCheckpoint ?? {
        round: measured.campaign.currentRound + 1,
        completedPhase: "baseline",
        at: checkpointAt,
      },
    },
    updatedAt: checkpointAt,
  };
  return {
    project: readyProject,
    baseline,
    ready: true,
    reason: `Server Baseline 已完成：${readiness.verified} verified / ${readiness.partial} partial，证据覆盖 ${readiness.evidenceCoverage}%${deferrableSoft.length ? `；${deferrableSoft.length} 道原版非强制题仍为 UNVERIFIED，需在 Candidate/Hidden 重新验证` : ""}`,
    capabilityGaps: [],
  };
}
