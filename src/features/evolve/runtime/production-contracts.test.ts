import { describe, expect, it } from "vitest";
import { demoProject } from "../data/mock-project";
import { evidenceJobAsEvolutionJob, parseJobAsEvolutionJob, runTaskAsEvolutionJob } from "./job-contract";
import { PRODUCTION_BOUNDARIES, PRODUCTION_SCHEMA_VERSIONS, MissionEnvelopeSchema, missionEnvelope } from "./production-contracts";
import { targetLifecycleCapabilities } from "./target-lifecycle";

describe("production contracts", () => {
  it("wraps a mission in a versioned envelope without changing domain payload", () => {
    const envelope = missionEnvelope(demoProject, 3);
    expect(envelope.schemaVersion).toBe("mission-v1");
    expect(envelope.revision).toBe(3);
    expect(MissionEnvelopeSchema.parse(envelope).payload.id).toBe(demoProject.id);
  });

  it("declares every backend-ready boundary explicitly", () => {
    expect(PRODUCTION_BOUNDARIES).toHaveLength(6);
    expect(PRODUCTION_BOUNDARIES.every((item) => item.ready)).toBe(true);
    expect(PRODUCTION_SCHEMA_VERSIONS.job).toBe("job-v1");
    expect(PRODUCTION_SCHEMA_VERSIONS.event).toBe("event-v1");
    expect(PRODUCTION_SCHEMA_VERSIONS.target).toBe("target-v1");
  });

  it("projects legacy parse/evidence/run tasks into one job contract", () => {
    const at = "2026-09-18T00:00:00.000Z";
    const parse = parseJobAsEvolutionJob({
      id: "parse-1", name: "a.md", mimeType: "text/markdown", size: 12, lastModified: 1,
      role: "target", status: "ready", generation: 2, attempts: 1, createdAt: at, updatedAt: at,
    });
    expect(parse).toMatchObject({ schemaVersion: "job-v1", type: "parse", status: "completed", generation: 2 });

    const evidence = evidenceJobAsEvolutionJob({
      id: "p:e2e:case", projectId: "p", kind: "e2e", scope: "case", label: "E2E",
      fingerprint: "fp", status: "unavailable", generation: 1, attempts: 1, createdAt: at, updatedAt: at,
    });
    expect(evidence).toMatchObject({ schemaVersion: "job-v1", missionId: "p", type: "e2e", status: "waiting" });

    const run = runTaskAsEvolutionJob({
      projectId: "p", kind: "campaign", label: "Run", startedAt: at, heartbeatAt: at, interrupted: true,
    });
    expect(run).toMatchObject({ schemaVersion: "job-v1", missionId: "p", type: "campaign", status: "waiting" });
  });

  it("reports the current artifact target lifecycle truthfully", () => {
    const capability = targetLifecycleCapabilities(demoProject);
    expect(capability).toEqual({
      read: true,
      snapshot: true,
      mutate: true,
      validate: true,
      deploy: false,
      observe: false,
      rollback: true,
    });
  });
});
