import type {
  ArtifactAcceptance,
  Candidate,
  EvolveProject,
  FrozenArtifact,
  ValidationRun,
} from "@evolution/contracts";
import { evidenceFingerprint } from "./evidence-binding";
import { indexScopedAcceptanceResults } from "./acceptance-result-identity";

function validationScoreIndex(project:EvolveProject,validation:ValidationRun){
  return indexScopedAcceptanceResults([{requestedCriterionIds:project.acceptanceRubric.map((item)=>item.id),results:validation.evaluation?.criterionScores??[]}]);
}

export function verifiedValidationFailures(project:EvolveProject,validation:ValidationRun){
  const scores=validationScoreIndex(project,validation).byId;
  return project.acceptanceRubric.filter((criterion)=>{
    const score=scores.get(criterion.id);
    return score?.verificationStatus==="verified" && score.pass!==true;
  });
}

function weightedScore(project:EvolveProject,results:ArtifactAcceptance["results"],filter:(criterion:EvolveProject["acceptanceRubric"][number])=>boolean){
  const criteria=project.acceptanceRubric.filter(filter);
  const total=criteria.reduce((sum,item)=>sum+item.weight,0)||1;
  return Math.round(criteria.reduce((sum,criterion)=>sum+(results.find((item)=>item.criterionId===criterion.id)?.score??0)*criterion.weight,0)/total);
}

export function settleArtifactAcceptanceFromValidation(args:{
  project:EvolveProject;
  candidate:Candidate;
  validation:ValidationRun;
  frozenArtifacts:FrozenArtifact[];
  now?:string;
}):ArtifactAcceptance{
  const now=args.now??new Date().toISOString();
  const binding=evidenceFingerprint(args.project,args.candidate);
  const targetIds=args.project.sourceArtifacts.filter((item)=>item.role==="target").map((item)=>item.id);
  const frozenById=new Map(args.frozenArtifacts.map((item)=>[item.sourceArtifactId,item]));
  const snapshotsById=new Map(args.candidate.artifactSnapshots.map((item)=>[item.sourceArtifactId,item]));
  const allTargetsFrozen=targetIds.length>0&&targetIds.every((id)=>{
    const snapshot=snapshotsById.get(id);
    const frozen=frozenById.get(id);
    return Boolean(snapshot&&frozen&&snapshot.frozenArtifact?.sha256===frozen.sha256&&snapshot.frozenArtifact?.blobId===frozen.blobId);
  });
  const validationReusable=args.validation.status==="completed"
    && args.validation.candidateId===args.candidate.id
    && args.validation.evidenceFingerprint===binding
    && !args.validation.evaluation?.demoJudged;
  const {byId:scoreById,duplicateIds}=indexScopedAcceptanceResults([{
    requestedCriterionIds:args.project.acceptanceRubric.map((item)=>item.id),
    results:validationReusable?args.validation.evaluation?.criterionScores??[]:[],
  }]);
  const results:ArtifactAcceptance["results"]=args.project.acceptanceRubric.map((criterion)=>{
    const score=scoreById.get(criterion.id);
    if(score?.verificationStatus==="verified"){
      const pass=score.pass&&score.score>=criterion.minScore;
      return {criterionId:criterion.id,score:score.score,pass,evidence:[...score.evidence],gaps:[...score.gaps],note:"reused exact-fingerprint Hidden Validation evidence"};
    }
    return {
      criterionId:criterion.id,
      score:score?.score??0,
      pass:false,
      evidence:score?.evidence??[],
      gaps:[...(score?.gaps??[]),duplicateIds.has(criterion.id)
        ?`Criterion ${criterion.id} 存在重复 Validation 分数，证据身份不明确`
        :`Criterion ${criterion.id} 缺少 exact-fingerprint VERIFIED 证据`],
      note:"unverified Gate F evidence",
    };
  });
  const hardGatePass=args.project.acceptanceRubric.filter((item)=>item.hardGate).every((criterion)=>results.find((item)=>item.criterionId===criterion.id)?.pass===true);
  const overallScore=weightedScore(args.project,results,()=>true);
  const coverageScore=weightedScore(args.project,results,(criterion)=>!criterion.id.startsWith("SYS-")&&!criterion.protectedConstraint);
  const integrityScore=results.find((item)=>item.criterionId==="SYS-INTEGRITY")?.score??(allTargetsFrozen?100:0);
  const pairwiseScore=results.find((item)=>item.criterionId==="SYS-PAIRWISE")?.score??0;
  const verifiedFailures=verifiedValidationFailures(args.project,args.validation);
  const missingEvidence=args.project.acceptanceRubric.some((criterion)=>{
    const score=scoreById.get(criterion.id);
    return score?.verificationStatus!=="verified";
  });
  const thresholdsPass=overallScore>=85&&coverageScore>=90&&integrityScore>=90&&(pairwiseScore>=80||!args.project.acceptanceRubric.some((item)=>item.id==="SYS-PAIRWISE"));
  const passed=validationReusable
    && args.validation.recommendation==="release"
    && allTargetsFrozen
    && hardGatePass
    && !missingEvidence
    && thresholdsPass;
  const status:ArtifactAcceptance["status"]=passed
    ?"passed"
    : missingEvidence||!validationReusable||!allTargetsFrozen
      ?"unverified"
      :"failed";
  return {
    id:`artifact-acceptance-server-${Date.parse(now)||Date.now()}`,
    status,
    frozenArtifacts:allTargetsFrozen?args.frozenArtifacts:undefined,
    candidateId:args.candidate.id,
    evidenceFingerprint:binding,
    overallScore,
    coverageScore,
    integrityScore,
    pairwiseScore,
    hardGatePass,
    results,
    attempts:args.project.artifactAcceptance.attempts??0,
    maxRepairAttempts:args.project.artifactAcceptance.maxRepairAttempts??3,
    summary:passed
      ?"Gate F 已复用同一 Candidate 的 Hidden Validation 证据，并校验 exact frozen Artifact bytes/hash；Artifact Ready。"
      : status==="unverified"
        ?"Gate F 尚缺 exact-fingerprint 验证证据或 frozen Artifact 字节证明；保持 UNVERIFIED，不把能力缺口当产品失败。"
        : `Gate F 未通过：${verifiedFailures.length} 个已验证 Criterion 失败或交付阈值未达标。`,
    acceptedAt:passed?now:undefined,
    lastCheckedAt:now,
  };
}
