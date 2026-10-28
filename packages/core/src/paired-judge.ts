import {PAIRED_JUDGE_POLICY,PAIRED_JUDGE_FILE_METADATA_POLICY,PairedJudgeFileMetadataSchema,PairedJudgeReceiptSchema,type AcceptanceCriterion,type Candidate,type EvaluateAiResult,type EvaluationResult,type EvolveProject,type FrozenArtifact,type OriginalArtifactReferenceProof,type PairedJudgeReceipt,type SourceArtifact,type TestCase} from "@evolution/contracts";
import {fastHash} from "./stable-hash";

const dimensions=["accuracy","evidence","riskCoverage","completeness"] as const;
const same=(a:string[],b:string[])=>a.length===b.length&&new Set(a).size===a.length&&a.every(v=>b.includes(v));
const worstSafety=(a:EvaluateAiResult["safety"],b:EvaluateAiResult["safety"]):EvaluateAiResult["safety"]=>a==="FAIL"||b==="FAIL"?"FAIL":a==="REVIEW"||b==="REVIEW"?"REVIEW":"PASS";
// Legacy settlement treats 1 as a ratio. Keep the new integer-percent protocol's 1% literal truthful.
const legacyScore=(n:number)=>n===1?0.01:n;

/** Bind declared file attributes to already recorded bytes; never infer missing names or MIME from body text. */
export function pairedJudgeFileMetadata(source:SourceArtifact,original:OriginalArtifactReferenceProof,frozen:FrozenArtifact){
  const known=(value:string)=>value.trim()?value:null;
  return PairedJudgeFileMetadataSchema.parse({schemaVersion:"paired-file-metadata-v1",
    original:{name:known(source.name),mimeType:known(source.mimeType),sizeBytes:original.sizeBytes,provenance:"mission-source-declaration-with-original-byte-reference"},
    candidate:{name:known(frozen.name),mimeType:known(frozen.mimeType),sizeBytes:frozen.size,provenance:"frozen-artifact-reference"},
  });
}

/** Retain an actually observed least-favorable pair per criterion, never a best run or an invented average. */
export function conservativePairedJudgments(samples:readonly[{original:EvaluateAiResult;candidate:EvaluateAiResult},{original:EvaluateAiResult;candidate:EvaluateAiResult}]){
  const ids=samples[0].candidate.criteria.map(c=>c.criterionId);
  if(!ids.length||new Set(ids).size!==ids.length||samples.some(s=>[s.original,s.candidate].some(arm=>!same(arm.criteria.map(c=>c.criterionId),ids))))throw Error("Paired criterion identities differ");
  const output=(arm:"original"|"candidate"):EvaluateAiResult=>{
    const value={...samples[0][arm],notes:[...samples[0][arm].notes,...samples[1][arm].notes,"paired-two-order-v1: per-criterion least-favorable observed pair; two samples are not a confidence interval"],
      failures:[...new Set(samples.flatMap(s=>s[arm].failures))],safety:worstSafety(samples[0][arm].safety,samples[1][arm].safety),cases:[]};
    for(const key of dimensions){const index=samples[1].candidate[key]-samples[1].original[key]<samples[0].candidate[key]-samples[0].original[key]?1:0;value[key]=legacyScore(samples[index][arm][key]);}
    value.criteria=ids.map(id=>{
      const row=(i:0|1,side:"original"|"candidate")=>samples[i][side].criteria.find(c=>c.criterionId===id)!;
      const index=row(1,"candidate").score-row(1,"original").score<row(0,"candidate").score-row(0,"original").score?1:0;
      const selected=row(index,arm);return {...selected,score:legacyScore(selected.score)};
    });
    return value;
  };
  return {original:output("original"),candidate:output("candidate")};
}

export function inconclusivePairedCriteria(receipt:PairedJudgeReceipt,criteria:AcceptanceCriterion[]){
  return criteria.filter(c=>{
    if(!receipt.criterionIds.includes(c.id))return false;
    const rows=receipt.samples.map(s=>({a:s.original.criteria.find(r=>r.criterionId===c.id)!,b:s.candidate.criteria.find(r=>r.criterionId===c.id)!}));
    const pass=(r:typeof rows[number]["a"])=>r.pass&&r.score>=c.minScore;
    const nullConflict=receipt.samples.some(s=>{
      const original=s.original.criteria.find(r=>r.criterionId===c.id)!,control=s.controlOriginal.criteria.find(r=>r.criterionId===c.id)!;
      return original.score!==control.score||original.pass!==control.pass||s.original.safety!==s.controlOriginal.safety;
    });
    return nullConflict||pass(rows[0]!.a)!==pass(rows[1]!.a)||pass(rows[0]!.b)!==pass(rows[1]!.b)
      ||(rows[0]!.b.score<rows[0]!.a.score)!==(rows[1]!.b.score<rows[1]!.a.score);
  }).map(c=>c.id);
}

/** A fluctuating measurement is missing evidence, not an instruction to repair the artifact. */
export function qualifyPairedEvaluation(value:EvaluationResult,receipt:PairedJudgeReceipt,criteria:AcceptanceCriterion[]):EvaluationResult{
  const uncertain=new Set(inconclusivePairedCriteria(receipt,criteria));
  const criterionScores=value.criterionScores?.map(row=>uncertain.has(row.criterionId)?{...row,pass:false,verificationStatus:"unverified" as const,
    gaps:[...row.gaps,"成对评审的原文副本对照、过线或退步方向存在冲突；测量待确认，不能据此认定产品失败或通过。"]}:row);
  const verified=criteria.filter(c=>criterionScores?.some(r=>r.criterionId===c.id&&r.verificationStatus==="verified")).reduce((n,c)=>n+c.weight,0);
  const total=criteria.reduce((n,c)=>n+c.weight,0);
  return {...value,criterionScores,verifiedRubricCoverage:total?Math.round(100*verified/total):0,
    unverifiedCriterionIds:criteria.filter(c=>!criterionScores?.some(r=>r.criterionId===c.id&&r.verificationStatus==="verified")).map(c=>c.id),
    safety:criteria.some(c=>c.hardGate&&uncertain.has(c.id))&&value.safety==="PASS"?"REVIEW":value.safety};
}

/** Caller supplies the actual comparison paper. Legacy scores are never reinterpreted as this protocol. */
export function pairedComparisonBaseline(project:EvolveProject,evaluation:EvaluationResult,fallback:EvaluationResult,suite:TestCase[]=project.evalSuite,candidate?:Candidate){
  if(project.experimentPolicy?.judgeComparison!==PAIRED_JUDGE_POLICY)return {baseline:fallback};
  const fail=(reason:string)=>({baseline:fallback,blocker:`[paired-judge-evidence-pending] ${reason}`});
  const data=evaluation.judgeComparison,parsed=PairedJudgeReceiptSchema.safeParse(data?.receipt);
  if(!data||!parsed.success)return fail("missing valid two-order receipt");
  const r=parsed.data,selected=candidate??project.candidates.find(c=>c.id===r.candidateId);
  if(r.fileMetadataPolicy!==project.experimentPolicy.judgeFileMetadata)return fail("file metadata policy differs");
  if(r.missionId!==project.id||!selected||selected.id!==r.candidateId||r.rubricFingerprint!==fastHash(project.acceptanceRubric)
    ||r.suiteFingerprint!==fastHash(suite)||!same(r.testCaseIds,suite.map(t=>t.id)))return fail("Mission, Candidate, rubric or paper binding differs");
  const targets=project.sourceArtifacts.filter(s=>s.role==="target"),refs=project.baselineRun.originalReferences??[];
  const rubricIds=new Set(project.acceptanceRubric.map(c=>c.id));
  const required=project.acceptanceRubric.filter(c=>(c.judgeType==="llm"||c.judgeType==="pairwise")&&suite.some(t=>t.criterionIds.includes(c.id))).map(c=>c.id);
  if(r.criterionIds.some(id=>!rubricIds.has(id))||required.some(id=>!r.criterionIds.includes(id)))return fail("required judge criterion omitted");
  if(targets.length!==r.bindings.length||new Set(targets.map(t=>t.id)).size!==targets.length||r.bindings.some(b=>{
    const originals=refs.filter(p=>p.sourceArtifactId===b.sourceArtifactId&&p.missionId===project.id),snapshots=selected.artifactSnapshots.filter(s=>s.sourceArtifactId===b.sourceArtifactId);
    return !targets.some(t=>t.id===b.sourceArtifactId)||originals.length!==1||snapshots.length!==1||originals[0]!.sha256!==b.originalSha256||snapshots[0]!.frozenArtifact?.sha256!==b.candidateSha256||snapshots[0]!.frozenArtifact?.sourceArtifactId!==b.sourceArtifactId;
  }))return fail("physical Artifact binding differs");
  if(r.bindings.some(b=>{
    if(!b.fileMetadata)return project.experimentPolicy.judgeFileMetadata===PAIRED_JUDGE_FILE_METADATA_POLICY;
    const source=targets.find(t=>t.id===b.sourceArtifactId)!,original=refs.find(ref=>ref.sourceArtifactId===b.sourceArtifactId)!,frozen=selected.artifactSnapshots.find(s=>s.sourceArtifactId===b.sourceArtifactId)!.frozenArtifact!;
    try{return fastHash(pairedJudgeFileMetadata(source,original,frozen))!==fastHash(b.fileMetadata);}catch{return true;}
  }))return fail("file metadata binding differs");
  const uncertain=new Set(inconclusivePairedCriteria(r,project.acceptanceRubric));
  const safety=(arm:"original"|"candidate")=>{
    const worst=worstSafety(r.samples[0][arm].safety,r.samples[1][arm].safety);
    return worst==="PASS"&&project.acceptanceRubric.some(c=>c.hardGate&&uncertain.has(c.id))?"REVIEW":worst;
  };
  if(evaluation.safety!==safety("candidate")||data.baseline.safety!==safety("original"))return fail("paired Safety result differs");
  for(const id of r.criterionIds){
    const pairs=r.samples.map(s=>({a:s.original.criteria.find(row=>row.criterionId===id)!,b:s.candidate.criteria.find(row=>row.criterionId===id)!}));
    const witness=pairs[1]!.b.score-pairs[1]!.a.score<pairs[0]!.b.score-pairs[0]!.a.score?pairs[1]!:pairs[0]!;
    const current=evaluation.criterionScores?.filter(s=>s.criterionId===id),prior=data.baseline.criterionScores?.filter(s=>s.criterionId===id);
    const expected=suite.filter(t=>t.criterionIds.includes(id)).map(t=>t.id);
    if(r.samples.some(s=>[s.original,s.candidate,s.controlOriginal].some(arm=>!same(arm.criteria.find(c=>c.criterionId===id)!.testCaseIds,expected))))return fail("paired criterion case mapping differs");
    if(current?.length!==1||prior?.length!==1)return fail("settled criterion identity differs");
    if(!same(current[0]!.testCaseIds,expected)||!same(prior[0]!.testCaseIds,expected))return fail("settled case mapping differs");
    // Deterministic evidence may settle a criterion independently of the model. Never let the receipt upgrade missing evidence.
    if(uncertain.has(id)&&(current[0]!.verificationStatus==="verified"||prior[0]!.verificationStatus==="verified"))return fail("inconclusive measurement relabelled verified");
    if(current[0]!.verificationStatus==="verified"&&prior[0]!.verificationStatus==="verified"&&(current[0]!.score!==witness.b.score||prior[0]!.score!==witness.a.score))return fail("selected paired score differs");
  }
  if(r.bindings.every(b=>b.originalSha256===b.candidateSha256))return fail("unchanged Artifact set cannot establish mutation improvement");
  if(uncertain.size)return {baseline:data.baseline,blocker:"[paired-judge-evidence-pending] repeated judgments conflict; measurement must be qualified before promotion"};
  return {baseline:data.baseline};
}
