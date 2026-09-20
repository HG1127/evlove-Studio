import type { AiOperation } from "../ai/schemas";
import type { EvolveProject } from "../schemas";

export type WorkflowStepState = "completed" | "skipped" | "running" | "ready" | "blocked" | "pending";
export type WorkflowStep = { id: string; phase: number; title: string; state: WorkflowStepState; detail: string };
export type WorkflowGate = {
  id: "A" | "B" | "C" | "F" | "D" | "E";
  title: string;
  question: string;
  state: "passed" | "skipped" | "ready" | "blocked" | "pending" | "failed";
  evidence: string;
};
export type WorkflowNextAction = {
  id: string;
  label: string;
  description: string;
  operation?: AiOperation;
  kind: "machine" | "human-gate" | "release" | "completed";
  gateId?: "target-ready" | "experiment-ready" | "artifact-ready" | "release-ready";
  problemId?: string;
  releaseAction?: "shadow" | "canary-5" | "canary-20" | "canary-50" | "promote" | "rollback";
};

function gateApproved(project: EvolveProject, id: WorkflowNextAction["gateId"]) { return id ? project.gates.find((gate) => gate.id === id)?.status === "approved" : false; }
function priority(problem: EvolveProject["problems"][number]) { const severity = problem.severity === "high" ? 1.35 : problem.severity === "medium" ? 1 : 0.72; const confidence = problem.confidence ?? 0.55; const recommended = problem.status === "recommended" ? 1.22 : 1; return problem.impact * severity * (0.55 + confidence * 0.45) * recommended; }
export function recommendedProblem(project: EvolveProject) { return [...project.problems].sort((a, b) => priority(b) - priority(a))[0]; }
function atOrAfterRelease(project: EvolveProject, statuses: string[]) { return statuses.includes(project.release.status); }
/** Production traffic is an optional branch. File/artifact projects close offline after Gate F. */
export function workflowRequiresOnlineRelease(project: EvolveProject) {
  return project.targetConnection.adapter === "http";
}

export function deriveWorkflowSteps(project: EvolveProject): WorkflowStep[] {
  const targetApproved = gateApproved(project, "target-ready");
  const baselineCompleted = project.baselineRun.status === "completed";
  const selected = Boolean(project.selectedProblemId);
  const diagnosisReady = Boolean(project.diagnosis);
  const planReady = project.candidates.length > 0;
  const candidateArtifactsReady = project.candidates.some((candidate) => candidate.artifactBuildStatus === "ready" && candidate.artifactSnapshots.length > 0);
  const experimentApproved = gateApproved(project, "experiment-ready");
  const experimentCompleted = project.experimentRun.status === "completed";
  const winnerReady = Boolean(project.experimentRun.winnerId);
  const validationCompleted = winnerReady && project.validationRun.candidateId === project.experimentRun.winnerId && project.validationRun.status === "completed";
  const behaviorPassed = validationCompleted && project.validationRun.recommendation === "release";
  const artifactPassed = behaviorPassed && project.artifactAcceptance.candidateId === project.experimentRun.winnerId && project.artifactAcceptance.status === "passed";
  const outputsReady = project.outputArtifacts.some((artifact) => artifact.kind === "primary" && artifact.accepted && artifact.frozenArtifact);
  const onlineRelease = workflowRequiresOnlineRelease(project);
  const shadowDone = atOrAfterRelease(project, ["shadow", "canary-5", "canary-20", "canary-50", "promoted"]);
  const canaryDone = atOrAfterRelease(project, ["canary-5", "canary-20", "canary-50", "promoted"]);
  const finalRelease = project.release.status === "promoted" || project.release.status === "rolled-back";
  const learned = project.lessons.length > 0;
  const queued = project.nextQueue.length > 0;
  const step = (id: string, phase: number, title: string, state: WorkflowStepState, detail: string): WorkflowStep => ({ id, phase, title, state, detail });
  return [
    step("01",1,"明确目标与修改边界",project.goal&&project.metrics.length>=2?"completed":"running",project.goal?"业务目标、修改边界与 Source 已形成":"等待目标与输入"),
    step("02",1,"生成可核对的验收标准",project.acceptanceRubricState.status==="ready"&&project.acceptanceRubric.length>=3?"completed":project.goal?"ready":"blocked",project.acceptanceRubricState.status==="ready"?`${project.acceptanceRubric.length} 条 Criterion · 权重 ${project.acceptanceRubricState.weightTotal}`:"Rubric 必须在 Target Ready 前成为机器可执行契约"),
    step("03",1,"确认目标，锁定本轮标准",targetApproved?"completed":project.acceptanceRubricState.status==="ready"?"ready":"blocked",targetApproved?"Goal + Rubric + Protected Scope 已冻结":"Rubric Ready 后由用户确认"),
    step("04",2,"运行原版测试",baselineCompleted?"completed":project.baselineRun.status==="running"?"running":targetApproved?"ready":"blocked",`${project.baselineRun.totalCases||project.evalSuite.length} 个 Validation Case`),
    step("05",2,"汇总执行证据",baselineCompleted&&project.baselineRun.runs.length?"completed":baselineCompleted?"ready":"pending",`${project.baselineRun.runs.length} 条 Trace`),
    step("06",3,"自动评测",baselineCompleted?"completed":"pending",baselineCompleted?`Accuracy ${project.baselineRun.result?.accuracy??0}%`:"等待 Baseline"),
    step("07",3,"归纳问题",project.problems.length?"completed":baselineCompleted?"ready":"pending",`${project.problems.length} 个问题簇`),
    step("08",3,"选定本轮改进重点",selected?"completed":project.problems.length?"ready":"pending",selected?project.problems.find((p)=>p.id===project.selectedProblemId)?.title??"已选择":"AI 推荐 + 人工确认"),
    step("09",4,"分析原因与反证",diagnosisReady?"completed":selected?"ready":"blocked",diagnosisReady?`${Math.round((project.diagnosis?.confidence??0)*100)}% confidence`:"Evidence + Counter-evidence + Falsifier"),
    step("10",4,"拟定修改方案",planReady?"completed":diagnosisReady?"ready":"blocked",planReady?`${project.candidates.length} 个 Mutation Hypothesis`:"局部/结构/Tool/Memory/QD 候选"),
    step("11",5,"生成实际新版文件",candidateArtifactsReady?"completed":experimentApproved&&planReady?"ready":planReady?"blocked":"pending",candidateArtifactsReady?"完整 Artifact Snapshot 已生成":"先构造，后评测；不再只测试 Patch 描述"),
    step("12",5,"运行新版测试",experimentCompleted?"completed":project.experimentRun.status==="running"?"running":experimentApproved&&planReady?"ready":"blocked",experimentApproved?"执行完整 Candidate Artifact":"等待 Experiment Ready"),
    step("13",5,"独立评审与原版比较",experimentCompleted?"completed":"pending",experimentCompleted?"同卷评分已完成":"等待 Candidate Run"),
    step("14",5,"验证未知场景",validationCompleted?"completed":winnerReady?"ready":"blocked",`${project.hiddenEvalSuite.length} 个 Candidate 不可见 Case`),
    step("15",5,"选择本轮最佳版本",validationCompleted&&winnerReady?(behaviorPassed?"completed":"blocked"):experimentCompleted?"blocked":"pending",behaviorPassed?`Winner ${project.experimentRun.winnerId}`:validationCompleted?"Behavioral Gate 未通过":"等待 Holdout"),
    step("16",6,"验收实际成果",artifactPassed?"completed":behaviorPassed?project.artifactAcceptance.status==="repairing"?"running":"ready":"blocked",artifactPassed?`Acceptance ${project.artifactAcceptance.overallScore}/100`:`Coverage / Integrity / Pairwise / Hard Gate`),
    step("17",6,"定向修复未通过项",artifactPassed?"completed":project.artifactAcceptance.attempts>0?"running":behaviorPassed?"ready":"pending",artifactPassed?`${project.artifactAcceptance.attempts} 次 Repair 后通过`:`最多 ${project.artifactAcceptance.maxRepairAttempts} 次，修复后重跑 Holdout`),
    step("18",6,"冻结并交付已验收文件",outputsReady?"completed":artifactPassed?"ready":"blocked",outputsReady?"交付物 = 被测试并验收过的同一 Snapshot":"禁止重新生成另一份未测试成果"),
    step("19",7,"Shadow",!onlineRelease?"skipped":shadowDone?"completed":outputsReady&&artifactPassed&&gateApproved(project,"release-ready")?"ready":"blocked",!onlineRelease?"离线成果任务：无需生产流量，按需发布时再启用":shadowDone?"真实流量旁路完成":"需已冻结成果 + Release Ready"),
    step("20",7,"Canary 5→20→50",!onlineRelease?"skipped":canaryDone?"completed":shadowDone?"ready":"pending",!onlineRelease?"离线成果任务：不适用 Canary":`当前真实流量 ${project.release.trafficPercent}%`),
    step("21",7,"Promote / Rollback",!onlineRelease?"skipped":finalRelease?"completed":canaryDone?"ready":"pending",!onlineRelease?"离线成果任务：不产生 Production Champion":finalRelease?project.release.status:"线上 KPI 决定 Production Champion"),
    step("22",8,"Lesson / Skill / Anti-pattern",learned?"completed":outputsReady&&artifactPassed&&(!onlineRelease||finalRelease)?"ready":"blocked",learned?`${project.lessons.length} 条经验资产`:onlineRelease?"结合离线验收与线上决策提炼":"基于离线验收、修复轨迹与最终成果自动提炼"),
    step("23",8,"Next Evolve Queue",queued?"completed":learned?"ready":"blocked",queued?`${project.nextQueue.length} 个下一轮问题`:"Remaining Failure + Repair Trace + New Scenario"),
  ];
}

export function deriveWorkflowGates(project: EvolveProject): WorkflowGate[] {
  const problem = project.problems.find((item) => item.id === project.selectedProblemId);
  const diagnosis = project.diagnosis;
  const hasWinner = Boolean(project.experimentRun.winnerId);
  const currentValidation = hasWinner && project.validationRun.candidateId === project.experimentRun.winnerId;
  const validation = currentValidation ? project.validationRun : { ...project.validationRun, status: "idle" as const, recommendation: undefined, checks: [] };
  const acceptance = currentValidation && project.artifactAcceptance.candidateId === project.experimentRun.winnerId ? project.artifactAcceptance : { ...project.artifactAcceptance, status: "idle" as const };
  const finalRelease = project.release.status === "promoted" || project.release.status === "rolled-back";
  const onlineRelease = workflowRequiresOnlineRelease(project);
  const outputsReady = project.outputArtifacts.some((artifact) => artifact.kind === "primary" && artifact.accepted && artifact.frozenArtifact);
  const artifactReady = acceptance.status === "passed" && outputsReady;
  const verified = project.lessons.find((item) => item.status === "verified-skill" || item.status === "anti-pattern");
  const learned = project.lessons.length > 0;
  // 展示固定按 Gate 字母序 A–F；流程中的实际执行顺序为 A→B→C→F→D→E
  // （Gate F 在 Hidden Validation 后、上线前完成成果验收，见 deriveWorkflowSteps）。
  return [
    { id:"A",title:"Problem Worthy",question:"这个问题值得开启一轮 Evolve 吗？",state:problem?"passed":project.problems.length?"ready":"pending",evidence:problem?`${problem.title} · impact ${problem.impact}% · severity ${problem.severity}`:"等待 Failure Map" },
    { id:"B",title:"Root Cause Ready",question:"根因证据足够可信么？",state:diagnosis?(diagnosis.confidence>=0.65&&diagnosis.evidence.length?"passed":"blocked"):problem?"ready":"pending",evidence:diagnosis?`${Math.round(diagnosis.confidence*100)}% confidence · ${diagnosis.evidence.length} evidence · falsifier: ${diagnosis.falsifier}`:"等待 Trace Diff" },
    { id:"C",title:"Offline Winner",question:"完整 Candidate Artifact 在 Holdout 中真的胜出么？",state:validation.status==="completed"?(validation.recommendation==="release"?"passed":"failed"):hasWinner?"ready":"pending",evidence:validation.status==="completed"?`${validation.recommendation??"hold"} · ${validation.checks.filter((item)=>item.status==="pass").length}/${validation.checks.length} checks`:"等待 Candidate Artifact / Hidden Validation" },
    { id:"D",title:"Online Stable",question:"真实线上流量稳定么？",state:!onlineRelease?"skipped":project.release.status==="promoted"?"passed":project.release.status==="rolled-back"?"failed":project.release.status!=="idle"?(project.release.healthy===false?"blocked":"ready"):"pending",evidence:!onlineRelease?"离线成果模式：Online Gate 不适用；未伪造线上稳定结论":project.release.status==="idle"?"等待 Shadow / Canary":`${project.release.status} · ${project.release.trafficPercent}% traffic` },
    { id:"E",title:"Experience Ready",question:"经验值得固化复用么？",state:onlineRelease?(verified?"passed":finalRelease?"ready":"pending"):(learned?"passed":artifactReady?"ready":"pending"),evidence:onlineRelease?(verified?`${verified.status} · ${verified.title}`:"线上决策完成后 Distill"):(learned?`${project.lessons[0]?.status ?? "lesson"} · ${project.lessons[0]?.title ?? "离线经验"}`:artifactReady?"离线 Artifact 已验收，可提炼 Lesson":"等待 Gate F 与成果冻结") }, 
    { id:"F",title:"Artifact Ready",question:"最终交付 Artifact 本身完整满足最初进化目标吗？",state:acceptance.status==="passed"?"passed":acceptance.status==="failed"?"failed":acceptance.status==="repairing"?"ready":validation.recommendation==="release"?"ready":"pending",evidence:acceptance.status==="idle"?"等待 Requirement Coverage / Integrity / Pairwise Judge":`${acceptance.overallScore}/100 · coverage ${acceptance.coverageScore} · integrity ${acceptance.integrityScore} · hardGate ${acceptance.hardGatePass?"PASS":"FAIL"}` },
  ];
}

export function deriveNextWorkflowAction(project: EvolveProject): WorkflowNextAction {
  const onlineRelease = workflowRequiresOnlineRelease(project);
  const outputsReady = project.outputArtifacts.some((artifact) => artifact.kind === "primary" && artifact.accepted && artifact.frozenArtifact);
  if (project.acceptanceRubricState.status!=="ready"||project.acceptanceRubric.length<3) return { id:"rubric",label:"AI 编译 Project-specific Acceptance Rubric",description:"先把用户原始进化要求编译成 requirement / weight / hardGate / minScore / evidenceExpected / protectedConstraint；这是 Target Ready 的必经契约。",operation:"rubric",kind:"machine" };
  if (!gateApproved(project,"target-ready")) return { id:"gate-target",label:"确认 Target Ready + Acceptance Contract",description:"用户确认 Goal、Protected / Editable Scope 与 Project-specific Rubric 后才冻结目标函数。",kind:"human-gate",gateId:"target-ready" };
  if (project.evalSuite.length===0||project.hiddenEvalSuite.length===0) return { id:"eval-suite",label:"按 Rubric 生成 Eval Suite",description:"每道题显式绑定 criterionIds；每个 Hard Gate 至少进入一个 Hidden Holdout Case。",operation:"eval-suite",kind:"machine" };
  if (project.baselineRun.status!=="completed") return { id:"baseline",label:"运行 Baseline",description:"让当前版本真正执行测试集并采集 Trace。",operation:"execute-artifact",kind:"machine" };
  if (project.problems.length===0) return { id:"problems",label:"AI 发现与聚类问题",description:"基于 Baseline Eval + Trace 形成 Failure Map。",operation:"problem-analysis",kind:"machine" };
  if (!project.selectedProblemId) { const problem=recommendedProblem(project); return { id:"select-problem",label:problem?`确认本轮问题：${problem.title}`:"选择本轮问题",description:"Gate A：只围绕最高价值问题开启搜索。",kind:"human-gate",problemId:problem?.id }; }
  if (!project.diagnosis) return { id:"diagnosis",label:"AI 根因诊断",description:"输出 root cause / evidence / counter-evidence / falsifier。",operation:"diagnose",kind:"machine" };
  if (project.candidates.length===0) return { id:"plan",label:"生成 Candidate Population",description:"生成差异化 Mutation Hypothesis。",operation:"plan",kind:"machine" };
  if (!gateApproved(project,"experiment-ready")) return { id:"gate-experiment",label:"确认 Experiment Ready",description:"确认候选、范围和预算后构造完整 Candidate Artifact。",kind:"human-gate",gateId:"experiment-ready" };
  if (project.experimentRun.status!=="completed") return { id:"experiment",label:"构造并运行 Candidate Artifact",description:"先 Build 完整 Candidate Snapshot，再对同一 Artifact 做 Eval。",operation:"build-candidate",kind:"machine" };
  if (!project.experimentRun.winnerId) return { id:"experiment",label:"补齐同卷证据并重新比较",description:"保留已构造候选，补齐当前标准的实验卷和原版证据，再判断是否晋级。",operation:"build-candidate",kind:"machine" };
  if (project.validationRun.status!=="completed") return { id:"validation",label:"运行 Hidden Validation + Artifact Acceptance",description:"Behavioral Holdout 通过后立即执行 Gate F；失败自动进入 Repair Loop。",operation:"artifact-acceptance",kind:"machine" };
  if (project.validationRun.recommendation!=="release") return { id:"replan",label:"Behavioral Gate 未通过：重新 Plan",description:"带失败证据返回 Evolution Plan。",operation:"plan",kind:"machine" };
  if (project.artifactAcceptance.status!=="passed") return { id:"artifact-replan",label:"Artifact Ready 未通过：重新进化",description:"Repair 已耗尽或 Hard Gate 仍失败；回到 Plan 生成新的 Candidate Artifact。",operation:"plan",kind:"machine" };
  if (!outputsReady) return { id:"materialize",label:"冻结并生成正式成果包",description:"直接物化被 Hidden Validation + Gate F 验收过的同一 Snapshot，不重新生成另一份内容。",kind:"machine" };
  if (!onlineRelease) {
    if (project.lessons.length===0) return { id:"distill",label:"自动沉淀本轮 Lesson",description:"基于离线验收、修复轨迹和最终成果提炼可复用经验；没有生产证据时不会冒充 verified-skill。",operation:"distill",kind:"machine" };
    if (project.nextQueue.length===0) return { id:"next-queue",label:"生成 Next Evolve Queue",description:"根据剩余差距、Repair Trace 与已沉淀 Lesson 生成下一轮建议。",operation:"next-queue",kind:"machine" };
    return { id:"complete",label:"离线进化闭环完成",description:"Accepted Deliverable / Offline Evidence / Lesson / Next Queue 已形成；线上发布按需启用。",kind:"completed" };
  }
  if (!gateApproved(project,"release-ready")) return { id:"gate-release",label:"确认并进入线上验证",description:"成果已冻结并通过 Gate F。确认后才允许进入真实 Shadow / Canary；如未配置生产发布能力，请先在设置中连接 Release Runner。",kind:"human-gate",gateId:"release-ready" };
  if (project.release.status==="idle") return { id:"shadow",label:"启动 Shadow",description:"被验收过的同一 Artifact 进入真实分布旁路。",kind:"release",releaseAction:"shadow" };
  if (project.release.status==="shadow") return { id:"canary-5",label:"推进 Canary 5%",description:"小流量真实用户验证。",kind:"release",releaseAction:"canary-5" };
  if (project.release.status==="canary-5") return { id:"canary-20",label:"推进 Canary 20%",description:"扩大真实样本。",kind:"release",releaseAction:"canary-20" };
  if (project.release.status==="canary-20") return { id:"canary-50",label:"推进 Canary 50%",description:"验证稳定性、成本与依赖。",kind:"release",releaseAction:"canary-50" };
  if (project.release.status==="canary-50") return project.release.healthy===false?{ id:"rollback",label:"线上异常：Rollback",description:"关键 KPI 回归，恢复上一 Production Champion。",kind:"release",releaseAction:"rollback" }:{ id:"promote",label:"Promote 为 Production Champion",description:"50% Canary 稳定后正式升级。",kind:"release",releaseAction:"promote" };
  if ((project.release.status==="promoted"||project.release.status==="rolled-back")&&project.lessons.length===0) return { id:"distill",label:"AI 提炼 Lesson / Skill",description:"结合 Behavioral、Artifact Acceptance 与生产证据提炼。",operation:"distill",kind:"machine" };
  if (project.lessons.length&&project.nextQueue.length===0) return { id:"next-queue",label:"生成 Next Evolve Queue",description:"由剩余失败与新场景决定下一轮。",operation:"next-queue",kind:"machine" };
  return { id:"complete",label:"线上进化闭环完成",description:"Accepted Deliverable / Production Evidence / Experience / Next Queue 已形成。",kind:"completed" };
}
