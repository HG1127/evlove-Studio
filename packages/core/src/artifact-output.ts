import type {
  ArtifactAcceptance,
  Candidate,
  EvolveProject,
  OutputArtifact,
} from "@evolution/contracts";
import { deliveryReadiness } from "./delivery-readiness";
import { hasExactFrozenArtifactSet } from "./artifact-identity";
import { evidenceFingerprint } from "./evidence-binding";

export function acceptanceArtifacts(
  project:EvolveProject,
  candidate:Candidate,
  acceptance:ArtifactAcceptance,
  createdAt=new Date().toISOString(),
):OutputArtifact[]{
  const champion=project.searchChampion;
  const versionLabel=champion?.versionLabel||project.version;
  const validation=champion?.candidate?.id===candidate.id?champion.validation:project.validationRun;
  const binding=evidenceFingerprint(project,candidate);
  const canDeliver=acceptance.evidenceFingerprint===binding
    && validation?.evidenceFingerprint===binding
    && acceptance.status==="passed"
    && acceptance.hardGatePass
    && acceptance.candidateId===candidate.id
    && validation?.candidateId===candidate.id
    && validation.status==="completed"
    && validation.recommendation==="release"
    && !validation.evaluation?.demoJudged
    && hasExactFrozenArtifactSet(project,candidate,acceptance);

  const primary:OutputArtifact[]=candidate.artifactSnapshots.map((artifact,index)=>({
    id:`accepted-primary-${candidate.id}-${index}`,
    projectId:project.id,
    round:champion?.round??project.campaign.currentRound,
    versionLabel,
    candidateId:candidate.id,
    name:artifact.name.startsWith("evolved-")?artifact.name:`evolved-${artifact.name}`,
    mimeType:artifact.mimeType,
    kind:"primary",
    content:artifact.content,
    description:`Gate F · Artifact Ready 已通过的真实 Candidate Artifact Snapshot。Hash: ${artifact.contentHash||"n/a"}`,
    sourceArtifactIds:[artifact.sourceArtifactId],
    isChampion:true,
    frozenArtifact:acceptance.frozenArtifacts?.find((item)=>item.sourceArtifactId===artifact.sourceArtifactId),
    accepted:canDeliver,
    createdAt,
  }));

  const acceptanceReport:OutputArtifact={
    id:`acceptance-report-${candidate.id}`,
    projectId:project.id,
    round:champion?.round??project.campaign.currentRound,
    versionLabel,
    candidateId:candidate.id,
    name:"ARTIFACT_ACCEPTANCE_REPORT.json",
    mimeType:"application/json",
    kind:"acceptance-report",
    content:JSON.stringify(acceptance,null,2),
    description:"Gate F 最终成果验收报告：逐条 Requirement Coverage、Protected Constraints、Integrity、Pairwise Improvement。",
    sourceArtifactIds:[],
    isChampion:true,
    accepted:canDeliver,
    createdAt,
  };

  const requirementMatrix:OutputArtifact={
    id:`requirement-matrix-${candidate.id}`,
    projectId:project.id,
    round:champion?.round??project.campaign.currentRound,
    versionLabel,
    candidateId:candidate.id,
    name:"REQUIREMENT_COVERAGE.md",
    mimeType:"text/markdown",
    kind:"requirement-matrix",
    content:`# Requirement Coverage\n\n${project.acceptanceRubric.map((criterion)=>{
      const result=acceptance.results.find((item)=>item.criterionId===criterion.id);
      return `- ${result?.pass?"✅":"❌"} **${criterion.id} · ${criterion.title}** — ${result?.score??0}/100${criterion.hardGate?" · HARD GATE":""}\n  - Requirement: ${criterion.requirement}\n  - Evidence: ${(result?.evidence??[]).join("；")||"无"}\n  - Gaps: ${(result?.gaps??[]).join("；")||"无"}`;
    }).join("\n")}`,
    description:"用户原始进化要求到最终成果的逐项覆盖矩阵。",
    sourceArtifactIds:[],
    isChampion:true,
    accepted:canDeliver,
    createdAt,
  };
  return [...primary,acceptanceReport,requirementMatrix];
}

export function materializeChampionOutputs(
  project:EvolveProject,
  createdAt=new Date().toISOString(),
):OutputArtifact[]{
  const champion=project.searchChampion;
  if(!champion)return[];
  if(!champion.candidate||!champion.validation||!champion.artifactAcceptance)return[];
  const settled={
    ...project,
    candidates:[champion.candidate,...project.candidates.filter((item)=>item.id!==champion.candidate!.id)],
    experimentRun:{...project.experimentRun,winnerId:champion.candidate.id},
    validationRun:champion.validation,
    artifactAcceptance:champion.artifactAcceptance,
  };
  if(!deliveryReadiness(settled).ready)return[];

  const primary=(champion.candidate.artifactSnapshots??[]).map((artifact,index):OutputArtifact=>({
    id:`output-primary-${champion.id}-${index}`,
    projectId:project.id,
    round:champion.round,
    versionLabel:champion.versionLabel,
    candidateId:champion.candidate?.id,
    name:artifact.name,
    mimeType:artifact.mimeType,
    kind:"primary",
    content:artifact.content,
    description:`历史最佳 ${champion.versionLabel} 的实际候选文件；下载使用验收时冻结的字节。`,
    sourceArtifactIds:[artifact.sourceArtifactId],
    frozenArtifact:champion.artifactAcceptance?.frozenArtifacts?.find((item)=>item.sourceArtifactId===artifact.sourceArtifactId),
    isChampion:true,
    accepted:champion.artifactAcceptance?.status==="passed"&&Boolean(champion.artifactAcceptance.frozenArtifacts?.some((item)=>item.sourceArtifactId===artifact.sourceArtifactId)),
    createdAt,
  }));

  const manifest={
    projectId:project.id,
    projectName:project.name,
    sourceVersion:project.version,
    searchChampion:champion,
    campaign:project.campaign,
    roundHistory:project.roundHistory,
    sourceArtifacts:project.sourceArtifacts.map((source)=>({
      id:source.id,name:source.name,role:source.role,artifactKind:source.artifactKind,extension:source.extension,
    })),
    generatedAt:createdAt,
  };
  const scorecard=champion.evaluation??null;
  const releaseNotes=`# ${project.name} · ${champion.versionLabel}\n\n## Why this version\n${champion.reason}\n\n## Fitness\n${champion.score.toFixed(2)}\n\n## Evolution rounds\n${project.roundHistory.length}\n\n## Patches\n${champion.patches.map((patch)=>`- **${patch.component}/${patch.target}** — ${patch.rationale}`).join("\n")||"- No structured patches"}\n`;
  const searchSummary=`# Evolution Search Summary\n\n- Champion: ${champion.versionLabel}\n- Best score: ${champion.score.toFixed(2)}\n- Rounds: ${project.roundHistory.length}\n- Archive size: ${project.evolutionArchive.length}\n- Parent strategy: ${project.campaign.parentStrategy}\n- Stop reason: ${project.campaign.stopReason??"manual/materialized"}\n\n## Round history\n${project.roundHistory.map((round)=>`- Round ${round.round}: winner=${round.winnerCandidateId??"none"}, score=${round.winnerScore?.toFixed(2)??"n/a"}, improvement=${round.improvement.toFixed(2)}, championChanged=${round.championChanged}`).join("\n")}`;

  const extra:OutputArtifact[]=[
    {id:`output-manifest-${champion.id}`,projectId:project.id,round:champion.round,versionLabel:champion.versionLabel,candidateId:champion.candidate.id,name:"evolution-manifest.json",mimeType:"application/json",kind:"manifest",content:JSON.stringify(manifest,null,2),description:"完整版本、输入、轮次、血缘与 Campaign 配置。",sourceArtifactIds:project.sourceArtifacts.map((artifact)=>artifact.id),isChampion:true,accepted:champion.artifactAcceptance.status==="passed",createdAt},
    {id:`output-score-${champion.id}`,projectId:project.id,round:champion.round,versionLabel:champion.versionLabel,candidateId:champion.candidate.id,name:"champion-scorecard.json",mimeType:"application/json",kind:"scorecard",content:JSON.stringify(scorecard,null,2),description:"Search Champion 在 Hidden Validation 上的评测成绩。",sourceArtifactIds:[],isChampion:true,accepted:champion.artifactAcceptance.status==="passed",createdAt},
    {id:`output-patches-${champion.id}`,projectId:project.id,round:champion.round,versionLabel:champion.versionLabel,candidateId:champion.candidate.id,name:"champion-patches.json",mimeType:"application/json",kind:"patch-bundle",content:JSON.stringify(champion.patches,null,2),description:"可供后端 Target Adapter / Git Patch Builder 执行的结构化 Patch Bundle。",sourceArtifactIds:project.sourceArtifacts.map((artifact)=>artifact.id),isChampion:true,accepted:champion.artifactAcceptance.status==="passed",createdAt},
    {id:`output-notes-${champion.id}`,projectId:project.id,round:champion.round,versionLabel:champion.versionLabel,candidateId:champion.candidate.id,name:"RELEASE_NOTES.md",mimeType:"text/markdown",kind:"release-notes",content:releaseNotes,description:"本轮最佳版本选择原因、评分和改动摘要。",sourceArtifactIds:[],isChampion:true,accepted:champion.artifactAcceptance.status==="passed",createdAt},
    {id:`output-lineage-${champion.id}`,projectId:project.id,round:champion.round,versionLabel:champion.versionLabel,candidateId:champion.candidate.id,name:"evolution-lineage.json",mimeType:"application/json",kind:"lineage",content:JSON.stringify(project.evolutionArchive,null,2),description:"Champion、Elites、Stepping Stones 与 Failure Archive 的完整血缘。",sourceArtifactIds:[],isChampion:true,accepted:champion.artifactAcceptance.status==="passed",createdAt},
    {id:`output-summary-${champion.id}`,projectId:project.id,round:champion.round,versionLabel:champion.versionLabel,candidateId:champion.candidate.id,name:"SEARCH_SUMMARY.md",mimeType:"text/markdown",kind:"search-summary",content:searchSummary,description:"多轮进化搜索摘要，便于复盘和继续人工/AI优化。",sourceArtifactIds:[],isChampion:true,accepted:champion.artifactAcceptance.status==="passed",createdAt},
  ];
  return [...primary,...extra];
}

export function materializeAcceptedChampionPackage(
  project:EvolveProject,
  createdAt=new Date().toISOString(),
):OutputArtifact[]{
  const champion=project.searchChampion;
  if(!champion?.candidate)throw new Error("还没有 Search Champion，无法生成进化成果物");
  if(champion.artifactAcceptance?.status!=="passed")throw new Error("Search Champion 尚未通过 Gate F · Artifact Ready，禁止生成正式成果包");
  if(!champion.candidate.artifactSnapshots.length)throw new Error("Search Champion 缺少已测试的 Candidate Artifact Snapshot");
  const primaryAndAcceptance=acceptanceArtifacts(project,champion.candidate,champion.artifactAcceptance,createdAt);
  if(primaryAndAcceptance.some((artifact)=>!artifact.accepted))throw new Error("Search Champion 的冻结成果身份或验证绑定不完整，禁止生成正式成果包");
  const metadata=materializeChampionOutputs(project,createdAt)
    .filter((artifact)=>artifact.kind!=="primary")
    .map((artifact)=>({...artifact,accepted:true}));
  return [...primaryAndAcceptance,...metadata];
}
