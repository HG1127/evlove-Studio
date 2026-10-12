import { decodeArtifactUtf8 } from "@evolution/adapters";
import { htmlFileEvidence } from "./html-file-evidence";
import type { EvolveProject, TargetRunResult, TestCase } from "../schemas";
import { retrieveTextContext } from "./context-retrieval";
import { buildRepositoryIntelligence, repositoryGoalCoverage, retrieveRepositoryEvidence, type RepositoryEntry, type RepositoryIntelligence } from "../sources/repository-intelligence";
import type { CodeFileAnalysis } from "../sources/code-analysis";

function repositoryData(artifact: EvolveProject["sourceArtifacts"][number]) {
  const value = artifact.structuredContent as {
    entries?: RepositoryEntry[];
    codeIndex?: { files?: CodeFileAnalysis[] };
    repositoryIntelligence?: RepositoryIntelligence;
  } | undefined;
  const entries = value?.entries ?? [];
  const code = value?.codeIndex?.files ?? [];
  const intelligence = value?.repositoryIntelligence ?? buildRepositoryIntelligence({ entries, codeAnalyses: code, totalEntries: artifact.structure.length });
  return { entries, code, intelligence };
}

export async function runStaticEvidence(project:EvolveProject,testCase:TestCase):Promise<TargetRunResult>{
  const html = htmlFileEvidence(project, testCase);
  if (html && testCase.evidenceScope !== "product-behavior") return html;
  const start=Date.now();
  const query=`${project.evolutionCommand}\n${testCase.title}\n${testCase.input}\n${testCase.expected.join(" ")}`;
  const evidenceBlocks: string[] = [];
  const evidencePaths = new Set<string>();
  const coverageNotes: string[] = [];
  let strongEvidenceCount = 0;
  let documentEvidenceCount = 0;

  for (const artifact of project.sourceArtifacts.filter((item)=>item.role==="target" && item.artifactKind === "codebase")) {
    const { entries, code, intelligence } = repositoryData(artifact);
    const evidence = retrieveRepositoryEvidence({ entries, codeAnalyses: code, intelligence, query, limit: 12 });
    for (const [index, item] of evidence.entries()) {
      evidencePaths.add(item.path);
      if (item.score >= 3 && item.role !== "test-evidence" && item.role !== "reference-evidence") strongEvidenceCount += 1;
      const meta = item.analysis ? `AST: imports=${item.analysis.imports.slice(0,8).join(",")||"-"}; exports=${item.analysis.exports.slice(0,8).join(",")||"-"}; functions=${item.analysis.functions.slice(0,8).join(",")||"-"}; jsx=${item.analysis.jsxTags.slice(0,8).join(",")||"-"}` : "";
      evidenceBlocks.push(`[${artifact.name}#E${index+1}] ${item.path} · role=${item.role ?? "unknown"} · relevance=${item.score}\n${meta ? `${meta}\n` : ""}${retrieveTextContext(item.content, query, {maxChars:4200,maxChunks:3})}`);
    }
    const goalCoverage = repositoryGoalCoverage({ artifact, command: project.evolutionCommand });
    coverageNotes.push(`${artifact.name}: deep-index=${Math.round(goalCoverage.deepIndexCoverage*100)}%, critical=${Math.round(goalCoverage.criticalModuleCoverage*100)}%, dependency=${Math.round(goalCoverage.dependencyCoverage*100)}%, user-goal-evidence=${Math.round(goalCoverage.requirementEvidenceCoverage*100)}%, semantic=${Math.round(goalCoverage.semanticCoverage*100)}%`);
  }

  // Non-code target artifacts can still contribute retrievable text evidence, but they are not treated
  // as code repository proof.
  for (const artifact of project.sourceArtifacts.filter((item)=>item.role==="target" && item.artifactKind !== "codebase")) {
    const context = retrieveTextContext(artifact.textContent, query, { maxChars:8000, maxChunks:3 });
    if (context) {
      evidenceBlocks.push(`[${artifact.name}] 文档/成果内容证据\n${context}`);
      documentEvidenceCount += 1;
    }
  }

  const profiles=project.sourceArtifacts.filter((a)=>a.role==="target").map((a)=>({name:a.name,engine:a.parsingProfile?.engineLabel,confidence:a.parsingProfile?.confidence,deepIndex:a.parsingProfile?.deepIndexCoverage,critical:a.parsingProfile?.criticalModuleCoverage,dependency:a.parsingProfile?.dependencyCoverage,limitations:a.parsingProfile?.limitations.slice(0,3)}));
  const implementationEvidence = strongEvidenceCount >= 2 || documentEvidenceCount > 0;
  const behaviorNeedsRunner = testCase.evidenceScope === "product-behavior";
  const verificationStatus: TargetRunResult["verificationStatus"] = !implementationEvidence ? "unverified" : behaviorNeedsRunner ? "partial" : "verified";
  const output=`STATIC / REPOSITORY EVIDENCE\n\n验收目标：${testCase.title}\n${testCase.input}\n\n用户原始进化目标：${project.evolutionCommand}\n\nRepository Evidence Files：${evidencePaths.size}\n${evidenceBlocks.join("\n\n")||"未检索到足够相关的源码/结构证据。"}\n\nRepository Coverage：\n${coverageNotes.join("\n")||"非代码成果：使用文档级相关内容检索"}\n\n解析画像：${JSON.stringify(profiles)}\n\n证据结论：${verificationStatus.toUpperCase()}。静态工程证据可以证明“实现/结构存在”，但不能证明真实浏览器交互、端到端流程或视觉体验已经通过；这些目标必须连接 External Runner / Browser / Visual Review。`;
  return {testCaseId:testCase.id,output,latencyMs:Math.max(20,Date.now()-start),cost:0,verificationStatus,trace:[{id:`static-${testCase.id}`,stage:"repository-evidence",summary:evidencePaths.size?`按用户目标定位 ${evidencePaths.size} 个相关模块（${strongEvidenceCount} 个强证据）`:"未定位到足够静态证据",status:verificationStatus==="unverified"?"warning":"pass",detail:[...evidencePaths].slice(0,16).join(", ")}]};
}

export async function runRoundtripEvidence(project:EvolveProject,testCase:TestCase):Promise<TargetRunResult>{
  const html = htmlFileEvidence(project, testCase);
  if (html) return html;
  const start=Date.now();
  const targets=project.sourceArtifacts.filter((a)=>a.role==="target");
  // Plain text has a real, deterministic same-format encoding roundtrip. Do not
  // leave it permanently partial merely because no binary materializer is involved.
  if (targets.length && targets.every((a) => /^(txt|md|markdown|csv|json|yaml|yml|css|js|ts)$/i.test(a.extension) && typeof a.textContent === "string" && a.textContent.length > 0)) {
    const details = targets.map((a) => {
      const bytes = new TextEncoder().encode(a.textContent!);
      const restored = decodeArtifactUtf8(bytes);
      return { name: a.name, format: a.extension, bytes: bytes.length, preserved: restored === a.textContent };
    });
    const preserved = details.every((item) => item.preserved);
    return { testCaseId: testCase.id, output: `TEXT FORMAT ROUNDTRIP\n${JSON.stringify(details)}\n已对当前完整文本进行 UTF-8 编码和解码并逐字比较。此证据仅证明文本字节可往返，内容质量及候选交付仍需独立验收。`, latencyMs: Date.now() - start, cost: 0, verificationStatus: preserved ? "verified" : "partial", trace: [{id: `roundtrip-${testCase.id}`, stage: "format-roundtrip", summary: preserved ? "文本实际编解码一致" : "文本编解码不一致", status: preserved ? "pass" : "warning"}] };
  }
  const details=targets.map((a)=>({name:a.name,format:a.extension,adapter:a.artifactDescriptor?.adapterId,preservation:a.artifactDescriptor?.preservationMode,materialize:a.artifactDescriptor?.capabilities.materialize,structureNodes:a.structure.length,parser:a.parsingProfile?.engineLabel,deepIndex:a.parsingProfile?.deepIndexCoverage}));
  return {testCaseId:testCase.id,output:`FORMAT / ROUNDTRIP EVIDENCE\n${JSON.stringify(details,null,2)}\n\n说明：这里验证当前成果的格式保持能力与结构索引；真正 Candidate 物化后还会在 Artifact Acceptance 再做同格式完整性验证。`,latencyMs:Math.max(10,Date.now()-start),cost:0,verificationStatus:details.every((x)=>x.materialize)?"partial":"unverified",trace:[{id:`roundtrip-${testCase.id}`,stage:"format-roundtrip",summary:"已检查原格式适配器/物化能力",status:details.every((x)=>x.materialize)?"pass":"warning",detail:details.map((x)=>`${x.name}:${x.adapter}/${x.preservation}`).join("; ")}]};
}
