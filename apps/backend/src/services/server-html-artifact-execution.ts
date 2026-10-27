import { runVercelSandboxHtmlValidation } from "@evolution/adapters/sandbox";
import type { Candidate, EvolveProject, SourceArtifact, TargetRunResult, TestCase } from "@evolution/contracts";
import { trustedServerBaselineChampion } from "@evolution/harness";
import { readServerCandidateParentText, serverArtifactSha256 } from "./server-experiment-artifacts";
import {resolveTestTargetArtifact as resolveServerTestTargetArtifact,fastHash} from "@evolution/core";
import { attachServerVisualEvidence } from "./server-visual-evidence";
import {assertServerControlExecutionActive,ServerControlExecutionStoppedError} from "./server-control-execution";

export function serverHtmlArtifactTargetEnabled(project: EvolveProject) {
  const targets = project.sourceArtifacts.filter((source) => source.role === "target");
  return project.targetConnection?.adapter === "artifact" && targets.length > 0 && targets.some((source) => /^(html|htm)$/i.test(source.extension));
}
function unavailable(testCase: TestCase, message: string): TargetRunResult {
  return { testCaseId: testCase.id, output: `UNVERIFIED：Server HTML Sandbox 未完成：${message}`, verificationStatus: "unverified", cost: 0, latencyMs: 0, trace: [{ id: `html-sandbox-${testCase.id}`, stage: "external-runner", status: "warning", summary: "原 HTML 隔离浏览器证据未完成", detail: message }] };
}

/**
 * Only a failed actual assertion on the exact Original can be verified
 * as negative product evidence. A crashed/unavailable Browser is NOT proof.
 * Candidate failures are never promoted by this original-only adapter.
 */
export function observedOriginalHtmlBrowserDefect(
  run:TargetRunResult,expectedSha256:string,
  proof:{previewHealthy?:boolean;browserRuntime?:string},
):TargetRunResult|undefined {
  if(run.verificationStatus!=="failed"||!run.error||!run.output
    ||run.artifactHash!==expectedSha256
    ||!proof.previewHealthy||proof.browserRuntime!=="snapshot"
    ||!run.output.includes("Blocked external resources: none")
    ||!run.trace.some(t=>t.stage==="sandbox-artifact"&&t.status==="pass")
    ||!run.trace.some(t=>t.stage==="browser-preview"&&t.status==="pass"))return undefined;
  const failed=run.trace.filter(t=>t.stage==="browser-step"&&t.status==="fail");
  const allowed=/^(?:Error: )?(?:元素不可见|文本断言未通过|数量断言未通过)：/;
  if(failed.length!==1||!failed[0]?.detail
    ||!allowed.test(failed[0].detail)
    ||!run.error.includes(failed[0].detail.replace(/^Error:\s*/,"")))return undefined;
  const observed={...run};
  delete observed.error;
  return {
    ...observed,
    output:[
      "VERIFIED DOCUMENTED BASELINE DEFECT (not product success)",
      "Exact Original HTML SHA-256: "+expectedSha256,
      "Observed cloud Chromium assertion: "+failed[0].detail,
      run.output,
    ].join("\n"),
    verificationStatus:"verified",
    trace:[...run.trace,{
      id:"original-cloud-html-defect-"+run.testCaseId,
      stage:"baseline-exact-browser-negative-evidence",
      status:"pass",
      summary:"真实云端 Chromium 已运行，原版行为断言失败已被证明；不是 Candidate PASS",
      detail:"Original SHA-256: "+expectedSha256+"；"+failed[0].detail,
    }],
  };
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
      await assertServerControlExecutionActive(project.id);
      const response = await runVercelSandboxHtmlValidation({
        id: `${project.id}-${parent?.id ?? "source"}-${source.id}-${fastHash(cases)}`,
        html, expectedSha256, testCases: cases,
      });
      if(response.artifactHash !== expectedSha256 || response.results.some((run) => run.artifactHash !== expectedSha256)) throw new Error("Sandbox HTML 文件 hash 与实际执行输入不一致。");
      const expectedIds = new Set(cases.map((testCase) => testCase.id));
      const seen = new Set<string>();
      for (const run of response.results) {
        if (!expectedIds.has(run.testCaseId) || seen.has(run.testCaseId)) throw new Error("Sandbox 返回额外或重复 Test Case 身份。");
        seen.add(run.testCaseId);
        const baselineObservation=!candidate
          ?observedOriginalHtmlBrowserDefect(run,expectedSha256,response)
          :undefined;
        ordered.set(run.testCaseId,baselineObservation??run);
      }
      for (const testCase of cases) if (!seen.has(testCase.id)) ordered.set(testCase.id, unavailable(testCase, "Sandbox 未返回本题结果。"));
    } catch (error) {
      if(error instanceof ServerControlExecutionStoppedError)throw error;
      const message = error instanceof Error ? error.message : String(error);
      for (const testCase of cases) ordered.set(testCase.id, unavailable(testCase, message));
    }
  }
  const runs = testCases.map((testCase) => ordered.get(testCase.id) ?? unavailable(testCase, "未执行本题。"));
  return attachServerVisualEvidence(project, testCases, runs);
}
