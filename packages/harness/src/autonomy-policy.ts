import type { EvolveProject } from "@evolution/contracts";

const HIGH_IMPACT_DECISION = /(生产.{0,6}(发布|上线|部署)|直接.{0,4}(发布|上线|删除|覆盖|发送|执行)|删除|覆盖原文件|不可逆|支付|转账|交易执行|下单|发邮件|发送消息|外部系统.{0,6}(写入|修改)|数据库.{0,4}(写入|删除)|账号|密码|密钥|权限|授权|个人数据|隐私|法律|合规|合同)/i;

function unansweredClarifications(project: EvolveProject) {
  const answered = new Set(project.inputClarifications.filter((item) => item.answer.trim()).map((item) => item.question));
  return (project.inputUnderstanding?.clarifications ?? []).filter((item) => !answered.has(item.question));
}

export function clarificationNeedsHuman(
  item: { question: string; whyItMatters: string; defaultAnswer: string },
  confidence = 1,
) {
  if (!item.defaultAnswer.trim()) return true;
  if (confidence < 0.45) return true;
  return HIGH_IMPACT_DECISION.test(`${item.question}\n${item.whyItMatters}\n${item.defaultAnswer}`);
}

/**
 * Low-risk, reversible ambiguity should never interrupt autonomous execution.
 * Only high-impact decisions or ambiguities with no credible default are escalated.
 */
export function autonomousClarificationPlan(project: EvolveProject) {
  const confidence = project.inputUnderstanding?.confidence ?? 0;
  const unanswered = unansweredClarifications(project);
  const human = unanswered.filter((item) => clarificationNeedsHuman(item, confidence));
  const humanQuestions = new Set(human.map((item) => item.question));
  const auto = unanswered.filter((item) => !humanQuestions.has(item.question));
  return { auto, human };
}

