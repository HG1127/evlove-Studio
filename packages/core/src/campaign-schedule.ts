import type { CampaignSchedule } from "@evolution/contracts";

const WEEKDAY_INDEX: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

function validTimezone(timezone: string | undefined) {
  if (!timezone || timezone === "local") return undefined;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone }).format(new Date(0));
    return timezone;
  } catch {
    return undefined;
  }
}

function zonedClock(date: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hourCycle: "h23",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value;
  return {
    weekday: WEEKDAY_INDEX[get("weekday") ?? ""] ?? -1,
    hour: Number(get("hour")),
    minute: Number(get("minute")),
  };
}

/**
 * Server-safe campaign schedule calculation.
 *
 * Recurring daily/weekly schedules require an explicit IANA timezone. Legacy
 * "local" schedules intentionally fail closed on the server because silently
 * interpreting the browser's wall clock as UTC would execute at the wrong time.
 */
export function nextCampaignScheduledAt(
  schedule: CampaignSchedule,
  from = new Date(),
): string | undefined {
  if (!schedule.enabled || schedule.mode === "manual") return undefined;
  if (schedule.mode === "once") {
    if (!schedule.startAt) return undefined;
    const at = new Date(schedule.startAt).getTime();
    return Number.isFinite(at) && at > from.getTime() ? schedule.startAt : undefined;
  }
  if (schedule.mode === "interval") {
    return new Date(from.getTime() + schedule.intervalMinutes * 60_000).toISOString();
  }
  if (schedule.mode === "weekly" && schedule.daysOfWeek.length === 0) return undefined;

  const timezone = validTimezone(schedule.timezone);
  if (!timezone) return undefined;

  // Search minute-by-minute for at most eight days. This is deliberately simple
  // and DST-safe: Intl owns offset/transition rules, including 30/45-minute zones.
  const firstMinute = Math.floor(from.getTime() / 60_000) * 60_000 + 60_000;
  const max = firstMinute + 8 * 24 * 60 * 60_000;
  for (let timestamp = firstMinute; timestamp <= max; timestamp += 60_000) {
    const clock = zonedClock(new Date(timestamp), timezone);
    if (clock.hour !== schedule.hour || clock.minute !== schedule.minute) continue;
    if (schedule.mode === "weekly" && !schedule.daysOfWeek.includes(clock.weekday)) continue;
    return new Date(timestamp).toISOString();
  }
  return undefined;
}

export function advanceCampaignScheduleAfterServerRun(
  schedule: CampaignSchedule,
  at = new Date(),
): CampaignSchedule {
  const base={...schedule};
  delete base.durableJobId;
  delete base.durableRunId;
  delete base.durableScheduledFor;
  const lastRunAt = at.toISOString();
  if (!schedule.enabled) return { ...base, lastRunAt, nextRunAt: undefined };
  if (schedule.mode === "once") return { ...base, enabled: false, lastRunAt, nextRunAt: undefined };
  const nextRunAt = nextCampaignScheduledAt({ ...base, enabled: true }, at);
  return { ...base, enabled: Boolean(nextRunAt), lastRunAt, nextRunAt };
}
