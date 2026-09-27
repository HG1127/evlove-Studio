import { expect, it, vi } from "vitest";
import { TestCaseSchema, type TargetRunResult } from "../schemas";
import { demoProject } from "../data/mock-project";
import { runDemoAi } from "../ai/demo-provider";
import { PlanAiResultSchema } from "../ai/schemas";
import { clearValidationReuseCache, createValidationReuse, validationImpactPriority } from "./validation-reuse";

const testCase = (id: string) => TestCaseSchema.parse({ id, title: id, input: "x", expected: ["y"] });
const result = (id: string): TargetRunResult => ({ testCaseId: id, output: "ok", artifactHash: "snapshot", verificationStatus: "verified", cost: 1, latencyMs: 1, trace: [] });
it("reuses verified snapshot checks only within this validation and variant", async () => {
  const reuse = createValidationReuse();
  const run = vi.fn(async (tests: ReturnType<typeof testCase>[]) => tests.map(t => result(t.id)));
  await reuse("baseline", [testCase("a")], run);
  const complete = await reuse("baseline", [testCase("b"), testCase("a")], run);
  expect(run.mock.calls[1][0].map(t => t.id)).toEqual(["b"]);
  expect(complete.map(r => r.testCaseId)).toEqual(["b", "a"]);
  await reuse("candidate", [testCase("a")], run);
  expect(run).toHaveBeenCalledTimes(3);
  await createValidationReuse()("baseline", [testCase("a")], run);
  expect(run).toHaveBeenCalledTimes(4);
});
it("reuses exact scoped local evidence across sequential validation calls without requiring a synthetic artifact hash", async () => {
  clearValidationReuseCache();
  const run = vi.fn(async (tests: ReturnType<typeof testCase>[]) => tests.map(t => ({ ...result(t.id), artifactHash: undefined })));
  await createValidationReuse("project-1")("candidate:exact-fingerprint", [testCase("a")], run);
  await createValidationReuse("project-1")("candidate:exact-fingerprint", [testCase("a")], run);
  expect(run).toHaveBeenCalledTimes(1);
  await createValidationReuse("project-1")("candidate:changed-fingerprint", [testCase("a")], run);
  expect(run).toHaveBeenCalledTimes(2);
});

it("does not reuse live runner, missing hash, failure or changed test definitions", async () => {
  const reuse = createValidationReuse();
  const cases = [testCase("a"), { ...testCase("b"), executionMode: "external-runner" as const }, testCase("c")];
  const run = vi.fn(async () => [{ ...result("a"), artifactHash: undefined }, result("b"), { ...result("c"), error: "timeout" }]);
  await reuse("v", cases, run); await reuse("v", cases, run);
  expect(run).toHaveBeenCalledTimes(2);
  const good = vi.fn(async () => [result("d")]);
  await reuse("v", [testCase("d")], good);
  await reuse("v", [{ ...testCase("d"), expected: ["changed"] }], good);
  expect(good).toHaveBeenCalledTimes(2);
});

it("prioritizes directly changed paths and their dependent paths", () => {
  const base = PlanAiResultSchema.parse(runDemoAi("plan", {})).candidates[0]!;
  const candidate = { ...base, patches: [{ ...base.patches[0]!, target: "src/a.ts" }] };
  const source = { ...demoProject.sourceArtifacts[0]!, structuredContent: { repositoryIntelligence: { dependencyEdges: [{from:"src/b.ts",to:"src/a.ts",kind:"internal"}] } } };
  const score = validationImpactPriority({...demoProject,sourceArtifacts:[source]},candidate);
  expect(score({...testCase("a"),title:"src/a.ts 的行为"})).toBe(20);
  expect(score({...testCase("b"),title:"src/b.ts 的回归"})).toBe(10);
  expect(score(testCase("unrelated"))).toBe(0);
});

it("rejects duplicate returned identities without poisoning reusable evidence", async () => {
  clearValidationReuseCache();
  const reuse = createValidationReuse("duplicate-run-project");
  const execute = vi.fn(async (cases: ReturnType<typeof testCase>[]) => cases.length === 2
    ? [result("a"), { ...result("a"), output: "conflicting" }, result("b"), result("out-of-scope")]
    : cases.map((item) => result(item.id)));
  const first = await reuse("candidate:exact", [testCase("a"), testCase("b")], execute);
  expect(first[0]).toMatchObject({ testCaseId: "a", verificationStatus: "unverified" });
  expect(first[0]?.error).toContain("重复");
  expect(first[1]).toMatchObject({ testCaseId: "b", verificationStatus: "verified" });
  const retried = await reuse("candidate:exact", [testCase("a"), testCase("b")], execute);
  expect(execute.mock.calls[1]?.[0].map((item) => item.id)).toEqual(["a"]);
  expect(retried.map((run) => run.verificationStatus)).toEqual(["verified", "verified"]);
});

it("does not turn duplicate test definitions or a wrong result ID into cached proof", async () => {
  clearValidationReuseCache();
  const reuse = createValidationReuse("duplicate-case-project");
  const execute = vi.fn(async () => [result("wrong-id")]);
  const wrong = await reuse("candidate:exact", [testCase("a")], execute);
  expect(wrong[0]).toMatchObject({ testCaseId: "a", verificationStatus: "unverified" });
  expect(wrong[0]?.error).toContain("未返回");
  const duplicate = await reuse("candidate:exact", [testCase("a"), { ...testCase("a") }], execute);
  expect(execute).toHaveBeenCalledTimes(1);
  expect(duplicate.map((run) => run.verificationStatus)).toEqual(["unverified", "unverified"]);
  expect(duplicate.every((run) => !run.error)).toBe(true);
  const recovered = await reuse("candidate:exact", [testCase("a")], async () => [result("a")]);
  expect(recovered[0]?.verificationStatus).toBe("verified");
});
