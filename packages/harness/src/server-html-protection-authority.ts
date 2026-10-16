import type { EvolveProject, Candidate, TargetRunResult, TestCase } from "@evolution/contracts";
import { bindHtmlProtectionAuthorities, invalidateHtmlProtectionAuthorities, type HtmlProtectionAuthority } from "@evolution/core";
export type ServerHtmlProtectionAuthorityCollection = { runs: TargetRunResult[]; authorities: HtmlProtectionAuthority[] };
/** Internal injected composition only. No public DTO/serialized proof can implement this port. */
export type ServerHtmlProtectionAuthorityPort = (args: { project: EvolveProject; candidate?: Candidate;
  testCases: TestCase[]; runs: TargetRunResult[]; restoreOnly?: boolean; activeCriterionIds?: string[] }) => Promise<ServerHtmlProtectionAuthorityCollection>;
/** Boundary normalization: preserve actual returned failures and refuse missing/duplicate/foreign case identities. */
export async function collectServerSuiteHtmlProtectionAuthority(args: { project: EvolveProject; candidate?: Candidate;
  testCases: TestCase[]; runs: TargetRunResult[]; restoreOnly?: boolean; activeCriterionIds?: string[] }, port?: ServerHtmlProtectionAuthorityPort) {
  if (!port) return args.runs;
  invalidateHtmlProtectionAuthorities(args.project, { testCaseIds: args.testCases.map(test => test.id), criterionIds: args.activeCriterionIds,
    subject: args.candidate ? { candidateId: args.candidate.id } : "current" });
  const collected = await port({ ...args, testCases: structuredClone(args.testCases), runs: structuredClone(args.runs) });
  const expected = args.testCases.map(test => test.id), actual = collected.runs.map(run => run.testCaseId);
  if (expected.length !== actual.length || new Set(expected).size !== expected.length || new Set(actual).size !== actual.length
    || expected.some((id, index) => id !== actual[index]) || !bindHtmlProtectionAuthorities(args.project, collected.authorities, args.candidate && collected.authorities.length ? args.candidate : undefined)) {
    throw Error("HTML protection collector returned an ambiguous scope or unregistered authority");
  }
  return collected.runs;
}
