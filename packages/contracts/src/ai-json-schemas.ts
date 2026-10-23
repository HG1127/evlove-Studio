const stringArray = { type: "array", items: { type: "string" } } as const;
// 评分统一按 0-100 百分制约定：不写清范围时，部分模型会返回 0-1 小数（0.92），前端按百分数渲染就变成 1%。
const scorePercent = { type: "number", minimum: 0, maximum: 100, description: "score as a 0-100 percentage (e.g. 92 means 92%); do NOT return a 0-1 fraction" } as const;
const artifactRole = { type: "string", enum: ["target", "reference", "eval"] } as const;
const metric = {
  type: "object",
  additionalProperties: false,
  properties: {
    key: { type: "string" }, label: { type: "string" }, target: { type: "number" }, unit: { type: "string" },
    direction: { type: "string", enum: ["higher", "lower"] }, why: { type: "string" },
  },
  required: ["key", "label", "target", "unit", "direction", "why"],
} as const;
const testCase = {
  type: "object",
  additionalProperties: false,
  properties: {
    browserSteps:{type:"array",maxItems:24,items:{type:"object",additionalProperties:false,
      properties:{action:{type:"string",enum:["click","fill","visible","text","count"]},selector:{type:"string",minLength:1},value:{type:"string"},count:{type:"integer",minimum:0}},
      required:["action","selector","value","count"]},description:"Use [] for non-browser cases. Browser cases require actual selectors and at least one visible/text/count assertion."},
    id: { type: "string" }, title: { type: "string" }, input: { type: "string" }, expected: stringArray, tags: stringArray, hidden: { type: "boolean" }, criterionIds: stringArray,
    executionMode: { type: "string", enum: ["artifact-runtime", "static-evidence", "external-runner", "roundtrip", "visual-review", "manual"] },
    evidenceScope: { type: "string", enum: ["product-behavior", "implementation", "format", "parser", "cross-artifact"] },
  }, required: ["id", "title", "input", "expected", "tags", "hidden", "criterionIds", "executionMode", "evidenceScope", "browserSteps"],
} as const;
const problem = {
  type: "object", additionalProperties: false,
  properties: {
    id: { type: "string" }, title: { type: "string" }, impact: { type: "number" }, severity: { type: "string", enum: ["high", "medium", "low"] },
    status: { type: "string", enum: ["recommended", "observing", "planned", "selected", "resolved"] }, summary: { type: "string" }, rootCause: { type: "string" },
    evidence: stringArray, confidence: { type: "number" }, affectedComponent: { type: "string" },
  }, required: ["id", "title", "impact", "severity", "status", "summary", "rootCause", "evidence", "confidence", "affectedComponent"],
} as const;
const trace = {
  type: "object", additionalProperties: false,
  properties: { id: { type: "string" }, stage: { type: "string" }, summary: { type: "string" }, status: { type: "string", enum: ["pass", "fail", "warning", "info"] }, detail: { type: "string" } },
  required: ["id", "stage", "summary", "status", "detail"],
} as const;
const patch = {
  type: "object", additionalProperties: false,
  properties: {
    id: { type: "string" }, component: { type: "string", enum: ["prompt", "workflow", "tool", "memory", "code", "model"] },
    operation: { type: "string", enum: ["add", "update", "remove"] }, target: { type: "string" }, artifactId: { type: "string" }, content: { type: "string" }, rationale: { type: "string" },
  }, required: ["id", "component", "operation", "target", "artifactId", "content", "rationale"],
} as const;
const candidate = {
  type: "object", additionalProperties: false,
  properties: {
    id: { type: "string" }, name: { type: "string" }, title: { type: "string" }, change: { type: "string" }, hypothesis: { type: "string" }, patches: { type: "array", items: patch },
    riskLevel: { type: "string", enum: ["low", "medium", "high"] }, expectedImpact: { type: "string" }, risks: stringArray,
    accuracy: scorePercent, evidence: scorePercent, riskCoverage: scorePercent, costDelta: { type: "number" }, speedDelta: { type: "number" },
    safety: { type: "string", enum: ["PASS", "REVIEW", "FAIL"] }, recommended: { type: "boolean" }, status: { type: "string", enum: ["draft", "queued", "running", "passed", "failed", "winner"] }, notes: stringArray,
    addressesAdvice: { ...stringArray, description: "该候选针对的 gapAdvice 动作标题（输入提供 gapAdvice 时必填对应关系，至少一个候选覆盖每条动作）" },
    designRationale: {
      type: "object", additionalProperties: false,
      description: "设计论证链：方案必须基于源成果物与用户指令自证逻辑自洽，缺任何一环视为无效候选",
      properties: {
        sourceEvidence: { ...stringArray, description: "从 payload.sourceArtifacts 文本中逐字复制的原文片段（或精确文件路径/节点路径），证明该候选要修的缺陷真实存在于当前成果物；至少 1 条，禁止编造" },
        commandAlignment: { type: "string", description: "引用用户进化指令 / inputUnderstanding.acceptanceFocus 的原句，说明本候选落实其中哪一句" },
        mechanism: { type: "string", description: "因果链：patch 改成果物哪一节/节点 → 行为如何变化 → 哪个指标/验收标准随之移动；不允许跳步" },
        coveredCriteria: { ...stringArray, description: "本候选推动的 payload.acceptanceRubric 标准标题，至少 1 条" },
        protectedCompliance: { type: "string", description: "点名可能触碰的保护项并说明具体如何保持不被破坏" },
        falsifier: { type: "string", description: "实验/盲测中出现什么可观察证据即证伪该候选假设" },
      },
      required: ["sourceEvidence", "commandAlignment", "mechanism", "coveredCriteria", "protectedCompliance", "falsifier"],
    },
  },
  required: ["id", "name", "title", "change", "hypothesis", "patches", "riskLevel", "expectedImpact", "risks", "accuracy", "evidence", "riskCoverage", "costDelta", "speedDelta", "safety", "recommended", "status", "notes", "designRationale"],
} as const;

const semanticObject = {
  type: "object", additionalProperties: false,
  properties: {
    typeId: { type: "string" }, label: { type: "string" }, domain: { type: "string" }, description: { type: "string" }, confidence: { type: "number" },
    audience: stringArray, primaryOutcome: { type: "string" }, componentArtifactIds: stringArray, crossArtifactRequirements: stringArray, reasoning: stringArray,
  },
  required: ["typeId", "label", "domain", "description", "confidence", "audience", "primaryOutcome", "componentArtifactIds", "crossArtifactRequirements", "reasoning"],
} as const;
const semanticWorkflowStage = {
  type: "object", additionalProperties: false,
  properties: {
    id: { type: "string", enum: ["define", "baseline", "diagnose", "evolve", "verify", "deliver"] },
    label: { type: "string" }, flow: { type: "string" }, input: { type: "string" }, action: { type: "string" }, output: { type: "string" }, done: { type: "string" }, applicableArtifactIds: stringArray,
  },
  required: ["id", "label", "flow", "input", "action", "output", "done", "applicableArtifactIds"],
} as const;

export const jsonSchemas = {
  command: {
    name: "evolve_command",
    schema: { type: "object", additionalProperties: false, properties: {
      answer: { type: "string" }, updatedCommand: { type: "string" }, shouldRefreshTarget: { type: "boolean" },
      protectedItemsAdd: stringArray, editableItemsAdd: stringArray,
      suggestedAction: { type: "string", enum: ["none", "refresh-target", "generate-eval-suite", "run-baseline", "analyze-problems", "run-diagnosis", "generate-plan", "run-experiment", "run-validation", "start-shadow", "advance-canary", "distill-learning", "generate-next-queue"] },
      suggestedActionLabel: { type: "string" },
    }, required: ["answer", "updatedCommand", "shouldRefreshTarget", "protectedItemsAdd", "editableItemsAdd", "suggestedAction", "suggestedActionLabel"] },
  },
  intake: {
    name: "evolve_intake",
    schema: { type: "object", additionalProperties: false, properties: {
      projectName: { type: "string" },
      detectedObjectType: { type: "string", enum: ["agent", "system", "prompt", "workflow", "knowledge", "tool", "template", "document", "presentation", "spreadsheet", "codebase"] },
      currentStateSummary: { type: "string" }, evolutionIntent: { type: "string" }, goal: { type: "string" }, metrics: { type: "array", items: metric },
      protectedItems: stringArray, editableItems: stringArray, acceptanceCriteria: stringArray,
      acceptanceRubric: { type: "array", items: { type: "object", additionalProperties: false, properties: {
        id: { type: "string" }, title: { type: "string" }, requirement: { type: "string" }, source: { type: "string", enum: ["user-command", "source-understanding", "protected-item", "metric", "system-integrity"] },
        weight: { type: "number" }, hardGate: { type: "boolean" }, judgeType: { type: "string", enum: ["llm", "structural", "integrity", "pairwise"] }, validationMethod: { type: "string", enum: ["user-scenario", "static-structure", "executable-test", "visual-review", "format-roundtrip", "cross-artifact", "semantic-judge", "manual-review"] }, minScore: { type: "number" }, evidenceExpected: stringArray, protectedConstraint: { type: "boolean" }, artifactIds: stringArray, category: { type: "string", enum: ["outcome", "behavior", "integrity", "protected", "artifact-specific", "ux", "performance"] },
      }, required: ["id", "title", "requirement", "source", "weight", "hardGate", "judgeType", "validationMethod", "minScore", "evidenceExpected", "protectedConstraint", "artifactIds", "category"] } },
      semanticObject,
      semanticWorkflowStages: { type: "array", items: semanticWorkflowStage, minItems: 6, maxItems: 6 },
      semanticWarnings: stringArray,
      risks: stringArray,
      artifactSummaries: { type: "array", items: { type: "object", additionalProperties: false, properties: { artifactId: { type: "string" }, summary: { type: "string" }, detectedRole: artifactRole }, required: ["artifactId", "summary", "detectedRole"] } },
      followUpQuestions: stringArray,
    }, required: ["projectName", "detectedObjectType", "currentStateSummary", "evolutionIntent", "goal", "metrics", "protectedItems", "editableItems", "acceptanceCriteria", "acceptanceRubric", "semanticObject", "semanticWorkflowStages", "semanticWarnings", "risks", "artifactSummaries", "followUpQuestions"] },
  },
  understand: {
    name: "evolve_understand",
    schema: { type: "object", additionalProperties: false, properties: {
      intentRestatement: { type: "string" },
      implicitRequirements: stringArray,
      assumptions: stringArray,
      clarifications: { type: "array", maxItems: 4, items: { type: "object", additionalProperties: false, properties: { question: { type: "string" }, whyItMatters: { type: "string" }, defaultAnswer: { type: "string" } }, required: ["question", "whyItMatters", "defaultAnswer"] } },
      acceptanceFocus: stringArray,
      confidence: { type: "number" },
    }, required: ["intentRestatement", "implicitRequirements", "assumptions", "clarifications", "acceptanceFocus", "confidence"] },
  },
  target: {
    name: "evolve_target",
    schema: { type: "object", additionalProperties: false, properties: { goal: { type: "string" }, metrics: { type: "array", items: metric }, protectedItems: stringArray, editableItems: stringArray, acceptanceCriteria: stringArray, risks: stringArray }, required: ["goal", "metrics", "protectedItems", "editableItems", "acceptanceCriteria", "risks"] },
  },
  evalSuite: {
    name: "evolve_eval_suite",
    schema: { type: "object", additionalProperties: false, properties: { validationCases: { type: "array", minItems: 3, maxItems: 12, items: testCase }, hiddenCases: { type: "array", minItems: 2, maxItems: 8, items: testCase }, summary: { type: "string" } }, required: ["validationCases", "hiddenCases", "summary"] },
  },
  problemAnalysis: {
    name: "evolve_problem_analysis",
    schema: { type: "object", additionalProperties: false, properties: { problems: { type: "array", items: problem }, recommendedProblemId: { type: "string" }, summary: { type: "string" } }, required: ["problems", "recommendedProblemId", "summary"] },
  },
  diagnosis: {
    name: "evolve_diagnosis",
    schema: { type: "object", additionalProperties: false, properties: {
      problemId: { type: "string" }, rootCause: { type: "string" }, summary: { type: "string" }, affectedComponent: { type: "string" }, confidence: { type: "number" }, evidence: stringArray, counterEvidence: stringArray,
      falsifier: { type: "string" }, suggestedScopes: { type: "array", items: { type: "string", enum: ["prompt", "workflow", "tool", "memory", "code", "model"] } }, trace: { type: "array", items: trace },
    }, required: ["problemId", "rootCause", "summary", "affectedComponent", "confidence", "evidence", "counterEvidence", "falsifier", "suggestedScopes", "trace"] },
  },
  plan: {
    name: "evolve_plan",
    schema: { type: "object", additionalProperties: false, properties: { candidates: { type: "array", items: candidate }, recommendedCandidateIds: stringArray, summary: { type: "string" }, experimentDesign: stringArray }, required: ["candidates", "recommendedCandidateIds", "summary", "experimentDesign"] },
  },
  rubric: {
    name: "evolve_acceptance_rubric",
    schema: { type: "object", additionalProperties: false, properties: {
      criteria: { type: "array", items: { type: "object", additionalProperties: false, properties: {
        id: { type: "string" }, title: { type: "string" }, requirement: { type: "string" }, source: { type: "string", enum: ["user-command", "source-understanding", "protected-item", "metric", "system-integrity"] },
        weight: { type: "number" }, hardGate: { type: "boolean" }, judgeType: { type: "string", enum: ["llm", "structural", "integrity", "pairwise"] }, validationMethod: { type: "string", enum: ["user-scenario", "static-structure", "executable-test", "visual-review", "format-roundtrip", "cross-artifact", "semantic-judge", "manual-review"] }, minScore: { type: "number" }, evidenceExpected: stringArray, protectedConstraint: { type: "boolean" }, artifactIds: stringArray, category: { type: "string", enum: ["outcome", "behavior", "integrity", "protected", "artifact-specific", "ux", "performance"] },
      }, required: ["id", "title", "requirement", "source", "weight", "hardGate", "judgeType", "validationMethod", "minScore", "evidenceExpected", "protectedConstraint", "artifactIds", "category"] } },
      summary: { type: "string" },
    }, required: ["criteria", "summary"] },
  },
  buildCandidate: {
    name: "evolve_build_candidate_artifacts",
    schema: { type: "object", additionalProperties: false, properties: {
      artifacts: { type: "array", items: { type: "object", additionalProperties: false, properties: {
        sourceArtifactId: { type: "string" }, name: { type: "string" }, mimeType: { type: "string" }, content: { type: "string" }, contentHash: { type: "string" }, buildMode: { type: "string", enum: ["ai-full", "deterministic", "external-target"] }, notes: stringArray,
      }, required: ["sourceArtifactId", "name", "mimeType", "content", "contentHash", "buildMode", "notes"] } },
      summary: { type: "string" },
    }, required: ["artifacts", "summary"] },
  },
  artifactAcceptance: {
    name: "evolve_artifact_acceptance",
    schema: { type: "object", additionalProperties: false, properties: {
      overallScore: scorePercent, coverageScore: scorePercent, integrityScore: scorePercent, pairwiseScore: scorePercent, hardGatePass: { type: "boolean" },
      results: { type: "array", items: { type: "object", additionalProperties: false, properties: { criterionId: { type: "string" }, score: scorePercent, pass: { type: "boolean" }, evidence: stringArray, gaps: stringArray, note: { type: "string" } }, required: ["criterionId", "score", "pass", "evidence", "gaps", "note"] } },
      summary: { type: "string" },
    }, required: ["overallScore", "coverageScore", "integrityScore", "pairwiseScore", "hardGatePass", "results", "summary"] },
  },
  repairArtifact: {
    name: "evolve_repair_artifact",
    schema: { type: "object", additionalProperties: false, properties: {
      artifacts: { type: "array", items: { type: "object", additionalProperties: false, properties: { sourceArtifactId: { type: "string" }, name: { type: "string" }, mimeType: { type: "string" }, content: { type: "string" }, notes: stringArray }, required: ["sourceArtifactId", "name", "mimeType", "content", "notes"] } },
      repairedCriteria: stringArray, summary: { type: "string" },
    }, required: ["artifacts", "repairedCriteria", "summary"] },
  },
  executeArtifact: {
    name: "evolve_execute_artifact",
    schema: { type: "object", additionalProperties: false, properties: { output: { type: "string" }, trace: { type: "array", items: trace } }, required: ["output", "trace"] },
  },
  executeArtifactBatch: {
    name: "evolve_execute_artifact_batch",
    schema: { type: "object", additionalProperties: false, properties: {
      results: { type: "array", items: { type: "object", additionalProperties: false, properties: {
        testCaseId: { type: "string" }, output: { type: "string" }, trace: { type: "array", items: trace },
      }, required: ["testCaseId", "output", "trace"] } },
    }, required: ["results"] },
  },
  evaluatePopulation: {
    name: "evolve_population_evaluation",
    schema: { type: "object", additionalProperties: false, properties: {
      candidates: { type: "array", items: { type: "object", additionalProperties: false, properties: {
        candidateId: { type: "string" }, score: { type: "number", minimum: 0, maximum: 100 }, hardGatePass: { type: "boolean" }, safety: { type: "string", enum: ["PASS", "REVIEW", "FAIL"] }, strengths: stringArray, gaps: stringArray,
      }, required: ["candidateId", "score", "hardGatePass", "safety", "strengths", "gaps"] } },
      summary: { type: "string" },
    }, required: ["candidates", "summary"] },
  },
  materialize: {
    name: "evolve_materialize",
    schema: { type: "object", additionalProperties: false, properties: {
      artifacts: { type: "array", items: { type: "object", additionalProperties: false, properties: { sourceArtifactId: { type: "string" }, name: { type: "string" }, mimeType: { type: "string" }, content: { type: "string" }, notes: { type: "string" } }, required: ["sourceArtifactId", "name", "mimeType", "content", "notes"] } },
      summary: { type: "string" },
    }, required: ["artifacts", "summary"] },
  },
  releaseReview: {
    name: "evolve_release_review",
    schema: { type: "object", additionalProperties: false, properties: { recommendation: { type: "string", enum: ["release", "hold", "reject"] }, summary: { type: "string" }, reasons: stringArray, risks: stringArray, requiredChecks: stringArray }, required: ["recommendation", "summary", "reasons", "risks", "requiredChecks"] },
  },
  distill: {
    name: "evolve_distill",
    schema: { type: "object", additionalProperties: false, properties: { title: { type: "string" }, summary: { type: "string" }, reusable: { type: "boolean" }, effect: { type: "string" }, limit: { type: "string" }, trigger: stringArray, method: stringArray, validatedOn: stringArray, status: { type: "string", enum: ["lesson", "verified-skill", "anti-pattern"] } }, required: ["title", "summary", "reusable", "effect", "limit", "trigger", "method", "validatedOn", "status"] },
  },
  nextQueue: {
    name: "evolve_next_queue",
    schema: { type: "object", additionalProperties: false, properties: { items: { type: "array", items: { type: "object", additionalProperties: false, properties: { id: { type: "string" }, title: { type: "string" }, reason: { type: "string" }, priority: { type: "string", enum: ["P0", "P1", "P2"] }, source: { type: "string" }, suggestedMetrics: stringArray }, required: ["id", "title", "reason", "priority", "source", "suggestedMetrics"] } }, recommendedId: { type: "string" }, summary: { type: "string" } }, required: ["items", "recommendedId", "summary"] },
  },
  copilot: {
    name: "evolve_copilot",
    schema: { type: "object", additionalProperties: false, properties: { answer: { type: "string" }, suggestedAction: { type: "string", enum: ["none", "confirm-target", "generate-eval-suite", "run-baseline", "analyze-problems", "run-diagnosis", "generate-plan", "approve-experiment", "run-experiment", "run-validation", "approve-release", "start-shadow", "advance-canary", "distill-learning", "generate-next-queue", "run-campaign-round", "run-campaign", "materialize-outputs"] }, suggestedActionLabel: { type: "string" }, evidence: stringArray }, required: ["answer", "suggestedAction", "suggestedActionLabel", "evidence"] },
  },
  evaluate: {
    name: "evolve_evaluation",
    schema: {
      type: "object", additionalProperties: false,
      properties: {
        accuracy: scorePercent, evidence: scorePercent, riskCoverage: scorePercent, completeness: scorePercent,
        safety: { type: "string", enum: ["PASS", "REVIEW", "FAIL"] }, notes: stringArray, failures: stringArray,
        // 逐题打分：聚合分只能告诉你「差了几分」，逐题分才能回答「差在哪道题、为什么」。
        cases: {
          type: "array", description: "one entry per testCaseId given in the input; per-case scores must average to roughly the aggregate scores",
          items: {
            type: "object", additionalProperties: false,
            properties: {
              testCaseId: { type: "string" }, accuracy: scorePercent, evidence: scorePercent, completeness: scorePercent,
              reason: { type: "string", description: "一句中文（<=60字）说明本题扣分的具体原因，指出缺失或错误的点；满分则写通过要点" },
            },
            required: ["testCaseId", "accuracy", "evidence", "completeness", "reason"],
          },
        },
        criteria: {
          type: "array", description: "one entry per Acceptance Rubric criterion; score the project-specific requirements instead of relying on generic metrics",
          items: { type: "object", additionalProperties: false, properties: {
            criterionId: { type: "string" }, score: scorePercent, pass: { type: "boolean" }, evidence: stringArray, gaps: stringArray, testCaseIds: stringArray,
          }, required: ["criterionId", "score", "pass", "evidence", "gaps", "testCaseIds"] },
        },
      },
        required: ["accuracy", "evidence", "riskCoverage", "completeness", "safety", "notes", "failures", "cases", "criteria"],
    },
  },
  gapCluster: {
    name: "evolve_gap_cluster",
    schema: {
      type: "object", additionalProperties: false,
      properties: {
        clusters: {
          type: "array", description: "group worsened cases by common failure mechanism, at most 5 clusters, each caseId appears in exactly one cluster",
          items: {
            type: "object", additionalProperties: false,
            properties: {
              name: { type: "string", description: "薄弱环节类别短名（<=10字中文）" },
              caseIds: stringArray,
              pattern: { type: "string", description: "这一类题目失分的共同病因，引用各题扣分原因里的共同具体点" },
              advice: { type: "string", description: "针对该薄弱环节可落地的进化建议（改 prompt/workflow/tool/memory 或补参考材料）" },
            },
            required: ["name", "caseIds", "pattern", "advice"],
          },
        },
        overall: { type: "string", description: "一句话总结最主要的薄弱主题" },
      },
      required: ["clusters", "overall"],
    },
  },
  gapAdvice: {
    name: "evolve_gap_advice",
    schema: {
      type: "object", additionalProperties: false,
      properties: {
        overall: { type: "string", description: "本轮验证结果的整体诊断：差距来自哪里、为什么（<=120字中文，直接面向产品负责人）" },
        actions: {
          type: "array", description: "2-4 条按优先级排序的具体调整动作，必须能在本项目的进化命令/候选生成中落地",
          items: {
            type: "object", additionalProperties: false,
            properties: {
              title: { type: "string", description: "动作短名（<=14字中文）" },
              detail: { type: "string", description: "具体怎么调：改哪类指令、补什么材料、加什么检查，引用输入中的具体证据" },
              target: { type: "string", description: "作用对象：Prompt / Workflow / Tool / Memory / 评测题 / 目标设定 之一" },
            },
            required: ["title", "detail", "target"],
          },
        },
      },
      required: ["overall", "actions"],
    },
  },
  visualJudge: {
    name: "evolve_visual_judge",
    schema: {
      type: "object", additionalProperties: false,
      properties: {
        scores: {
          type: "object", additionalProperties: false,
          properties: {
            usability: { type: "number", description: "可用性 0-100：信息层级、可发现性、任务能否顺利完成" },
            aesthetics: { type: "number", description: "美观度 0-100：视觉一致性、留白、配色与排版质感" },
            responsiveness: { type: "number", description: "响应式 0-100：布局在不同宽度下的适应性（依据截图可见证据）" },
            interaction: { type: "number", description: "操作习惯 0-100：符合用户心智模型与常见交互惯例的程度" },
          },
          required: ["usability", "aesthetics", "responsiveness", "interaction"],
        },
        summary: { type: "string", description: "<=120字中文整体视觉/UX 评价，先说看到什么再说结论" },
        findings: { type: "array", items: { type: "string" }, description: "3-8 条具体观察，每条指向截图中的可见证据" },
      },
      required: ["scores", "summary", "findings"],
    },
  },
} as const;
