import { describe, expect, it } from "vitest";
import {
  EvolutionEventSchema,
  EvolutionJobSchema,
  SupabaseBackendConfigSchema,
} from "@evolution/contracts";
import {
  eventToSupabaseRow,
  jobToSupabaseRow,
  supabaseRowToEvent,
  supabaseRowToJob,
  supabaseRowToMission,
} from "./supabase-production-adapter";

const at = "2026-09-18T08:00:00.000Z";

describe("supabase production adapter contracts", () => {
  it("validates the auth-free V1 client config without accepting malformed endpoints", () => {
    expect(SupabaseBackendConfigSchema.safeParse({ url: "not-a-url", anonKey: "short" }).success).toBe(false);
    expect(SupabaseBackendConfigSchema.parse({
      url: "https://example.supabase.co",
      anonKey: "sb_publishable_test_fixture_0000000000000000",
    }).artifactBucket).toBe("evolution-artifacts");
  });

  it("rejects malformed mission payloads at the Supabase contract boundary", () => {
    expect(() => supabaseRowToMission({
      id: "m1",
      schema_version: "mission-v1",
      revision: 2,
      payload: { id: "m1", name: "broken" },
      created_at: at,
      updated_at: at,
    })).toThrow();
  });

  it("round-trips unified jobs and events through durable row shapes", () => {
    const job = EvolutionJobSchema.parse({
      schemaVersion: "job-v1", id: "j1", missionId: "m1", type: "e2e", status: "running",
      label: "E2E", idempotencyKey: "m1:e2e", generation: 1, attempts: 1, priority: 50,
      metadata:{sessionId:"composer-1",artifactId:"artifact-1"},
      createdAt: at, updatedAt: at,
    });
    expect(supabaseRowToJob(jobToSupabaseRow(job))).toEqual(job);

    const event = EvolutionEventSchema.parse({
      schemaVersion: "event-v1", id: "e1", missionId: "m1", type: "JobStarted",
      source: "test", jobId: "j1", payload: { ok: true }, at,
    });
    expect(supabaseRowToEvent(eventToSupabaseRow(event))).toEqual(event);
  });
});
