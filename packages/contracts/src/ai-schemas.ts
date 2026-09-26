import { z } from "zod";
import {
  AcceptanceCriterionSchema,
  ArtifactRoleSchema,
  CandidateArtifactSnapshotSchema,
  CandidateSchema,
  DiagnosisSchema,
  NextQueueItemSchema,
  ProblemSchema,
  SemanticObjectSchema,
  SemanticWorkflowStageSchema,
  TestCaseSchema,
} from "./evolve-schemas";

export const AiOperationSchema = z.enum([
  "intake",
  "understand",
  "command",
  "target",
  "eval-suite",
  "problem-analysis",
  "diagnose",
  "plan",
  "rubric",
  "build-candidate",
  "execute-artifact",
  "execute-artifact-batch",
  "evaluate-population",
  "artifact-acceptance",
  "repair-artifact",
  "materialize",
  "release-review",
  "distill",
  "next-queue",
  "copilot",
  "evaluate",
  "gap-cluster",
  "gap-advice",
  "visual-judge",
]);
export type AiOperation = z.infer<typeof AiOperationSchema>;

const metricDefinition = z.object({
  key: z.string(),
  label: z.string(),
  target: z.number(),
  unit: z.string(),
  direction: z.enum(["higher", "lower"]),
  why: z.string(),
});

export const IntakeAiResultSchema = z.object({
  projectName: z.string(),
  detectedObjectType: z.enum(["agent", "system", "prompt", "workflow", "knowledge", "tool", "template", "document", "presentation", "spreadsheet", "codebase"]),
  currentStateSummary: z.string(),
  evolutionIntent: z.string(),
  goal: z.string(),
  metrics: z.array(metricDefinition).min(2).max(6),
  protectedItems: z.array(z.string()).min(1),
  editableItems: z.array(z.string()).min(1),
  acceptanceCriteria: z.array(z.string()).min(2),
  acceptanceRubric: z.array(AcceptanceCriterionSchema).min(3).max(8),
  semanticObject: SemanticObjectSchema,
  semanticWorkflowStages: z.array(SemanticWorkflowStageSchema).length(6),
  semanticWarnings: z.array(z.string()).default([]),
  risks: z.array(z.string()).default([]),
  artifactSummaries: z.array(z.object({
    artifactId: z.string(),
    summary: z.string(),
    detectedRole: ArtifactRoleSchema.optional(),
  })).default([]),
  followUpQuestions: z.array(z.string()).default([]),
});
export type IntakeAiResult = z.infer<typeof IntakeAiResultSchema>;

// 深度输入理解：intake 之后在后台再读一遍全部材料，复述意图、挖隐含要求、
// 把真正的歧义变成「可回答的确认题」（带默认假设，自动驾驶模式可直接采用）。
export const UnderstandAiResultSchema = z.object({
  intentRestatement: z.string(),
  implicitRequirements: z.array(z.string()).default([]),
  assumptions: z.array(z.string()).default([]),
  clarifications: z.array(z.object({
    question: z.string(),
    whyItMatters: z.string(),
    defaultAnswer: z.string(),
  })).max(4).default([]),
  acceptanceFocus: z.array(z.string()).default([]),
  confidence: z.number().min(0).max(1).default(0.7),
});
export type UnderstandAiResult = z.infer<typeof UnderstandAiResultSchema>;

export const CommandAiResultSchema = z.object({
  answer: z.string(),
  updatedCommand: z.string(),
  shouldRefreshTarget: z.boolean().default(false),
  protectedItemsAdd: z.array(z.string()).default([]),
  editableItemsAdd: z.array(z.string()).default([]),
  suggestedAction: z.enum([
    "none", "refresh-target", "generate-eval-suite", "run-baseline", "analyze-problems",
    "run-diagnosis", "generate-plan", "run-experiment", "run-validation", "start-shadow",
    "advance-canary", "distill-learning", "generate-next-queue",
  ]).default("none"),
  suggestedActionLabel: z.string().optional(),
});
export type CommandAiResult = z.infer<typeof CommandAiResultSchema>;

export const TargetAiResultSchema = z.object({
  goal: z.string(),
  metrics: z.array(metricDefinition).min(2).max(6),
  protectedItems: z.array(z.string()).min(1),
  editableItems: z.array(z.string()).min(1),
  acceptanceCriteria: z.array(z.string()).min(2),
  risks: z.array(z.string()).default([]),
});
export type TargetAiResult = z.infer<typeof TargetAiResultSchema>;

export const EvalSuiteAiResultSchema = z.object({
  validationCases: z.array(TestCaseSchema).min(3).max(12),
  hiddenCases: z.array(TestCaseSchema).min(2).max(8),
  summary: z.string(),
});
export type EvalSuiteAiResult = z.infer<typeof EvalSuiteAiResultSchema>;

export const ProblemAnalysisAiResultSchema = z.object({
  problems: z.array(ProblemSchema).min(1).max(8),
  recommendedProblemId: z.string(),
  summary: z.string(),
});
export type ProblemAnalysisAiResult = z.infer<typeof ProblemAnalysisAiResultSchema>;

export const DiagnosisAiResultSchema = DiagnosisSchema;
export type DiagnosisAiResult = z.infer<typeof DiagnosisAiResultSchema>;

export const PlanAiResultSchema = z.object({
  candidates: z.array(CandidateSchema).min(1).max(8),
  recommendedCandidateIds: z.array(z.string()).min(1),
  summary: z.string(),
  experimentDesign: z.array(z.string()).min(2),
});
export type PlanAiResult = z.infer<typeof PlanAiResultSchema>;

export const RubricAiResultSchema = z.object({
  criteria: z.array(AcceptanceCriterionSchema).min(3).max(8),
  summary: z.string(),
});
export type RubricAiResult = z.infer<typeof RubricAiResultSchema>;

export const BuildCandidateAiResultSchema = z.object({
  artifacts: z.array(CandidateArtifactSnapshotSchema.omit({ id: true, createdAt: true }).extend({
    sourceArtifactId: z.string(),
    name: z.string(),
    mimeType: z.string(),
    content: z.string(),
    notes: z.array(z.string()).default([]),
  })).min(1),
  // 构造摘要只是运行元数据，不是成果物本体。兼容部分 OpenAI-compatible 模型
  // 已返回完整 artifacts 却漏掉 summary 的情况，避免为一句说明报废整个 Candidate。
  summary: z.string().default("候选成果已生成，等待本地完整性检查。"),
});
export type BuildCandidateAiResult = z.infer<typeof BuildCandidateAiResultSchema>;

export const ArtifactAcceptanceAiResultSchema = z.object({
  overallScore: z.number(),
  coverageScore: z.number(),
  integrityScore: z.number(),
  pairwiseScore: z.number(),
  hardGatePass: z.boolean(),
  // Gate F must return explicit per-criterion rows. Missing results are an evaluator/schema failure,
  // not evidence that the artifact itself failed; requiring the array lets provider correction and
  // fallback run before the runtime considers any content repair.
  results: z.array(z.object({
    criterionId: z.string(),
    score: z.number(),
    pass: z.boolean(),
    evidence: z.array(z.string()).default([]),
    gaps: z.array(z.string()).default([]),
    note: z.string().default(""),
  })),
  summary: z.string(),
}).superRefine((value, ctx) => {
  const ids = new Set<string>();
  value.results.forEach((item, index) => {
    if (ids.has(item.criterionId)) {
      ctx.addIssue({ code: "custom", path: ["results", index, "criterionId"], message: `Duplicate acceptance Criterion ID: ${item.criterionId}` });
    }
    ids.add(item.criterionId);
  });
});
export type ArtifactAcceptanceAiResult = z.infer<typeof ArtifactAcceptanceAiResultSchema>;

export const RepairArtifactAiResultSchema = z.object({
  artifacts: z.array(z.object({
    sourceArtifactId: z.string(),
    name: z.string(),
    mimeType: z.string(),
    content: z.string(),
    notes: z.array(z.string()).default([]),
  })).min(1),
  repairedCriteria: z.array(z.string()).default([]),
  summary: z.string(),
});
export type RepairArtifactAiResult = z.infer<typeof RepairArtifactAiResultSchema>;

export const ExecuteArtifactAiResultSchema = z.object({
  output: z.string(),
  trace: z.array(z.object({
    id: z.string(),
    stage: z.string(),
    summary: z.string(),
    status: z.enum(["pass", "fail", "warning", "info"]),
    detail: z.string().optional(),
  })).default([]),
});
export type ExecuteArtifactAiResult = z.infer<typeof ExecuteArtifactAiResultSchema>;

export const ExecuteArtifactBatchAiResultSchema = z.object({
  results: z.array(z.object({
    testCaseId: z.string(),
    output: z.string(),
    trace: z.array(z.object({
      id: z.string(),
      stage: z.string(),
      summary: z.string(),
      status: z.enum(["pass", "fail", "warning", "info"]),
      detail: z.string().optional(),
    })).default([]),
  })).min(1),
}).superRefine((value, ctx) => {
  const ids = new Set<string>();
  value.results.forEach((item, index) => {
    if (ids.has(item.testCaseId)) {
      ctx.addIssue({ code: "custom", path: ["results", index, "testCaseId"], message: `Duplicate Artifact Batch Test Case ID: ${item.testCaseId}` });
    }
    ids.add(item.testCaseId);
  });
});
export type ExecuteArtifactBatchAiResult = z.infer<typeof ExecuteArtifactBatchAiResultSchema>;

export const PopulationEvaluationAiResultSchema = z.object({
  candidates: z.array(z.object({
    candidateId: z.string(),
    score: z.number().min(0).max(100),
    hardGatePass: z.boolean(),
    safety: z.enum(["PASS", "REVIEW", "FAIL"]),
    strengths: z.array(z.string()).default([]),
    gaps: z.array(z.string()).default([]),
  })).min(1),
  summary: z.string(),
});
export type PopulationEvaluationAiResult = z.infer<typeof PopulationEvaluationAiResultSchema>;

export const MaterializeAiResultSchema = z.object({
  artifacts: z.array(z.object({
    sourceArtifactId: z.string(),
    name: z.string(),
    mimeType: z.string(),
    content: z.string(),
    notes: z.string().default(""),
  })).min(1),
  summary: z.string(),
});
export type MaterializeAiResult = z.infer<typeof MaterializeAiResultSchema>;

export const ReleaseReviewAiResultSchema = z.object({
  recommendation: z.enum(["release", "hold", "reject"]),
  summary: z.string(),
  reasons: z.array(z.string()),
  risks: z.array(z.string()),
  requiredChecks: z.array(z.string()),
});
export type ReleaseReviewAiResult = z.infer<typeof ReleaseReviewAiResultSchema>;

export const DistillAiResultSchema = z.object({
  title: z.string(),
  summary: z.string(),
  reusable: z.boolean(),
  effect: z.string(),
  limit: z.string(),
  trigger: z.array(z.string()),
  method: z.array(z.string()),
  validatedOn: z.array(z.string()),
  status: z.enum(["lesson", "verified-skill", "anti-pattern"]),
});
export type DistillAiResult = z.infer<typeof DistillAiResultSchema>;

export const NextQueueAiResultSchema = z.object({
  items: z.array(NextQueueItemSchema).min(1).max(6),
  recommendedId: z.string(),
  summary: z.string(),
});
export type NextQueueAiResult = z.infer<typeof NextQueueAiResultSchema>;

export const CopilotAiResultSchema = z.object({
  answer: z.string(),
  suggestedAction: z.enum([
    "none", "confirm-target", "generate-eval-suite", "run-baseline", "analyze-problems",
    "run-diagnosis", "generate-plan", "approve-experiment", "run-experiment", "run-validation",
    "approve-release", "start-shadow", "advance-canary", "distill-learning", "generate-next-queue",
    "run-campaign-round", "run-campaign", "materialize-outputs",
  ]).default("none"),
  suggestedActionLabel: z.string().optional(),
  evidence: z.array(z.string()).default([]),
});
export type CopilotAiResult = z.infer<typeof CopilotAiResultSchema>;

// 分数范围不在这里硬卡：AI 偶尔越界（105 / -2）或返回 0-1 小数，交给 evaluation/service 归一化兜底，
// 避免一次评审因单个数字直接抛错报废整轮评测。
export const EvaluateAiResultSchema = z.object({
  accuracy: z.coerce.number(),
  evidence: z.coerce.number(),
  riskCoverage: z.coerce.number(),
  completeness: z.coerce.number(),
  safety: z.preprocess(value => typeof value === "string" ? value.toUpperCase() : value, z.enum(["PASS", "REVIEW", "FAIL"])),
  notes: z.array(z.string()).default([]),
  failures: z.array(z.string()).default([]),
  // 逐题分数：让「差距来自哪道题、差多少、为什么」可回答。optional 兼容旧模型。
  cases: z.array(z.object({
    testCaseId: z.string(),
    accuracy: z.coerce.number(),
    evidence: z.coerce.number(),
    completeness: z.coerce.number(),
    reason: z.string().default(""),
  })),
  // Project-specific Acceptance Rubric 逐项评分是最终验收的核心输出，不能再设为 optional。
  // 与 jsonSchemas.evaluate 的 required 契约保持一致：漏返时直接触发 schema correction / 备用路由，
  // 而不是先接受不完整响应，再让 UI 永久停在“待补评审”。
  criteria: z.array(z.object({
    criterionId: z.string(),
    score: z.coerce.number(),
    pass: z.boolean(),
    evidence: z.array(z.string()).default([]),
    gaps: z.array(z.string()).default([]),
    testCaseIds: z.array(z.string()).default([]),
  })),
}).superRefine((value, ctx) => {
  // 评阅模型敷衍时常直接交全 0 —— 视为无效评审，让调用方按 fallback 换下一个连接重试。
  if (value.accuracy === 0 && value.evidence === 0 && value.riskCoverage === 0) {
    ctx.addIssue({ code: "custom", message: "Evaluator returned all-zero scores; treating as invalid response" });
  }
  const caseIds = new Set<string>();
  value.cases.forEach((item, index) => {
    if (caseIds.has(item.testCaseId)) {
      ctx.addIssue({ code: "custom", path: ["cases", index, "testCaseId"], message: `Duplicate evaluator Test Case ID: ${item.testCaseId}` });
    }
    caseIds.add(item.testCaseId);
  });
  const criterionIds = new Set<string>();
  value.criteria.forEach((item, index) => {
    if (criterionIds.has(item.criterionId)) {
      ctx.addIssue({ code: "custom", path: ["criteria", index, "criterionId"], message: `Duplicate evaluator Criterion ID: ${item.criterionId}` });
    }
    criterionIds.add(item.criterionId);
  });
});
export type EvaluateAiResult = z.infer<typeof EvaluateAiResultSchema>;

// 薄弱环节聚类：把逐题失分原因按共同病因归堆，直接回答"该对症补哪里"。
export const GapClusterAiResultSchema = z.object({
  clusters: z.array(z.object({
    name: z.string(),
    caseIds: z.array(z.string()).default([]),
    pattern: z.string(),
    advice: z.string(),
  })).default([]),
  overall: z.string().default(""),
});
export type GapClusterAiResult = z.infer<typeof GapClusterAiResultSchema>;

// 验证/盲测执行完后的 AI 优化建议：把分数、检查项与差距归因翻译成可执行的调整方案。
export const GapAdviceAiResultSchema = z.object({
  overall: z.string(),
  actions: z.array(z.object({
    title: z.string(),
    detail: z.string(),
    target: z.string(),
  })).default([]),
});
export type GapAdviceAiResult = z.infer<typeof GapAdviceAiResultSchema>;

export const VisualJudgeAiResultSchema = z.object({
  scores: z.object({
    usability: z.number().min(0).max(100),
    aesthetics: z.number().min(0).max(100),
    responsiveness: z.number().min(0).max(100),
    interaction: z.number().min(0).max(100),
  }),
  summary: z.string(),
  findings: z.array(z.string()).default([]),
});
export type VisualJudgeAiResult = z.infer<typeof VisualJudgeAiResultSchema>;

export const AiRequestSchema = z.object({ operation: AiOperationSchema, payload: z.unknown() });
