import { describe, expect, it } from "vitest";
import type { CampaignSchedule } from "@evolution/contracts";
import { advanceCampaignScheduleAfterServerRun, nextCampaignScheduledAt } from "./campaign-schedule";

function schedule(overrides: Partial<CampaignSchedule> = {}): CampaignSchedule {
  return {
    mode: "manual",
    enabled: false,
    intervalMinutes: 60,
    daysOfWeek: [],
    hour: 9,
    minute: 0,
    timezone: "Asia/Tokyo",
    ...overrides,
  };
}

describe("campaign schedule", () => {
  it("advances interval schedules and closes one-shot schedules", () => {
    const at = new Date("2026-09-21T00:00:00.000Z");
    expect(advanceCampaignScheduleAfterServerRun(schedule({ mode: "interval", enabled: true }), at).nextRunAt)
      .toBe("2026-09-21T01:00:00.000Z");
    expect(advanceCampaignScheduleAfterServerRun(schedule({
      mode: "once",
      enabled: true,
      startAt: "2026-09-21T00:00:00.000Z",
    }), at).enabled).toBe(false);
  });

  it("uses the persisted IANA timezone for daily schedules", () => {
    const next = nextCampaignScheduledAt(
      schedule({ mode: "daily", enabled: true, hour: 9, minute: 30, timezone: "Asia/Tokyo" }),
      new Date("2026-09-21T00:00:00.000Z"),
    );
    expect(next).toBe("2026-09-21T00:30:00.000Z");
  });

  it("fails closed for legacy local recurring schedules on the server", () => {
    expect(nextCampaignScheduledAt(
      schedule({ mode: "daily", enabled: true, timezone: "local" }),
      new Date("2026-09-21T00:00:00.000Z"),
    )).toBeUndefined();
  });
});
