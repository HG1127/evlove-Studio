import type { EvolveProject } from "../schemas";
import { deriveAttentionRequest, deriveAutonomousDecision } from "./autonomous-orchestrator";
import { isMissionUserAccepted } from "./mission-review-store";

export type MissionUserState = "attention" | "running" | "review" | "completed" | "scheduled" | "paused" | "waiting";

export type MissionState = {
  state: MissionUserState;
  label: string;
  detail: string;
  actionLabel: string;
  stage: EvolveProject["stage"];
};

export function deriveMissionState(project: EvolveProject, runtime?: { running?: boolean; interrupted?: boolean }): MissionState {
  if (runtime?.running || project.campaign.status === "running") {
    return { state: "running", label: "正在自动进化", detail: "Evolve 正在后台推进当前任务，无需人工操作。", actionLabel: "查看实时进度", stage: project.stage };
  }

  const attention = deriveAttentionRequest(project);
  if (attention) {
    return { state: "attention", label: "需要你处理", detail: attention.title || attention.reason, actionLabel: "处理问题", stage: attention.stage };
  }

  if (runtime?.interrupted) {
    return { state: "paused", label: "等待恢复", detail: "上次运行被刷新或页面关闭打断，打开任务后会从断点继续。", actionLabel: "恢复任务", stage: project.stage };
  }

  const hasAcceptedPrimary = project.outputArtifacts.some((artifact) => artifact.kind === "primary" && artifact.accepted);
  const userAccepted = isMissionUserAccepted(project);
  const decision = deriveAutonomousDecision(project);

  if (hasAcceptedPrimary && !userAccepted) {
    return { state: "review", label: "成果待验收", detail: "系统验收已经通过，等待你查看差异并确认是否接受本次成果。", actionLabel: "验收成果", stage: "validation" };
  }

  if (userAccepted && decision.action === "complete") {
    return { state: "completed", label: "已完成", detail: "成果已由你确认，系统经验与下一轮建议也已完成沉淀。", actionLabel: "查看成果", stage: project.stage };
  }

  if (project.campaign.schedule.enabled || project.campaign.status === "scheduled") {
    return { state: "scheduled", label: "已计划", detail: "任务已进入自动运行计划，等待下一次触发。", actionLabel: "查看计划", stage: project.stage };
  }

  if (project.campaign.status === "paused") {
    return { state: "paused", label: "已暂停", detail: project.campaign.stopReason || "任务已暂停，可从当前断点继续。", actionLabel: "继续任务", stage: project.stage };
  }

  return { state: "waiting", label: "等待系统继续", detail: decision.reason || "任务已保存，系统将从当前状态继续。", actionLabel: "打开任务", stage: decision.stage };
}

export const missionStateMeta: Record<MissionUserState, { label: string; dot: string; badge: string }> = {
  attention: { label: "需要处理", dot: "bg-amber-500", badge: "border-amber-200 bg-amber-50 text-amber-700" },
  running: { label: "正在运行", dot: "bg-indigo-500", badge: "border-indigo-200 bg-indigo-50 text-indigo-700" },
  review: { label: "待验收", dot: "bg-sky-500", badge: "border-sky-200 bg-sky-50 text-sky-700" },
  completed: { label: "已完成", dot: "bg-emerald-500", badge: "border-emerald-200 bg-emerald-50 text-emerald-700" },
  scheduled: { label: "已计划", dot: "bg-violet-500", badge: "border-violet-200 bg-violet-50 text-violet-700" },
  paused: { label: "已暂停", dot: "bg-slate-400", badge: "border-slate-200 bg-slate-50 text-slate-600" },
  waiting: { label: "等待继续", dot: "bg-slate-300", badge: "border-slate-200 bg-white text-slate-500" },
};
