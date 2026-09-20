import { z } from "zod";

export const StageSchema = z.enum([
  "target",
  "baseline",
  "problem",
  "diagnosis",
  "plan",
  "experiment",
  "validation",
  "release",
  "learning",
]);
export type Stage = z.infer<typeof StageSchema>;

export const ArtifactRoleSchema = z.enum(["target", "reference", "eval"]);
export type ArtifactRole = z.infer<typeof ArtifactRoleSchema>;

export const ArtifactKindSchema = z.enum(["prompt", "workflow", "document", "presentation", "spreadsheet", "codebase", "knowledge", "image", "media", "generic"]);
export type ArtifactKind = z.infer<typeof ArtifactKindSchema>;


export const ArtifactDescriptorSchema = z.object({
  family: z.enum(["text", "workflow", "presentation", "spreadsheet", "codebase", "knowledge", "image", "media", "fixed-layout", "package", "generic"]),
  subtype: z.string(),
  adapterId: z.string(),
  confidence: z.number().min(0).max(1).default(0.5),
  preservationMode: z.enum(["same-package", "same-format-rebuild", "same-text-format", "external-required"]).default("same-text-format"),
  fidelity: z.enum(["full", "high", "medium", "limited"]).default("medium"),
  formatExtension: z.string().default(""),
  editable: z.boolean().default(true),
  capabilities: z.object({
    parse: z.boolean().default(true),
    mutate: z.boolean().default(true),
    materialize: z.boolean().default(true),
    validateStructure: z.boolean().default(true),
    execute: z.boolean().default(false),
    visual: z.boolean().default(false),
  }).default({ parse: true, mutate: true, materialize: true, validateStructure: true, execute: false, visual: false }),
  evolutionDimensions: z.array(z.string()).default([]),
  requiredValidations: z.array(z.string()).default([]),
  limitations: z.array(z.string()).default([]),
});
export type ArtifactDescriptor = z.infer<typeof ArtifactDescriptorSchema>;


export const ContainerProfileSchema = z.object({
  containerType: z.enum(["zip","folder","pptx","xlsx","docx","pdf","text","image","audio","video","code-file","structured-data","binary","unknown"]),
  format: z.string().default(""),
  extension: z.string().default(""),
  canUnpack: z.boolean().default(false),
  editable: z.boolean().default(true),
  preservationMode: z.enum(["same-package","same-format-rebuild","same-text-format","external-required","unknown"]).default("unknown"),
});
export type ContainerProfile = z.infer<typeof ContainerProfileSchema>;

export const ArtifactGraphNodeSchema = z.object({
  id: z.string(),
  sourceArtifactId: z.string(),
  parentId: z.string().optional(),
  path: z.string().optional(),
  name: z.string(),
  containerType: z.string(),
  artifactFamily: z.string(),
  semanticRole: z.string().default("component"),
  extension: z.string().default(""),
  editable: z.boolean().default(true),
  summary: z.string().optional(),
});
export type ArtifactGraphNode = z.infer<typeof ArtifactGraphNodeSchema>;

export const ArtifactGraphEdgeSchema = z.object({
  from: z.string(),
  to: z.string(),
  relation: z.enum(["contains","references","depends-on","must-match","explains","derived-from","supports","other"]).default("other"),
  description: z.string().default(""),
});
export type ArtifactGraphEdge = z.infer<typeof ArtifactGraphEdgeSchema>;

export const ArtifactGraphSchema = z.object({
  nodes: z.array(ArtifactGraphNodeSchema).default([]),
  edges: z.array(ArtifactGraphEdgeSchema).default([]),
  summary: z.string().default(""),
  generatedAt: z.string(),
});
export type ArtifactGraph = z.infer<typeof ArtifactGraphSchema>;

export const SemanticObjectSchema = z.object({
  typeId: z.string(),
  label: z.string(),
  domain: z.string().default("通用"),
  description: z.string(),
  confidence: z.number().min(0).max(1).default(0.5),
  audience: z.array(z.string()).default([]),
  primaryOutcome: z.string(),
  componentArtifactIds: z.array(z.string()).default([]),
  crossArtifactRequirements: z.array(z.string()).default([]),
  reasoning: z.array(z.string()).default([]),
});
export type SemanticObject = z.infer<typeof SemanticObjectSchema>;

export const EvolutionIntentModelSchema = z.object({
  summary: z.string(),
  desiredChanges: z.array(z.string()).default([]),
  mustPreserve: z.array(z.string()).default([]),
  outputRequirements: z.array(z.string()).default([]),
  qualityPriorities: z.array(z.string()).default([]),
});
export type EvolutionIntentModel = z.infer<typeof EvolutionIntentModelSchema>;

export const SemanticWorkflowStageSchema = z.object({
  id: z.enum(["define","baseline","diagnose","evolve","verify","deliver"]),
  label: z.string(),
  flow: z.string(),
  input: z.string(),
  action: z.string(),
  output: z.string(),
  done: z.string(),
  applicableArtifactIds: z.array(z.string()).default([]),
});
export type SemanticWorkflowStage = z.infer<typeof SemanticWorkflowStageSchema>;

export const SemanticEvolutionSchema = z.object({
  semanticObject: SemanticObjectSchema,
  intent: EvolutionIntentModelSchema,
  workflowLabel: z.string(),
  workflowSummary: z.string(),
  workflowStages: z.array(SemanticWorkflowStageSchema).length(6),
  acceptanceRubric: z.array(z.lazy(() => AcceptanceCriterionSchema)).default([]),
  needsReview: z.boolean().default(false),
  warnings: z.array(z.string()).default([]),
  version: z.number().int().min(1).default(1),
  generatedAt: z.string(),
});
export type SemanticEvolution = z.infer<typeof SemanticEvolutionSchema>;


export const ParsingProfileSchema = z.object({
  engine: z.enum(["browser-local", "docling", "unstructured", "tika", "code-ast", "hybrid"]).default("browser-local"),
  engineLabel: z.string().default("浏览器本地解析"),
  confidence: z.number().min(0).max(1).default(0.5),
  completeness: z.number().min(0).max(1).default(0),
  structuralCoverage: z.number().min(0).max(1).default(0),
  totalEntries: z.number().int().min(0).default(0),
  indexedEntries: z.number().int().min(0).default(0),
  parsedEntries: z.number().int().min(0).default(0),
  codeFiles: z.number().int().min(0).default(0),
  documentFiles: z.number().int().min(0).default(0),
  officeFiles: z.number().int().min(0).default(0),
  imageFiles: z.number().int().min(0).default(0),
  /** Entries that can be meaningfully parsed/indexed (text/code/embedded docs), excluding binary assets. */
  eligibleEntries: z.number().int().min(0).default(0),
  /** Entries with retrievable deep content in the local structured index. */
  deepIndexedEntries: z.number().int().min(0).default(0),
  deepIndexCoverage: z.number().min(0).max(1).default(0),
  criticalEntries: z.number().int().min(0).default(0),
  inspectedCriticalEntries: z.number().int().min(0).default(0),
  criticalModuleCoverage: z.number().min(0).max(1).default(0),
  indexedSymbols: z.number().int().min(0).default(0),
  internalImports: z.number().int().min(0).default(0),
  resolvedInternalImports: z.number().int().min(0).default(0),
  dependencyCoverage: z.number().min(0).max(1).default(0),
  /** Short initial digest size. This is not parsing coverage; full deep index remains retrievable. */
  contextWindowChars: z.number().int().min(0).default(0),
  executableEvidence: z.boolean().default(false),
  visualEvidence: z.boolean().default(false),
  limitations: z.array(z.string()).default([]),
  recommendations: z.array(z.string()).default([]),
  generatedAt: z.string(),
});
export type ParsingProfile = z.infer<typeof ParsingProfileSchema>;

export const SourceArtifactSchema = z.object({
  id: z.string(),
  name: z.string(),
  role: ArtifactRoleSchema.default("target"),
  artifactKind: ArtifactKindSchema.default("generic"),
  artifactDescriptor: ArtifactDescriptorSchema.optional(),
  mimeType: z.string().default("application/octet-stream"),
  size: z.number().nonnegative().default(0),
  extension: z.string().default(""),
  inputMode: z.enum(["upload", "paste", "remote"]).default("upload"),
  parseStatus: z.enum(["ready", "ai-file", "image", "binary", "unsupported", "error"]).default("ready"),
  textContent: z.string().optional(),
  textExcerpt: z.string().optional(),
  summary: z.string().optional(),
  openaiFileId: z.string().optional(),
  storageRef: z.string().optional(),
  structure: z.array(z.string()).default([]),
  structuredContent: z.unknown().optional(),
  parsingProfile: ParsingProfileSchema.optional(),
  warnings: z.array(z.string()).default([]),
  createdAt: z.string(),
});
export type SourceArtifact = z.infer<typeof SourceArtifactSchema>;

export const SourceUnderstandingSchema = z.object({
  currentStateSummary: z.string(),
  evolutionIntent: z.string(),
  detectedObjectType: z.enum(["agent", "system", "prompt", "workflow", "knowledge", "tool", "template", "document", "presentation", "spreadsheet", "codebase"]),
  artifactSummaries: z.array(z.object({
    artifactId: z.string(),
    summary: z.string(),
    detectedRole: ArtifactRoleSchema.optional(),
  })).default([]),
  acceptanceCriteria: z.array(z.string()).default([]),
  followUpQuestions: z.array(z.string()).default([]),
});
export type SourceUnderstanding = z.infer<typeof SourceUnderstandingSchema>;

// 深度输入理解（后台异步产出）：intake 之后复述意图 / 隐含要求 / 默认假设 / 待确认歧义。
// status 记录这次后台理解的生命周期，failed 时允许用户一键重跑。
export const InputUnderstandingSchema = z.object({
  status: z.enum(["running", "ready", "failed"]).default("running"),
  error: z.string().optional(),
  updatedAt: z.string().optional(),
  intentRestatement: z.string().default(""),
  implicitRequirements: z.array(z.string()).default([]),
  assumptions: z.array(z.string()).default([]),
  clarifications: z.array(z.object({
    question: z.string(),
    whyItMatters: z.string(),
    defaultAnswer: z.string(),
  })).default([]),
  acceptanceFocus: z.array(z.string()).default([]),
  confidence: z.number().min(0).max(1).default(0.7),
});
export type InputUnderstanding = z.infer<typeof InputUnderstandingSchema>;

// 用户对「待确认歧义」的回答（或自动驾驶采用的默认假设）；会注入后续所有 AI 上下文。
export const InputClarificationSchema = z.object({
  question: z.string(),
  answer: z.string(),
  answeredBy: z.enum(["user", "ai-assumption"]),
  at: z.string(),
});
export type InputClarification = z.infer<typeof InputClarificationSchema>;

export const CommandMessageSchema = z.object({
  id: z.string(),
  role: z.enum(["user", "assistant", "system"]),
  content: z.string(),
  artifactIds: z.array(z.string()).default([]),
  createdAt: z.string(),
});
export type CommandMessage = z.infer<typeof CommandMessageSchema>;

export const GateIdSchema = z.enum(["target-ready", "experiment-ready", "artifact-ready", "release-ready"]);
export type GateId = z.infer<typeof GateIdSchema>;

export const GateStateSchema = z.object({
  id: GateIdSchema,
  status: z.enum(["pending", "ready", "approved", "blocked"]),
  approvedAt: z.string().optional(),
  note: z.string().optional(),
});

export const MetricSchema = z.object({
  key: z.string(),
  label: z.string(),
  value: z.number(),
  unit: z.string().default("%"),
  target: z.number().optional(),
  trend: z.number().optional(),
  direction: z.enum(["higher", "lower"]).default("higher"),
  description: z.string().optional(),
});
export type Metric = z.infer<typeof MetricSchema>;

export const AcceptanceCriterionSchema = z.object({
  id: z.string(),
  title: z.string(),
  requirement: z.string(),
  source: z.enum(["user-command", "source-understanding", "protected-item", "metric", "system-integrity"]).default("user-command"),
  weight: z.number().min(0).max(100).default(10),
  hardGate: z.boolean().default(false),
  judgeType: z.enum(["llm", "structural", "integrity", "pairwise"]).default("llm"),
  validationMethod: z.enum(["user-scenario", "static-structure", "executable-test", "visual-review", "format-roundtrip", "cross-artifact", "semantic-judge", "manual-review"]).default("semantic-judge"),
  minScore: z.number().min(0).max(100).default(80),
  evidenceExpected: z.array(z.string()).default([]),
  protectedConstraint: z.boolean().default(false),
  artifactIds: z.array(z.string()).default([]),
  category: z.enum(["outcome", "behavior", "integrity", "protected", "artifact-specific", "ux", "performance"]).default("outcome"),
});
export type AcceptanceCriterion = z.infer<typeof AcceptanceCriterionSchema>;

export const AcceptanceRubricStateSchema = z.object({
  status: z.enum(["idle", "draft", "ready", "invalid"]).default("idle"),
  summary: z.string().default(""),
  version: z.number().int().min(0).default(0),
  compiledAt: z.string().optional(),
  confirmedAt: z.string().optional(),
  weightTotal: z.number().default(0),
  uncoveredCriterionIds: z.array(z.string()).default([]),
  warnings: z.array(z.string()).default([]),
});
export type AcceptanceRubricState = z.infer<typeof AcceptanceRubricStateSchema>;

export const AcceptanceCriterionResultSchema = z.object({
  criterionId: z.string(),
  score: z.number().min(0).max(100),
  pass: z.boolean(),
  evidence: z.array(z.string()).default([]),
  gaps: z.array(z.string()).default([]),
  note: z.string().default(""),
});

export const FrozenArtifactSchema = z.object({
  sourceArtifactId: z.string(), snapshotHash: z.string(), blobId: z.string(),
  name: z.string(), mimeType: z.string(), sha256: z.string(), size: z.number(),
  verifiedAt: z.string(), checks: z.array(z.string()), limitations: z.array(z.string()),
});
export type FrozenArtifact = z.infer<typeof FrozenArtifactSchema>;

export const EvidenceRefSchema = z.object({
  id: z.string(),
  claim: z.string(),
  kind: z.enum(["source", "test", "trace", "structure", "unresolved"]),
  verified: z.boolean().default(false),
  artifactId: z.string().optional(),
  path: z.string().optional(),
  testCaseId: z.string().optional(),
  traceId: z.string().optional(),
  excerpt: z.string().optional(),
  contentHash: z.string().optional(),
});
export type EvidenceRef = z.infer<typeof EvidenceRefSchema>;

export const ArtifactAcceptanceSchema = z.object({
  evidenceFingerprint: z.string().optional(),
  // id 只作标识、无业务逻辑依赖；带默认值让 .prefault({}) 在 zod 4 输入类型下成立（见下方 campaign 注释）。
  id: z.string().default("artifact-acceptance"),
  status: z.enum(["idle", "running", "passed", "failed", "repairing", "unverified"]).default("idle"),
  frozenArtifacts: z.array(FrozenArtifactSchema).optional(),
  candidateId: z.string().optional(),
  versionLabel: z.string().optional(),
  overallScore: z.number().min(0).max(100).default(0),
  coverageScore: z.number().min(0).max(100).default(0),
  integrityScore: z.number().min(0).max(100).default(0),
  pairwiseScore: z.number().min(0).max(100).default(0),
  hardGatePass: z.boolean().default(false),
  results: z.array(AcceptanceCriterionResultSchema).default([]),
  attempts: z.number().int().min(0).default(0),
  maxRepairAttempts: z.number().int().min(0).max(5).default(3),
  summary: z.string().default(""),
  error: z.string().optional(),
  acceptedAt: z.string().optional(),
  lastCheckedAt: z.string().optional(),
});
export type ArtifactAcceptance = z.infer<typeof ArtifactAcceptanceSchema>;

/** 用户/人工补充的验收证据。必须绑定当前 Candidate + Artifact/Rubric 指纹；换版本后不会自动继承。 */
export const SupplementalValidationEvidenceSchema = z.object({
  id: z.string(),
  criterionId: z.string(),
  candidateId: z.string(),
  evidenceFingerprint: z.string(),
  method: z.enum(["visual-review", "manual-review"]),
  verdict: z.enum(["pass", "fail"]),
  note: z.string().min(1),
  screenshotIds: z.array(z.string()).default([]),
  artifactHashes: z.array(z.string()).default([]),
  createdAt: z.string(),
});
export type SupplementalValidationEvidence = z.infer<typeof SupplementalValidationEvidenceSchema>;

export const TraceEvidenceSchema = z.object({
  id: z.string(),
  stage: z.string(),
  summary: z.string(),
  status: z.enum(["pass", "fail", "warning", "info"]),
  detail: z.string().optional(),
});

export const ProblemSchema = z.object({
  id: z.string(),
  title: z.string(),
  impact: z.number(),
  severity: z.enum(["high", "medium", "low"]),
  status: z.enum(["recommended", "observing", "planned", "selected", "resolved"]),
  summary: z.string(),
  rootCause: z.string().optional(),
  evidence: z.array(z.string()).default([]),
  evidenceRefs: z.array(EvidenceRefSchema).default([]),
  confidence: z.number().min(0).max(1).optional(),
  affectedComponent: z.string().optional(),
});
export type Problem = z.infer<typeof ProblemSchema>;

export const DiagnosisSchema = z.object({
  problemId: z.string(),
  rootCause: z.string(),
  summary: z.string(),
  affectedComponent: z.string(),
  confidence: z.number().min(0).max(1),
  evidence: z.array(z.string()),
  evidenceRefs: z.array(EvidenceRefSchema).default([]),
  counterEvidence: z.array(z.string()).default([]),
  falsifier: z.string(),
  suggestedScopes: z.array(z.enum(["prompt", "workflow", "tool", "memory", "code", "model"])),
  trace: z.array(TraceEvidenceSchema).default([]),
});
export type Diagnosis = z.infer<typeof DiagnosisSchema>;

export const CandidatePatchSchema = z.object({
  id: z.string(),
  component: z.enum(["prompt", "workflow", "tool", "memory", "code", "model"]),
  operation: z.enum(["add", "update", "remove"]),
  target: z.string(),
  artifactId: z.string().optional(),
  content: z.string(),
  rationale: z.string(),
});
export type CandidatePatch = z.infer<typeof CandidatePatchSchema>;

// 设计论证链：强制每个候选回答「源成果里哪有证据、对应指令哪一句、机制如何生效、
// 动哪些验收标准、保护项怎么守住、怎样算被证伪」。缺任何一环，方案就只是口号。
export const CandidateDesignRationaleSchema = z.object({
  /** 源成果物原文逐字引用 / 精确文件路径 / 节点路径，证明该候选要修的缺陷真实存在于当前成果物。 */
  sourceEvidence: z.array(z.string()).default([]),
  /** 与用户进化指令 / 验收观察点的逐句对应：本候选落实指令的哪一句。 */
  commandAlignment: z.string().default(""),
  /** 因果机制：patch 如何改变成果物行为 → 可观察的行为变化 → 哪个指标/验收标准随之移动。 */
  mechanism: z.string().default(""),
  /** 本候选推动的验收标准标题（acceptanceRubric / acceptanceFocus）。 */
  coveredCriteria: z.array(z.string()).default([]),
  /** 可能触碰哪些保护项、以及具体如何保持不被破坏。 */
  protectedCompliance: z.string().default(""),
  /** 证伪条件：实验/盲测中出现什么可观察证据即说明该候选假设不成立。 */
  falsifier: z.string().default(""),
});
export type CandidateDesignRationale = z.infer<typeof CandidateDesignRationaleSchema>;

export const CandidateArtifactSnapshotSchema = z.object({
  frozenArtifact: FrozenArtifactSchema.optional(),
  id: z.string(),
  sourceArtifactId: z.string(),
  name: z.string(),
  mimeType: z.string(),
  content: z.string(),
  contentHash: z.string().optional(),
  buildMode: z.enum(["ai-full", "deterministic", "external-target"]).default("ai-full"),
  notes: z.array(z.string()).default([]),
  createdAt: z.string(),
});
export type CandidateArtifactSnapshot = z.infer<typeof CandidateArtifactSnapshotSchema>;

export const CandidateSchema = z.object({
  id: z.string(),
  name: z.string(),
  title: z.string().optional(),
  change: z.string(),
  hypothesis: z.string().optional(),
  patches: z.array(CandidatePatchSchema).default([]),
  riskLevel: z.enum(["low", "medium", "high"]).default("medium"),
  expectedImpact: z.string().optional(),
  risks: z.array(z.string()).default([]),
  accuracy: z.number().default(0),
  evidence: z.number().default(0),
  riskCoverage: z.number().default(0),
  costDelta: z.number().default(0),
  speedDelta: z.number().default(0),
  safety: z.enum(["PASS", "REVIEW", "FAIL"]).default("REVIEW"),
  recommended: z.boolean().default(false),
  status: z.enum(["draft", "queued", "running", "passed", "failed", "winner"]).default("draft"),
  notes: z.array(z.string()).default([]),
  artifactSnapshots: z.array(CandidateArtifactSnapshotSchema).default([]),
  artifactBuildStatus: z.enum(["idle", "building", "ready", "failed"]).default("idle"),
  artifactBuildSummary: z.string().optional(),
  /** 该候选针对的盲测后 AI 优化建议动作（标题），让"建议 → 方案"的关联可见可追溯。 */
  addressesAdvice: z.array(z.string()).default([]),
  /** 设计论证链（plan 生成的 JSON Schema 中为必填；旧项目数据缺失时保持可解析）。 */
  designRationale: CandidateDesignRationaleSchema.optional(),
});
export type Candidate = z.infer<typeof CandidateSchema>;

export const BrowserStepSchema = z.object({action:z.enum(["click","fill","visible","text","count"]),selector:z.string().min(1),value:z.string().optional(),count:z.number().int().nonnegative().optional()});
export const TestCaseSchema = z.object({
  browserSteps:z.array(BrowserStepSchema).max(24).optional(),
  id: z.string(),
  title: z.string(),
  input: z.string(),
  expected: z.array(z.string()),
  tags: z.array(z.string()).default([]),
  hidden: z.boolean().default(false),
  /** Project-specific Acceptance Rubric criteria covered by this test. */
  criterionIds: z.array(z.string()).default([]),
  executionMode: z.enum(["artifact-runtime", "static-evidence", "external-runner", "roundtrip", "visual-review", "manual"]).default("artifact-runtime"),
  evidenceScope: z.enum(["product-behavior", "implementation", "format", "parser", "cross-artifact"]).default("product-behavior"),
});
export type TestCase = z.infer<typeof TestCaseSchema>;

export const TargetRunResultSchema = z.object({
  artifactHash:z.string().optional(),
  screenshots:z.array(z.object({name:z.string(),width:z.number(),height:z.number(),dataUrl:z.string(),artifactHash:z.string()})).optional(),
  testCaseId: z.string(),
  output: z.string(),
  latencyMs: z.number(),
  cost: z.number(),
  trace: z.array(TraceEvidenceSchema).default([]),
  error: z.string().optional(),
  verificationStatus: z.enum(["verified", "partial", "unverified", "failed"]).default("verified"),
});
export type TargetRunResult = z.infer<typeof TargetRunResultSchema>;

/** 逐题评分：总分差要能拆回「哪道题、差多少、为什么」，供差距归因使用。 */
export const CaseScoreSchema = z.object({
  testCaseId: z.string(),
  accuracy: z.number().min(0).max(100),
  evidence: z.number().min(0).max(100),
  completeness: z.number().min(0).max(100),
  reason: z.string().default(""),
});
export type CaseScore = z.infer<typeof CaseScoreSchema>;

export const CriterionScoreSchema = z.object({
  criterionId: z.string(),
  score: z.number().min(0).max(100),
  pass: z.boolean(),
  verificationStatus: z.enum(["verified", "partial", "unverified"]).default("verified"),
  evidence: z.array(z.string()).default([]),
  gaps: z.array(z.string()).default([]),
  testCaseIds: z.array(z.string()).default([]),
});
export type CriterionScore = z.infer<typeof CriterionScoreSchema>;

export const EvaluationResultSchema = z.object({
  accuracy: z.number().min(0).max(100),
  evidence: z.number().min(0).max(100),
  riskCoverage: z.number().min(0).max(100),
  safety: z.enum(["PASS", "REVIEW", "FAIL"]),
  completeness: z.number().min(0).max(100),
  averageCost: z.number(),
  averageLatencyMs: z.number(),
  notes: z.array(z.string()).default([]),
  failures: z.array(z.string()).default([]),
  /** Project-specific Acceptance Rubric weighted score. Generic dimensions are secondary diagnostics. */
  rubricScore: z.number().min(0).max(100).optional(),
  verifiedRubricCoverage: z.number().min(0).max(100).optional(),
  unverifiedCriterionIds: z.array(z.string()).optional(),
  criterionScores: z.array(CriterionScoreSchema).optional(),
  // 旧存档没有逐题分数，保持 optional；归因视图会降级为「仅按执行失败定位」。
  caseScores: z.array(CaseScoreSchema).optional(),
  /** 评审由演示启发式兜底（真实 Judge 连接全失败）：分数只作参考，禁止据此夺冠。 */
  demoJudged: z.boolean().optional(),
});
export type EvaluationResult = z.infer<typeof EvaluationResultSchema>;

export const BaselineRunSchema = z.object({
  measurementFingerprint: z.string().optional(),
  id: z.string(),
  status: z.enum(["idle", "running", "completed", "failed"]),
  startedAt: z.string().optional(),
  completedAt: z.string().optional(),
  suiteName: z.string(),
  totalCases: z.number(),
  result: EvaluationResultSchema.optional(),
  runs: z.array(TargetRunResultSchema).default([]),
});
export type BaselineRun = z.infer<typeof BaselineRunSchema>;

export const ExperimentRunSchema = z.object({
  comparisonSuite: z.array(TestCaseSchema).optional(),
  comparisonBaseline: BaselineRunSchema.optional(),
  id: z.string(),
  status: z.enum(["idle", "running", "completed", "failed"]),
  startedAt: z.string().optional(),
  completedAt: z.string().optional(),
  buildFailures: z.array(z.object({ candidateId: z.string(), message: z.string() })).optional(),
  candidateResults: z.array(z.object({
    candidateId: z.string(),
    evaluation: EvaluationResultSchema,
    runs: z.array(TargetRunResultSchema).default([]),
    artifactSnapshots: z.array(CandidateArtifactSnapshotSchema).default([]),
    artifactBuildSummary: z.string().optional(),
    experimentStage: z.enum(["screened", "finalist"]).default("finalist"),
    screeningScore: z.number().optional(),
    screeningSummary: z.string().optional(),
    /** 与同卷基线按相同 Rubric 口径得出的晋级结论；用于解释为何成为/未成为 Winner。 */
    winnerDecision: z.object({
      eligible: z.boolean(),
      summary: z.string(),
      candidateQuality: z.number().optional(),
      baselineQuality: z.number().optional(),
      globalDelta: z.number().optional(),
      targetDelta: z.number().optional(),
      comparedCriterionIds: z.array(z.string()).default([]),
      targetCriterionIds: z.array(z.string()).default([]),
      blockers: z.array(z.string()).default([]),
      signals: z.array(z.string()).default([]),
    }).optional(),
  })).default([]),
  winnerId: z.string().optional(),
  /** 没有已证实产品失败、仅缺真实证据时保留的最佳候选；继续进入统一最终验收，而不是重新生成内容。 */
  pendingEvidenceCandidateId: z.string().optional(),
  summary: z.string().optional(),
  /** 没有 Winner 时自动生成的下一轮优化建议，直接驱动重新规划。 */
  aiAdvice: z.object({
    overall: z.string(),
    actions: z.array(z.object({
      title: z.string(),
      detail: z.string(),
      target: z.string(),
    })).default([]),
  }).optional(),
  /** 补考前各候选分数快照（首次补考时留存）：供实验页展示「旧 → 新」对比。 */
  previousScores: z.array(z.object({
    candidateId: z.string(),
    accuracy: z.number(),
    evidence: z.number(),
    riskCoverage: z.number(),
    averageCost: z.number(),
  })).optional(),
});
export type ExperimentRun = z.infer<typeof ExperimentRunSchema>;

/** 建议效果结算：上一轮 AI 优化建议在新一轮盲测后的执行与见效情况，让"建议 → 执行 → 效果"闭环可见。 */
export const AdviceSettlementSchema = z.object({
  settledAt: z.string(),
  adviceOverall: z.string(),
  before: z.object({ accuracy: z.number(), completeness: z.number() }),
  after: z.object({ accuracy: z.number(), completeness: z.number() }),
  actions: z.array(z.object({
    title: z.string(),
    target: z.string(),
    executed: z.boolean(),
    improved: z.boolean(),
    note: z.string(),
  })),
});
export type AdviceSettlement = z.infer<typeof AdviceSettlementSchema>;

/** 进化版本快照：每轮验证后把"进化后的成果物全文"冻结成版本，供查看、下载与回滚。 */
export const EvolvedVersionSchema = z.object({
  id: z.string(),
  label: z.string(),
  createdAt: z.string(),
  source: z.enum(["validation", "promote", "rollback-snapshot", "manual"]),
  candidateTitle: z.string().optional(),
  recommendation: z.string().optional(),
  scores: z.object({ accuracy: z.number(), completeness: z.number() }).optional(),
  summary: z.string(),
  /** 该版本被 promote 到 Production 的时间：发布成功自动盖章，供版本列表展示"已发布"标签。 */
  releasedAt: z.string().optional(),
  artifacts: z.array(z.object({
    frozenArtifact: FrozenArtifactSchema.optional(),
    id: z.string(),
    name: z.string(),
    content: z.string(),
    sourceArtifactId: z.string(),
  })).default([]),
});
export type EvolvedVersion = z.infer<typeof EvolvedVersionSchema>;

export const ValidationRunSchema = z.object({
  evidenceFingerprint: z.string().optional(),
  id: z.string(),
  status: z.enum(["idle", "running", "completed", "failed"]),
  /** Distinguish an early diagnostic result from an authoritative full holdout pass. */
  validationMode: z.enum(["fast-gate", "full"]).optional(),
  plannedCases: z.number().int().nonnegative().optional(),
  executedCases: z.number().int().nonnegative().optional(),
  candidateId: z.string().optional(),
  evaluation: EvaluationResultSchema.optional(),
  runs: z.array(TargetRunResultSchema).default([]),
  baselineRuns: z.array(TargetRunResultSchema).default([]),
  checks: z.array(z.object({
    label: z.string(),
    status: z.enum(["pass", "fail", "warning"]),
    detail: z.string(),
  })).default([]),
  recommendation: z.enum(["release", "hold", "reject"]).optional(),
  summary: z.string().optional(),
  /** 失败时记录原因：验证页显示具体错误而不是误导性的「尚未运行」。 */
  error: z.string().optional(),
  /** 当前版本同卷作答与评审快照：失败重跑时复用，省掉半程开销；对应题集 ID 用于失效判断。 */
  baselineEvaluation: EvaluationResultSchema.optional(),
  baselineSuiteIds: z.array(z.string()).optional(),
  baselineContextFingerprint:z.string().optional(),
  baselineObservedAt:z.number().optional(),
  /** 补考前一轮的评审结果：用于「旧 → 新」分数对比，直观看到补考带来的变化。 */
  previousEvaluation: EvaluationResultSchema.optional(),
  /** 执行完自动生成的 AI 优化建议：把分数与差距翻译成"该调什么、怎么调"，不给用户留下没有方向的空白。 */
  aiAdvice: z.object({
    overall: z.string(),
    actions: z.array(z.object({
      title: z.string(),
      detail: z.string(),
      target: z.string(),
    })).default([]),
  }).optional(),
  /** 本轮验证对上一轮 AI 建议的效果结算：执行了没、见效了没，随验证一起进入项目账本。 */
  settledAdvice: AdviceSettlementSchema.optional(),
  /** 本轮验证冻结的进化成果快照：验证完成后写入项目版本历史。 */
  versionSnapshot: EvolvedVersionSchema.optional(),
});
export type ValidationRun = z.infer<typeof ValidationRunSchema>;

export const ReleaseAdapterResultSchema = z.object({
  ok: z.boolean(),
  trafficPercent: z.number().min(0).max(100),
  note: z.string(),
  healthy: z.boolean().default(true),
  kpis: z.array(MetricSchema).default([]),
  // A release endpoint must opt in to production evidence explicitly. Older/mock responses
  // remain simulation so the UI can never infer "live" merely from a successful HTTP status.
  evidenceMode: z.enum(["live", "simulation"]).default("simulation"),
  effectiveAction: z.enum(["shadow", "canary-5", "canary-20", "canary-50", "promote", "rollback"]).optional(),
  observationStatus: z.enum(["observing", "healthy", "unhealthy"]).optional(),
  stableDeploymentId: z.string().optional(),
  deploymentId: z.string().optional(),
  artifactHash: z.string().optional(),
  artifactHashes: z.array(z.object({ sourceArtifactId: z.string(), contentHash: z.string() })).optional(),
  environment: z.string().optional(),
  observedAt: z.string().optional(),
  sampleSize: z.number().int().min(0).optional(),
  windowMinutes: z.number().min(0).optional(),
});
export type ReleaseAdapterResult = z.infer<typeof ReleaseAdapterResultSchema>;

export const ReleaseStateSchema = z.object({
  status: z.enum(["idle", "shadow", "canary-5", "canary-20", "canary-50", "promoted", "rolled-back"]),
  candidateId: z.string().optional(),
  trafficPercent: z.number().min(0).max(100).default(0),
  healthy: z.boolean().optional(),
  kpis: z.array(MetricSchema).default([]),
  evidenceMode: z.enum(["none", "live", "simulation"]).default("none"),
  observationStatus: z.enum(["observing", "healthy", "unhealthy"]).optional(),
  stableDeploymentId: z.string().optional(),
  deploymentId: z.string().optional(),
  artifactHash: z.string().optional(),
  artifactHashes: z.array(z.object({ sourceArtifactId: z.string(), contentHash: z.string() })).optional(),
  environment: z.string().optional(),
  observedAt: z.string().optional(),
  sampleSize: z.number().int().min(0).optional(),
  windowMinutes: z.number().min(0).optional(),
  history: z.array(z.object({ at: z.string(), action: z.string(), note: z.string() })).default([]),
});
export type ReleaseState = z.infer<typeof ReleaseStateSchema>;

export const LessonSchema = z.object({
  id: z.string(),
  title: z.string(),
  summary: z.string(),
  reusable: z.boolean(),
  effect: z.string(),
  limit: z.string(),
  trigger: z.array(z.string()).default([]),
  method: z.array(z.string()).default([]),
  validatedOn: z.array(z.string()).default([]),
  status: z.enum(["lesson", "verified-skill", "anti-pattern"]).default("lesson"),
});
export type Lesson = z.infer<typeof LessonSchema>;

export const NextQueueItemSchema = z.object({
  id: z.string(),
  title: z.string(),
  reason: z.string(),
  priority: z.enum(["P0", "P1", "P2"]),
  source: z.string(),
  suggestedMetrics: z.array(z.string()).default([]),
});
export type NextQueueItem = z.infer<typeof NextQueueItemSchema>;

export const TargetConnectionSchema = z.object({
  adapter: z.enum(["mock", "artifact", "http"]).default("mock"),
  connectionId: z.string().default("demo-agent"),
  status: z.enum(["connected", "not-configured", "error"]).default("connected"),
  label: z.string().default("Demo Target Adapter"),
});



export const CampaignScheduleSchema = z.object({
  mode: z.enum(["manual", "once", "interval", "daily", "weekly"]).default("manual"),
  enabled: z.boolean().default(false),
  startAt: z.string().optional(),
  intervalMinutes: z.number().int().min(15).max(10080).default(60),
  daysOfWeek: z.array(z.number().int().min(0).max(6)).default([]),
  hour: z.number().int().min(0).max(23).default(9),
  minute: z.number().int().min(0).max(59).default(0),
  timezone: z.string().default("local"),
  nextRunAt: z.string().optional(),
  lastRunAt: z.string().optional(),
});
export type CampaignSchedule = z.infer<typeof CampaignScheduleSchema>;

export const CampaignStopCriteriaSchema = z.object({
  maxRounds: z.number().int().min(1).max(100).default(5),
  patienceRounds: z.number().int().min(1).max(20).default(2),
  minImprovement: z.number().min(0).max(100).default(0.5),
  targetScore: z.number().min(0).max(100).optional(),
  maxEstimatedCost: z.number().min(0).optional(),
  maxWallMinutes: z.number().int().min(1).optional(),
  stopOnSafetyFailure: z.boolean().default(true),
  stopWhenMetricTargetsMet: z.boolean().default(true),
  /** 自主进化默认以“完整验收通过”为成功终点；达到后立即停止，不继续为了刷分浪费轮次。 */
  stopWhenAcceptanceMet: z.boolean().default(true),
});

export const CampaignCheckpointPhaseSchema = z.enum(["baseline", "problem", "diagnose", "plan", "experiment", "validation"]);
export type CampaignCheckpointPhase = z.infer<typeof CampaignCheckpointPhaseSchema>;

// 轮内断点：记录「这一轮已经跑完到哪个阶段」，恢复时跳过已完成阶段，从下一步接着跑。
// 没有它，暂停后再继续只能整轮重来——前面昂贵的 Baseline / 诊断 / 候选生成全部白跑一遍。
export const CampaignCheckpointSchema = z.object({
  round: z.number().int().min(0),
  /** 已完成到的阶段；恢复时从它的下一阶段继续。 */
  completedPhase: CampaignCheckpointPhaseSchema,
  at: z.string(),
});
export type CampaignCheckpoint = z.infer<typeof CampaignCheckpointSchema>;

export const EvolutionCampaignSchema = z.object({
  status: z.enum(["idle", "scheduled", "running", "paused", "completed", "stopped"]).default("idle"),
  executionMode: z.enum(["manual", "auto-rounds"]).default("auto-rounds"),
  currentRound: z.number().int().min(0).default(0),
  searchMode: z.enum(["focused", "explore"]).optional(),
  candidateCount: z.number().int().min(1).max(8).default(3),
  parentStrategy: z.enum(["champion-only", "champion-elites", "quality-diversity", "open-ended"]).default("champion-elites"),
  exploreRatio: z.number().min(0).max(1).default(0.35),
  eliteCount: z.number().int().min(1).max(8).default(3),
  autoApproveOfflineExperiment: z.boolean().default(true),
  // zod 4 下 .default({}) 要求完整出参类型；这些子 schema 的字段各自带默认值，
  // 用 .prefault({})（在输入阶段补默认）等价且类型兼容。
  stopCriteria: CampaignStopCriteriaSchema.prefault({}),
  schedule: CampaignScheduleSchema.prefault({}),
  noImprovementRounds: z.number().int().min(0).default(0),
  bestScore: z.number().optional(),
  rootBaseline: EvaluationResultSchema.optional(),
  /** 最近一次未提升/未通过轮次的证据化建议；跨轮保留，直到产生新 Champion 或目标被重置。 */
  lastGapAdvice: z.object({
    overall: z.string(),
    actions: z.array(z.object({ title: z.string(), detail: z.string(), target: z.string() })).default([]),
  }).optional(),
  estimatedCost: z.number().min(0).default(0),
  startedAt: z.string().optional(),
  completedAt: z.string().optional(),
  stopReason: z.string().optional(),
  /** 用户暂停 / 页面刷新打断时写入的轮内断点；恢复并跑完整轮后清除。 */
  checkpoint: CampaignCheckpointSchema.optional(),
});
export type EvolutionCampaign = z.infer<typeof EvolutionCampaignSchema>;

export const SearchChampionSchema = z.object({
  id: z.string(),
  versionLabel: z.string(),
  round: z.number().int().min(0),
  score: z.number(),
  candidate: CandidateSchema.optional(),
  evaluation: EvaluationResultSchema.optional(),
  validation: ValidationRunSchema.optional(),
  artifactAcceptance: ArtifactAcceptanceSchema.optional(),
  patches: z.array(CandidatePatchSchema).default([]),
  parentVersionId: z.string().optional(),
  reason: z.string(),
  selectedAt: z.string(),
});
export type SearchChampion = z.infer<typeof SearchChampionSchema>;

export const EvolutionArchiveEntrySchema = z.object({
  id: z.string(),
  round: z.number().int().min(1),
  kind: z.enum(["champion", "elite", "stepping-stone", "failure"]),
  niche: z.string(),
  score: z.number(),
  candidate: CandidateSchema,
  evaluation: EvaluationResultSchema,
  parentVersionId: z.string().optional(),
  lineage: z.array(z.string()).default([]),
  reason: z.string(),
  createdAt: z.string(),
});
export type EvolutionArchiveEntry = z.infer<typeof EvolutionArchiveEntrySchema>;

export const EvolutionRoundSchema = z.object({
  id: z.string(),
  round: z.number().int().min(1),
  status: z.enum(["running", "completed", "failed", "stopped"]),
  parentVersionId: z.string(),
  startedAt: z.string(),
  completedAt: z.string().optional(),
  selectedProblemTitle: z.string().optional(),
  candidateCount: z.number().int().min(0),
  winnerCandidateId: z.string().optional(),
  winnerScore: z.number().optional(),
  championChanged: z.boolean().default(false),
  globalChampionId: z.string().optional(),
  improvement: z.number().default(0),
  estimatedCost: z.number().min(0).default(0),
  summary: z.string(),
});
export type EvolutionRound = z.infer<typeof EvolutionRoundSchema>;

export const OutputArtifactSchema = z.object({
  frozenArtifact: FrozenArtifactSchema.optional(),
  id: z.string(),
  projectId: z.string(),
  round: z.number().int().min(0),
  versionLabel: z.string(),
  candidateId: z.string().optional(),
  name: z.string(),
  mimeType: z.string(),
  kind: z.enum(["primary", "patch-bundle", "manifest", "scorecard", "release-notes", "lineage", "search-summary", "acceptance-report", "requirement-matrix"]),
  content: z.string(),
  description: z.string(),
  sourceArtifactIds: z.array(z.string()).default([]),
  isChampion: z.boolean().default(false),
  accepted: z.boolean().default(false),
  createdAt: z.string(),
});
export type OutputArtifact = z.infer<typeof OutputArtifactSchema>;

export const ProjectModelRouteSchema = z.object({
  connectionId: z.string(),
  model: z.string(),
  label: z.string().default(""),
});
export type ProjectModelRoute = z.infer<typeof ProjectModelRouteSchema>;

export const ProjectAiProfileSchema = z.object({
  mode: z.enum(["global", "project"]).default("global"),
  primary: ProjectModelRouteSchema.optional(),
  judge: ProjectModelRouteSchema.optional(),
  builder: ProjectModelRouteSchema.optional(),
  copilot: ProjectModelRouteSchema.optional(),
  // 节点级覆盖优先于角色默认路由。已有节点保留其完成时的结果；只影响之后对该节点的重跑。
  operationRoutes: z.record(z.string(), ProjectModelRouteSchema).optional(),
});
export type ProjectAiProfile = z.infer<typeof ProjectAiProfileSchema>;


export const ExperimentPolicySchema = z.object({
  mode: z.enum(["adaptive", "full"]).default("adaptive"),
  finalistCount: z.number().int().min(2).max(6).default(2),
  screeningCaseCount: z.number().int().min(1).max(5).default(2),
  batchSize: z.number().int().min(2).max(8).default(5),
  buildConcurrency: z.number().int().min(1).max(4).default(3),
  batchArtifactRuntime: z.boolean().default(true),
}).prefault({});
export type ExperimentPolicy = z.infer<typeof ExperimentPolicySchema>;

export const AttentionRequestSchema = z.object({
  id: z.string(),
  type: z.enum(["clarification", "input", "evidence", "capability", "authorization", "limit"]),
  status: z.enum(["pending", "resolved", "expired"]).default("pending"),
  title: z.string(),
  reason: z.string(),
  stage: StageSchema,
  riskLevel: z.enum(["low", "medium", "high"]).default("medium"),
  blocking: z.boolean().default(true),
  criterionIds: z.array(z.string()).default([]),
  questions: z.array(z.object({
    question: z.string(),
    whyItMatters: z.string().optional(),
    defaultAnswer: z.string().optional(),
  })).default([]),
  suggestedAction: z.string().optional(),
  createdAt: z.string(),
  resolvedAt: z.string().optional(),
  resolution: z.string().optional(),
});
export type AttentionRequest = z.infer<typeof AttentionRequestSchema>;

export const EvolveProjectSchema = z.object({
  id: z.string(),
  name: z.string(),
  objectType: z.enum(["agent", "system", "prompt", "workflow", "knowledge", "tool", "template", "document", "presentation", "spreadsheet", "codebase"]),
  department: z.string(),
  aiProfile: ProjectAiProfileSchema.default({ mode: "global" }),
  /** 来源模板：与模板中心联动，用于使用统计与关联项目反查。 */
  templateId: z.string().optional(),
  version: z.string(),
  stage: StageSchema,
  goal: z.string(),
  evolutionCommand: z.string().default(""),
  commandHistory: z.array(CommandMessageSchema).default([]),
  sourceArtifacts: z.array(SourceArtifactSchema).default([]),
  artifactGraph: ArtifactGraphSchema.optional(),
  semanticEvolution: SemanticEvolutionSchema.optional(),
  sourceUnderstanding: SourceUnderstandingSchema.optional(),
  inputUnderstanding: InputUnderstandingSchema.optional(),
  inputClarifications: z.array(InputClarificationSchema).default([]),
  appliedPatches: z.array(CandidatePatchSchema).default([]),
  searchAppliedPatches: z.array(CandidatePatchSchema).default([]),
  problemStatement: z.string().optional(),
  desiredOutcome: z.string().optional(),
  protectedItems: z.array(z.string()),
  editableItems: z.array(z.string()),
  metrics: z.array(MetricSchema),
  acceptanceRubric: z.array(AcceptanceCriterionSchema).default([]),
  acceptanceRubricState: AcceptanceRubricStateSchema.prefault({}),
  evalSuite: z.array(TestCaseSchema).default([]),
  hiddenEvalSuite: z.array(TestCaseSchema).default([]),
  gates: z.array(GateStateSchema),
  problems: z.array(ProblemSchema),
  selectedProblemId: z.string().optional(),
  diagnosis: DiagnosisSchema.optional(),
  candidates: z.array(CandidateSchema),
  experimentPolicy: ExperimentPolicySchema,
  selectedCandidateIds: z.array(z.string()).default([]),
  baselineRun: BaselineRunSchema,
  experimentRun: ExperimentRunSchema,
  validationRun: ValidationRunSchema,
  supplementalValidationEvidence: z.array(SupplementalValidationEvidenceSchema).default([]),
  /** 自主进化唯一人工中断通道；历史项目没有该字段时保持兼容。 */
  attentionRequests: z.array(AttentionRequestSchema).optional(),
  /** 建议效果账本：每轮盲测对上一轮建议的结算记录，保留最近三条。 */
  adviceLedger: z.array(AdviceSettlementSchema).default([]),
  /** 进化版本历史：每轮验证冻结的成果物快照，支持查看与回滚。 */
  versions: z.array(EvolvedVersionSchema).default([]),
  currentVersionId: z.string().optional(),
  release: ReleaseStateSchema,
  lessons: z.array(LessonSchema),
  nextQueue: z.array(NextQueueItemSchema).default([]),
  campaign: EvolutionCampaignSchema.prefault({}),
  roundHistory: z.array(EvolutionRoundSchema).default([]),
  evolutionArchive: z.array(EvolutionArchiveEntrySchema).default([]),
  searchChampion: SearchChampionSchema.optional(),
  artifactAcceptance: ArtifactAcceptanceSchema.prefault({}),
  outputArtifacts: z.array(OutputArtifactSchema).default([]),
  archivedOutputs: z.array(OutputArtifactSchema).optional(),
  targetConnection: TargetConnectionSchema,
  updatedAt: z.string(),
});
export type EvolveProject = z.infer<typeof EvolveProjectSchema>;

export const ProjectDraftSchema = z.object({
  name: z.string().min(2),
  objectType: EvolveProjectSchema.shape.objectType,
  department: z.string().min(1),
  problemStatement: z.string().min(5),
  desiredOutcome: z.string().min(5),
});
export type ProjectDraft = z.infer<typeof ProjectDraftSchema>;
