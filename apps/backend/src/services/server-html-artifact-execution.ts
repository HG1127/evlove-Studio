import { targetProxyCapabilities } from "../server-env";
import { runVercelSandboxHtmlValidation } from "@evolution/adapters/sandbox";
import type { Candidate, EvolveProject, SourceArtifact, TargetRunResult, TestCase } from "@evolution/contracts";
import { trustedServerBaselineChampion } from "@evolution/harness";
import { readServerCandidateParentText, serverArtifactSha256 } from "./server-experiment-artifacts";
import { resolveServerTestTargetArtifact } from "./server-http-target-execution";
import { attachServerVisualEvidence } from "./server-visual-evidence";

export function serverHtmlArtifactTargetEnabled(project: EvolveProject, config = { httpRunConfigured: targetProxyCapabilities().runConfigured }) {
  const targets = project.sourceArtifacts.filter((source) => source.role === "target");
  const target = project.targetConnection;
  const fileRoute = target?.adapter === "artifact" || (target?.adapter === "http" && target.status === "connected"
    && target.connectionId === "runner-gateway" && !config.httpRunConfigured);
  return fileRoute && targets.length > 0 && targets.every((source) => /^(html|htm)$/i.test(source.extension));
}
function unavailable(testCase: TestCase, message: string): TargetRunResult {
  return { testCaseId: testCase.id, output: `UNVERIFIED：Server HTML Sandbox 未完成：${message}`, verificationStatus: "unverified", cost: 0, latencyMs: 0, trace: [{ id: `html-sandbox-${testCase.id}`, stage: "external-runner", status: "warning", summary: "原 HTML 隔离浏览器证据未完成", detail: message }] };
}

/** Production Baseline, Candidate and paired Hidden execution share this byte path. */
export async function runServerHtmlArtifactBatch(project: EvolveProject, testCases: TestCase[], candidate?: Candidate): Promise<TargetRunResult[]> {
  const groups = new Map<string, { source: SourceArtifact; cases: TestCase[] }>();
  const ordered = new Map<string, TargetRunResult>();
  for (const testCase of testCases) {
    try {
      const source = resolveServerTestTargetArtifact(project, testCase);
      if (!source || !/^(html|htm)$/i.test(source.extension)) throw new Error("本题没有唯一的 HTML Target。");
      const group = groups.get(source.id) ?? { source, cases: [] };
      group.cases.push(testCase);
      groups.set(source.id, group);
    } catch (error) { ordered.set(testCase.id, unavailable(testCase, error instanceof Error ? error.message : String(error))); }
  }
  for (const { source, cases } of groups.values()) {
    try {
      const parent = candidate ?? trustedServerBaselineChampion(project);
      if (project.searchChampion && !parent) throw new Error("当前 Search Champion 没有可信冻结文件，禁止回退原 Source。");
      const text = await readServerCandidateParentText(project, source, parent);
      const html = new TextEncoder().encode(text);
      const expectedSha256 = await serverArtifactSha256(html);
      const response = await runVercelSandboxHtmlValidation({
        id: `${project.id}-${parent?.id ?? "source"}-${source.id}`,
        html, expectedSha256, testCases: cases,
      });
      if(response.artifactHash !== expectedSha256 || response.results.some((run) => run.artifactHash !== expectedSha256)) throw new Error("Sandbox HTML 文件 hash 与实际执行输入不一致。");
      const expectedIds = new Set(cases.map((testCase) => testCase.id));
      const seen = new Set<string>();
      for (const run of response.results) {
        if (!expectedIds.has(run.testCaseId) || seen.has(run.testCaseId)) throw new Error("Sandbox 返回额外或重复 Test Case 身份。");
        seen.add(run.testCaseId);
        ordered.set(run.testCaseId, run);
      }
      for (const testCase of cases) if (!seen.has(testCase.id)) ordered.set(testCase.id, unavailable(testCase, "Sandbox 未返回本题结果。"));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      for (const testCase of cases) ordered.set(testCase.id, unavailable(testCase, message));
    }
  }
  const runs = testCases.map((testCase) => ordered.get(testCase.id) ?? unavailable(testCase, "未执行本题。"));
  return attachServerVisualEvidence(project, testCases, runs);
}
