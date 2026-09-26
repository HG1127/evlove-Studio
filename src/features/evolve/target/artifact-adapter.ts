import { htmlCandidateGuard } from "../runtime/html-candidate-guard";
import { htmlFileEvidence } from "../runtime/html-file-evidence";
import {runVisualCase} from "../runtime/visual-case";
import {readFrozenArtifact} from "../runtime/frozen-artifact";
import { ExecuteArtifactAiResultSchema, ExecuteArtifactBatchAiResultSchema } from "../ai/schemas";
import { runEvolveAi } from "../ai/service";
import { citesHistoricalEvidence } from "../evaluation/service";
import { retrieveTextContext } from "../runtime/context-retrieval";
import { runRoundtripEvidence, runStaticEvidence } from "../runtime/static-evidence";
import { runServerSandboxTargetBatch } from "../runtime/sandbox-target-client";
import type { TargetRunResult } from "../schemas";
import type { TargetAdapter } from "./types";

export function semanticEvidenceStatus(output: string): TargetRunResult["verificationStatus"] {
  if (!output.trim() || /^\s*UNVERIFIED\b/i.test(output) || citesHistoricalEvidence(output)) return "unverified";
  if (/\bUNVERIFIED\b/i.test(output)) return "partial";
  return "verified";
}

function artifactContext(project: Parameters<TargetAdapter["run"]>[0]["project"], query: string, hasCandidateSnapshot: boolean) {
  return project.sourceArtifacts.map((artifact) => ({
    id: artifact.id,
    name: artifact.name,
    role: artifact.role,
    mimeType: artifact.mimeType,
    artifactKind: artifact.artifactKind,
    evidenceRole: hasCandidateSnapshot && artifact.role === "target" ? "original-reference-only" : "current-target",
    structure: artifact.structure,
    // Candidate run already carries the evolved full target. Do not resend the full original
    // target on every test; keep only metadata/compact evidence for regression reference.
    textContent: hasCandidateSnapshot && artifact.role === "target"
      ? retrieveTextContext(artifact.textContent, query, { maxChars: 6000, maxChunks: 2 })
      : retrieveTextContext(artifact.textContent, query, { maxChars: artifact.role === "target" ? 24000 : 9000, maxChunks: artifact.role === "target" ? 6 : 3 }),

    openaiFileId: artifact.openaiFileId,
  }));
}

function candidateArtifactContext(project: Parameters<TargetAdapter["run"]>[0]["project"], variant: Parameters<TargetAdapter["run"]>[0]["variant"], query: string) {
  if (!variant?.artifactSnapshots?.length) return undefined;
  return variant.artifactSnapshots.map((artifact) => ({
    id: artifact.sourceArtifactId,
    snapshotId: artifact.id,
    name: artifact.name,
    role: "target",
    mimeType: artifact.mimeType,
    artifactKind: project.sourceArtifacts.find((source)=>source.id===artifact.sourceArtifactId)?.artifactKind,
    // Long artifacts are retrieved against the concrete test instead of sending 100k chars per call.
    textContent: retrieveTextContext(artifact.content, query, { maxChars: 28000, maxChunks: 7 }),
    contentHash: artifact.contentHash,
    buildMode: artifact.buildMode,
    originalLength: artifact.content.length,
    excerptOnly: artifact.content.length > 28000,
  }));
}



function unavailableResult(testCase: Parameters<TargetAdapter["run"]>[0]["testCase"]): TargetRunResult | undefined {
  if (testCase.executionMode === "external-runner" || testCase.executionMode === "visual-review" || testCase.executionMode === "manual") {
    return {
      testCaseId: testCase.id, output: `UNVERIFIED：当前 AI Artifact Runtime 不能提供 ${testCase.executionMode} 级证据。该项不会伪装成真实执行结果；请连接 HTTP Target Runner / 视觉审查 / 人工验收后再升级证据等级。`,
      latencyMs: 1, cost: 0, verificationStatus: "unverified",
      trace: [{ id: `unverified-${testCase.id}`, stage: testCase.executionMode, summary: "当前运行时缺少对应真实证据能力", status: "warning", detail: "未执行，不把模拟结果当作真实验证" }],
    };
  }
  return undefined;
}

async function runLocalEvidence(project: Parameters<TargetAdapter["run"]>[0]["project"], testCase: Parameters<TargetAdapter["run"]>[0]["testCase"],variant?:Parameters<TargetAdapter["run"]>[0]["variant"]) {
  const originalProject = project;
  if (!variant && testCase.criterionIds.length > 0 && testCase.criterionIds.every((id) => id === "SYS-PAIRWISE")) return { testCaseId: testCase.id, output: "BASELINE NOT APPLICABLE: 原版是比较起点；相对原版改进只能在候选实验中验证。", latencyMs: 0, cost: 0, trace: [], verificationStatus: "unverified" as const };
  if(testCase.executionMode==="visual-review")return runVisualCase(project,testCase,variant);
  if(variant){
    if(testCase.executionMode==="roundtrip"){
      try{for(const snapshot of variant.artifactSnapshots)await readFrozenArtifact(snapshot.frozenArtifact,snapshot.content);if(!variant.artifactSnapshots.length)throw new Error("缺少文件");return {testCaseId:testCase.id,output:JSON.stringify(variant.artifactSnapshots.map(s=>s.frozenArtifact)),latencyMs:0,cost:0,verificationStatus:"verified" as const,trace:[]};}
      catch(error){return {testCaseId:testCase.id,output:String(error),latencyMs:0,cost:0,verificationStatus:"unverified" as const,trace:[]};}
    }
    project={...project,sourceArtifacts:project.sourceArtifacts.map(a=>{const snapshot=variant.artifactSnapshots.find(s=>s.sourceArtifactId===a.id);if(!snapshot)return a;let structuredContent;try{structuredContent=JSON.parse(snapshot.content);}catch{/* text */}return {...a,textContent:snapshot.content,textExcerpt:snapshot.content.slice(0,1600),structuredContent};})};
  }
  if (testCase.executionMode === "artifact-runtime") {
    const criteria = project.acceptanceRubric.filter((criterion) => testCase.criterionIds.includes(criterion.id));
    if (criteria.length && criteria.every((criterion) => criterion.validationMethod === "semantic-judge" || criterion.validationMethod === "static-structure")) {
      const file = htmlFileEvidence(project, testCase);
      if (file) {
        if (variant) file.output += `\nFULL FILE PROTECTION COMPARISON\n${JSON.stringify(htmlCandidateGuard(originalProject, variant.artifactSnapshots))}\nThese observations compare complete original and candidate files. Missing excerpts are not protection failures. Unresolved scopes remain unverified, not fabricated failure.`;
        return file;
      }
    }
  }
  if (testCase.executionMode === "static-evidence") return runStaticEvidence(project, testCase);
  if (testCase.executionMode === "roundtrip") return runRoundtripEvidence(project, testCase);
  return unavailableResult(testCase);
}

function codebaseTarget(project:Parameters<TargetAdapter["run"]>[0]["project"]){
  return project.sourceArtifacts.find((artifact)=>
    artifact.role==="target"
    && (artifact.artifactKind==="codebase"
      || artifact.extension.toLowerCase()==="zip"
      || artifact.artifactDescriptor?.family==="codebase"
      || artifact.artifactDescriptor?.family==="package"));
}

async function runSandboxCases(
  project:Parameters<TargetAdapter["run"]>[0]["project"],
  testCases:Parameters<NonNullable<TargetAdapter["runBatch"]>>[0]["testCases"],
  variant?:Parameters<TargetAdapter["run"]>[0]["variant"],
){
  const cases=testCases.filter((testCase)=>testCase.executionMode==="external-runner");
  if(!cases.length)return undefined;
  const source=codebaseTarget(project);
  if(!source)return undefined;

  const snapshot=variant?.artifactSnapshots.find((item)=>item.sourceArtifactId===source.id);
  if(variant&&!snapshot?.frozenArtifact){
    return cases.map((testCase):TargetRunResult=>({
      testCaseId:testCase.id,
      output:"UNVERIFIED：Candidate 工程尚未冻结为实际 ZIP，不能送入 Vercel Sandbox 执行。",
      latencyMs:0,cost:0,verificationStatus:"unverified",
      trace:[{id:"sandbox-missing-frozen",stage:"sandbox-binding",summary:"缺少 Candidate frozenArtifact",status:"warning"}],
    }));
  }

  try{
    const response=await runServerSandboxTargetBatch({
      projectId:project.id,
      sourceArtifactId:source.id,
      artifactBlobId:variant?snapshot!.frozenArtifact!.blobId:source.id,
      artifactSha256:variant?snapshot!.frozenArtifact!.sha256:undefined,
      candidateId:variant?.id,
      testCases:cases,
    });
    return response.results;
  }catch(error){
    const message=error instanceof Error?error.message:String(error);
    return cases.map((testCase):TargetRunResult=>({
      testCaseId:testCase.id,
      output:"UNVERIFIED：Vercel Sandbox 暂未完成本题执行。"+message,
      latencyMs:0,cost:0,verificationStatus:"unverified",
      trace:[{id:"sandbox-unavailable",stage:"sandbox-runtime",summary:"Sandbox 执行未完成",status:"warning",detail:message}],
    }));
  }
}

export const artifactTargetAdapter: TargetAdapter = {
  name: "AI Artifact Runtime",
  live: false,
  async run({ project, testCase, variant }) {
    if (variant && !variant.artifactSnapshots?.length) throw new Error("候选缺少实际成果快照，不能根据方案说明模拟验收");
    if(testCase.executionMode==="external-runner"){
      const sandbox=await runSandboxCases(project,[testCase],variant);
      if(sandbox?.[0])return sandbox[0];
    }
    const local = await runLocalEvidence(project, testCase,variant);
    if (local) return local;
    const started = Date.now();
    const query = `${testCase.title} ${testCase.input} ${testCase.expected.join(" ")} ${testCase.criterionIds.join(" ")}`;
    const hasCandidateSnapshot = Boolean(variant?.artifactSnapshots?.length);
    const result = ExecuteArtifactAiResultSchema.parse(await runEvolveAi("execute-artifact", {
      project: {
        aiProfile:project.aiProfile,
        name: project.name,
        objectType: project.objectType,
        goal: project.goal,

        protectedItems: project.protectedItems,
        editableItems: project.editableItems,

        sourceArtifacts: artifactContext(project, query, hasCandidateSnapshot),
        candidateArtifacts: candidateArtifactContext(project, variant, query),
      },
      testCase,
      evidenceInstruction: variant ? "Inspect this snapshot only." : "Establish an observation of the original file, not proof of improvement. If a requirement needs a future candidate, describe the original state and do not pretend a candidate exists. For missing evidence say what was checked and what cannot be checked; never return a bare UNVERIFIED with no explanation. For document tutorials, assess the supplied content; do not require real cloud deployment to prove that written steps exist.",
      variant: variant ? { id: variant.id, artifactSnapshots: variant.artifactSnapshots?.map((artifact) => ({ id: artifact.id, sourceArtifactId: artifact.sourceArtifactId, name: artifact.name, mimeType: artifact.mimeType, contentHash: artifact.contentHash, buildMode: artifact.buildMode })) } : null,
    }));
    return {
      testCaseId: testCase.id,
      output: result.output,
      latencyMs: Math.max(300, Date.now() - started),
      cost: variant ? 0.04 : 0.03,
      trace: [{ id: `ai-semantic-${testCase.id}`, stage: "AI 语义核查", summary: "模型读取同一成果快照并按本题标准定位显性内容", status: "info", detail: "可证明内容存在、缺失或相互矛盾；不等同于浏览器 E2E、视觉审查或真人实操" }, ...result.trace],
      verificationStatus: semanticEvidenceStatus(result.output),
    };
  },
  async runBatch({ project, testCases, variant }) {
    if (variant && !variant.artifactSnapshots?.length) throw new Error("候选缺少实际成果快照，不能根据方案说明模拟验收");
    const ordered = new Map<string, TargetRunResult>();
    const sandboxCases=testCases.filter((testCase)=>testCase.executionMode==="external-runner");
    if(sandboxCases.length){
      const sandbox=await runSandboxCases(project,sandboxCases,variant);
      for(const result of sandbox??[])ordered.set(result.testCaseId,result);
    }
    const aiCases: typeof testCases = [];
    for (const testCase of testCases) {
      if(ordered.has(testCase.id))continue;
      const local = await runLocalEvidence(project, testCase,variant);
      if (local) ordered.set(testCase.id, local); else aiCases.push(testCase);
    }
    if (aiCases.length) {
      const started = Date.now();
      const combinedQuery = aiCases.map((testCase) => `${testCase.title} ${testCase.input} ${testCase.expected.join(" ")} ${testCase.criterionIds.join(" ")}`).join("\n---\n");
      const hasCandidateSnapshot = Boolean(variant?.artifactSnapshots?.length);
      const result = ExecuteArtifactBatchAiResultSchema.parse(await runEvolveAi("execute-artifact-batch", {
        project: {
          aiProfile: project.aiProfile,
          name: project.name,
          objectType: project.objectType,
          goal: project.goal,
  
          protectedItems: project.protectedItems,
          editableItems: project.editableItems,
  
          sourceArtifacts: artifactContext(project, combinedQuery, hasCandidateSnapshot),
          candidateArtifacts: candidateArtifactContext(project, variant, combinedQuery),
        },
        testCases: aiCases.map((testCase) => ({ id: testCase.id, title: testCase.title, input: testCase.input, expected: testCase.expected, criterionIds: testCase.criterionIds, evidenceScope: testCase.evidenceScope })),
        variant: variant ? { id: variant.id, artifactSnapshots: variant.artifactSnapshots?.map((artifact) => ({ id: artifact.id, sourceArtifactId: artifact.sourceArtifactId, name: artifact.name, mimeType: artifact.mimeType, contentHash: artifact.contentHash, buildMode: artifact.buildMode })) } : null,
      }));
      const totalLatency = Math.max(300, Date.now() - started);
      const latencyPerCase = Math.max(1, Math.round(totalLatency / Math.max(1, aiCases.length)));
      const byId = new Map(result.results.map((item) => [item.testCaseId, item]));
      for (const testCase of aiCases) {
        const item = byId.get(testCase.id);
        ordered.set(testCase.id, item ? {
          testCaseId: testCase.id,
          output: item.output,
          latencyMs: latencyPerCase,
          cost: variant ? 0.04 : 0.03,
          trace: [{ id: `ai-semantic-${testCase.id}`, stage: "AI 语义核查", summary: "模型读取同一成果快照并按本题标准定位显性内容", status: "info", detail: "可证明内容存在、缺失或相互矛盾；不等同于浏览器 E2E、视觉审查或真人实操" }, ...item.trace],
          verificationStatus: semanticEvidenceStatus(item.output),
        } : {
          testCaseId: testCase.id,
          output: "UNVERIFIED：批量执行器未返回本题结果",
          latencyMs: latencyPerCase,
          cost: 0,
          trace: [],
          error: "batch executor missing result",
          verificationStatus: "unverified",
        });
      }
    }
    return testCases.map((testCase) => ordered.get(testCase.id)!).filter(Boolean);
  },
  async release({ action }) {
    const traffic = action === "shadow" ? 0 : action === "canary-5" ? 5 : action === "canary-20" ? 20 : action === "canary-50" ? 50 : action === "promote" ? 100 : 0;
    return {
      ok: true,
      evidenceMode: "simulation",
      trafficPercent: traffic,
      healthy: action !== "rollback",
      note: action === "rollback" ? "离线 Artifact Runtime 已恢复上一 Champion 快照" : `离线 Artifact Runtime 模拟推进到 ${action}；不能作为线上发布证据`,
      kpis: [
        { key: "online-success", label: "线上成功率", value: action === "rollback" ? 84 : 92, unit: "%", target: 90, direction: "higher" },
        { key: "online-quality", label: "目标质量达成率", value: action === "rollback" ? 78 : 91, unit: "%", target: 90, direction: "higher" },
        { key: "online-cost", label: "平均成本", value: action === "rollback" ? 0.52 : 0.38, unit: "¥", target: 0.5, direction: "lower" },
      ],
    };
  },
};
