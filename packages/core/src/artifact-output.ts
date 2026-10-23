import type {
  ArtifactAcceptance,
  Candidate,
  EvolveProject,
  OutputArtifact,
} from "@evolution/contracts";
import { deliveryReadiness } from "./delivery-readiness";
import { hasExactFrozenArtifactSet } from "./artifact-identity";
import { evidenceFingerprint } from "./evidence-binding";
import { hasAuthoritativeHiddenRelease } from "./hidden-validation-evidence";
import {independentFinalReadiness} from "./independent-final-holdout";
import { assertPackageEvidenceContents, requirementCoverageContent } from "./artifact-package-evidence";

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
    && Boolean(validation&&hasAuthoritativeHiddenRelease(validation,candidate.id,project.hiddenEvalSuite,project.acceptanceRubric))
    && Boolean(validation&&independentFinalReadiness(project,candidate,validation).ready)
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
    content:requirementCoverageContent(project,acceptance),
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

/** A manually accepted Candidate may be deliverable without replacing the historical Search Champion. */
export function materializeAcceptedCandidatePackage(
  project:EvolveProject,
  candidate:Candidate,
  acceptance:ArtifactAcceptance,
  createdAt=new Date().toISOString(),
):OutputArtifact[]{
  if(project.searchChampion?.candidate?.id===candidate.id
    &&project.searchChampion.validation?.evidenceFingerprint===project.validationRun.evidenceFingerprint
    &&project.searchChampion.artifactAcceptance?.id===acceptance.id){
    return materializeAcceptedChampionPackage(project,createdAt);
  }
  if(project.experimentRun.winnerId!==candidate.id||project.validationRun.candidateId!==candidate.id
    ||project.artifactAcceptance.candidateId!==candidate.id||project.artifactAcceptance.id!==acceptance.id
    ||!deliveryReadiness(project).ready){
    throw new Error("Candidate 的 Hidden Validation 与 Gate F 冻结身份尚未一致，禁止生成交付包");
  }
  const versionLabel=project.validationRun.versionSnapshot?.label??`Accepted ${candidate.id}`;
  const round=project.campaign.currentRound;
  const accepted=acceptanceArtifacts(project,candidate,acceptance,createdAt)
    .map((artifact)=>({...artifact,round,versionLabel,isChampion:false}));
  if(accepted.some((artifact)=>!artifact.accepted)){
    throw new Error("Candidate 的冻结成果身份或验证绑定不完整，禁止生成交付包");
  }
  const base={projectId:project.id,round,versionLabel,candidateId:candidate.id,
    sourceArtifactIds:[] as string[],isChampion:false,accepted:true,createdAt};
  const manifest={
    packageKind:"accepted-candidate",
    projectId:project.id,
    candidateId:candidate.id,
    validationId:project.validationRun.id,
    acceptanceId:acceptance.id,
    evidenceFingerprint:project.validationRun.evidenceFingerprint,
    currentSearchChampionId:project.searchChampion?.id,
    frozenArtifacts:acceptance.frozenArtifacts,
    generatedAt:createdAt,
  };
  const metadata:OutputArtifact[]=[
    {...base,id:`candidate-manifest-${candidate.id}`,name:"candidate-manifest.json",mimeType:"application/json",kind:"manifest",
      content:JSON.stringify(manifest,null,2),description:"本次验收候选的版本与冻结成果身份。"},
    {...base,id:`candidate-score-${candidate.id}`,name:"candidate-scorecard.json",mimeType:"application/json",kind:"scorecard",
      content:JSON.stringify(project.validationRun.evaluation??null,null,2),description:"本次候选在 Hidden Validation 上的评测结果。"},
    {...base,id:`candidate-patches-${candidate.id}`,name:"candidate-patches.json",mimeType:"application/json",kind:"patch-bundle",
      content:JSON.stringify(candidate.patches,null,2),description:"本次验收候选的结构化修改。"},
    {...base,id:`candidate-notes-${candidate.id}`,name:"RELEASE_NOTES.md",mimeType:"text/markdown",kind:"release-notes",
      content:`# ${project.name} · ${versionLabel}\n\n本次交付的是通过 Hidden Validation 和 Gate F 的 Candidate ${candidate.id}。\n历史 Search Champion ${project.searchChampion?.versionLabel??"尚未建立"} 未被本次验收替换。\n`,
      description:"本次候选的交付说明与 Champion 关系。"},
  ];
  return [...accepted,...metadata];
}

/** Prevent a valid primary file from being zipped with metadata for another Candidate. */
export function assertDeliverablePackageIdentity(project:EvolveProject):string{
  const artifacts=project.outputArtifacts;
  const primary=artifacts.filter((item)=>item.kind==="primary");
  const candidateId=primary[0]?.candidateId;
  if(!candidateId||!primary.length||artifacts.some((item)=>item.projectId!==project.id
    ||item.candidateId!==candidateId||!item.accepted||item.isChampion!==primary[0]!.isChampion
    ||item.versionLabel!==primary[0]!.versionLabel||item.round!==primary[0]!.round)){
    throw new Error("成果包的主文件、验收证据与元数据候选身份不一致；请重新生成成果包");
  }
  const champion=primary[0]!.isChampion?project.searchChampion:undefined;
  if(primary[0]!.isChampion?champion?.candidate?.id!==candidateId:project.experimentRun.winnerId!==candidateId){
    throw new Error("成果包不是当前已验收版本；请重新生成成果包");
  }
  const candidate=champion?.candidate??project.candidates.find((item)=>item.id===candidateId);
  const acceptance=champion?.artifactAcceptance??project.artifactAcceptance;
  const validation=champion?.validation??project.validationRun;
  if(!candidate||!acceptance||!validation||acceptance.status!=="passed"||!acceptance.hardGatePass
    ||acceptance.candidateId!==candidateId||!hasAuthoritativeHiddenRelease(validation,candidateId,project.hiddenEvalSuite,project.acceptanceRubric)
    ||!independentFinalReadiness(project,candidate,validation).ready
    ||!hasExactFrozenArtifactSet(project,candidate,acceptance)){
    throw new Error("成果包缺少当前 Candidate 的真实 Hidden Validation 或 Gate F 冻结证据");
  }
  const binding=evidenceFingerprint(project,candidate);
  if(validation.evidenceFingerprint!==binding||acceptance.evidenceFingerprint!==binding){
    throw new Error("成果包验证指纹与当前 Candidate 不一致；请重新验收");
  }
  if(primary.length!==candidate.artifactSnapshots.length||primary.some((item)=>{
    if(item.sourceArtifactIds.length!==1)return true;
    const sourceId=item.sourceArtifactIds[0];
    const snapshot=candidate.artifactSnapshots.find((entry)=>entry.sourceArtifactId===sourceId);
    const frozen=acceptance.frozenArtifacts?.find((entry)=>entry.sourceArtifactId===sourceId);
    return !snapshot||!frozen||item.content!==snapshot.content
      ||!item.frozenArtifact||item.frozenArtifact.blobId!==frozen.blobId||item.frozenArtifact.sha256!==frozen.sha256
      ||item.frozenArtifact.snapshotHash!==frozen.snapshotHash||item.frozenArtifact.name!==frozen.name
      ||item.frozenArtifact.sourceArtifactId!==frozen.sourceArtifactId
      ||item.frozenArtifact.size!==frozen.size||item.frozenArtifact.mimeType!==frozen.mimeType;
  })){
    throw new Error("成果包主文件与当前 Candidate 的冻结 Artifact 不一致；请重新生成成果包");
  }
  assertPackageEvidenceContents({project,artifacts,candidate,champion,acceptance,validation});
  return candidateId;
}
