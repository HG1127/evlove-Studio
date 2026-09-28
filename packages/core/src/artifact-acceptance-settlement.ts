import type {
  ArtifactAcceptance,
  Candidate,
  EvolveProject,
  FrozenArtifact,
  ValidationRun,
} from "@evolution/contracts";
import { evidenceFingerprint } from "./evidence-binding";
import { hasAuthoritativeHiddenRelease, hasFullHiddenMeasurement, hasVerifiedHiddenBaseline } from "./hidden-validation-evidence";
import { indexScopedAcceptanceResults } from "./acceptance-result-identity";
import { indexUniqueById } from "./identity-index";

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
  const targetIndex=indexUniqueById(targetIds,(id)=>id);
  const frozenIndex=indexUniqueById(args.frozenArtifacts,(item)=>item.sourceArtifactId);
  const snapshotIndex=indexUniqueById(args.candidate.artifactSnapshots,(item)=>item.sourceArtifactId);
  const allTargetsFrozen=targetIds.length>0
    && targetIndex.duplicateIds.size===0
    && frozenIndex.duplicateIds.size===0
    && snapshotIndex.duplicateIds.size===0
    && args.frozenArtifacts.length===targetIds.length
    && args.candidate.artifactSnapshots.length===targetIds.length
    && targetIds.every((id)=>{
      const snapshot=snapshotIndex.byId.get(id);
      const frozen=frozenIndex.byId.get(id);
      const receipt=snapshot?.frozenArtifact;
      return Boolean(snapshot&&frozen&&receipt
        && receipt.sourceArtifactId===id
        && receipt.sha256===frozen.sha256
        && receipt.blobId===frozen.blobId
        && receipt.snapshotHash===frozen.snapshotHash
        && receipt.size===frozen.size
        && receipt.name===frozen.name
        && receipt.mimeType===frozen.mimeType
        && (!snapshot.contentHash||snapshot.contentHash===receipt.snapshotHash));
    });
  const validationReusable=hasFullHiddenMeasurement(args.validation,args.candidate.id,args.project.hiddenEvalSuite)
    && args.validation.evidenceFingerprint===binding;
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
  const measurementEvidenceIncomplete=!hasVerifiedHiddenBaseline(args.validation,args.project.hiddenEvalSuite)
    ||args.validation.runs.some((run)=>run.verificationStatus!=="verified")
    ||Boolean(args.validation.evaluation?.unverifiedCriterionIds?.length);
  const passed=validationReusable
    && hasAuthoritativeHiddenRelease(args.validation,args.candidate.id,args.project.hiddenEvalSuite)
    && allTargetsFrozen
    && hardGatePass
    && !missingEvidence
    && thresholdsPass;
  const status:ArtifactAcceptance["status"]=passed
    ?"passed"
    : missingEvidence||!validationReusable||!allTargetsFrozen||measurementEvidenceIncomplete
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
