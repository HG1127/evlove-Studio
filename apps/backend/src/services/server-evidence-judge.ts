import {z} from "zod";
import {EvaluateAiResultSchema,type EvaluateAiResult} from "@evolution/contracts";
import {runServerAi} from "./ai-gateway";

/**
 * A large multi-criterion Judge can exhaust the provider's final JSON budget.
 * Never accept partial JSON or default missing scores to success. When the normal
 * structured request and its single retry both fail with a *format* error,
 * re-judge the same actual observations in bounded criterion-specific groups.
 *
 * The fallback is a new real AI evaluation, not a score repair or synthetic pass.
 */
const BriefCriterion=z.object({id:z.string().min(1),weight:z.number().nonnegative()}).passthrough();
const BriefCase=z.object({id:z.string().min(1),criterionIds:z.array(z.string())}).passthrough();
const BriefRun=z.object({testCaseId:z.string().min(1)}).passthrough();
const ShardableJudgePayload=z.object({
  acceptanceRubric:z.array(BriefCriterion).min(2).max(32),
  testCases:z.array(BriefCase).min(1).max(100),
  runs:z.array(BriefRun).min(1).max(100),
  project:z.object({acceptanceRubric:z.array(z.unknown())}).passthrough(),
}).passthrough();

type JudgePayload=z.infer<typeof ShardableJudgePayload>;
type Criterion=z.infer<typeof BriefCriterion>;
type JudgeCall=(payload:unknown)=>Promise<EvaluateAiResult>;

const FORMAT_ERRORS=new Set(["AI_OUTPUT_INVALID_JSON","AI_OUTPUT_SCHEMA_MISMATCH","AI_OUTPUT_INCOMPLETE","AI_OUTPUT_MISSING_FINAL"]);
function isFormatFailure(error:unknown){
  return FORMAT_ERRORS.has((error as {code?:unknown})?.code as string);
}
function uniqueIds(ids:string[]){
  return ids.length===new Set(ids).size;
}

function shardInput(payload:JudgePayload,criteria:Criterion[]):JudgePayload{
  const ids=new Set(criteria.map(c=>c.id));
  const testCases=payload.testCases.filter(test=>test.criterionIds.some(id=>ids.has(id)));
  const caseIds=new Set(testCases.map(c=>c.id));
  return {
    ...payload,
    acceptanceRubric:criteria,
    project:{...payload.project,acceptanceRubric:criteria},
    testCases:testCases.map(test=>({...test,criterionIds:test.criterionIds.filter(id=>ids.has(id))})),
    runs:payload.runs.filter(run=>caseIds.has(run.testCaseId)),
  };
}

function ensureExactShardResult(raw:EvaluateAiResult,criteria:Criterion[],input:JudgePayload):EvaluateAiResult{
  const value=EvaluateAiResultSchema.parse(raw);
  const expected=new Set(criteria.map(c=>c.id));
  const seen=new Set(value.criteria.map(c=>c.criterionId));
  const cases=new Map(input.testCases.map(test=>[test.id,new Set(test.criterionIds)]));
  if(seen.size!==expected.size||[...expected].some(id=>!seen.has(id))){
    throw Object.assign(new Error("独立评审未返回每一条所需 Criterion，不能拼接为已完成结果。"),{code:"AI_JUDGE_INCOMPLETE"});
  }
  if(value.cases.some(item=>!cases.has(item.testCaseId))
    ||value.criteria.some(row=>!expected.has(row.criterionId)
      ||row.testCaseIds.some(id=>!cases.get(id)?.has(row.criterionId)))){
    throw Object.assign(new Error("独立评审返回的测试或标准 ID 与实际执行证据不匹配。"),{code:"AI_JUDGE_IDENTITY_MISMATCH"});
  }
  return value;
}

/** Fail closed if source identity is ambiguous before spending any fallback model calls. */
function canShard(payload:JudgePayload){
  const criteria=payload.acceptanceRubric,testCases=payload.testCases,runs=payload.runs;
  const criteriaIds=new Set(criteria.map(c=>c.id));
  const testIds=new Set(testCases.map(t=>t.id));
  return uniqueIds([...criteriaIds])&&criteriaIds.size===criteria.length
    &&uniqueIds(testCases.map(t=>t.id))
    &&uniqueIds(runs.map(r=>r.testCaseId))
    &&runs.every(r=>testIds.has(r.testCaseId))
    &&criteria.every(c=>testCases.some(t=>t.criterionIds.includes(c.id)&&runs.some(r=>r.testCaseId===t.id)));
}

async function gradeChunk(payload:JudgePayload,criteria:Criterion[],invoke:JudgeCall):Promise<EvaluateAiResult[]>{
  const part=shardInput(payload,criteria);
  try {
    return [ensureExactShardResult(await invoke(part),criteria,part)];
  } catch(error) {
    // A malformed multi-criterion reply may still fit when independently re-judged;
    // a single-criterion failure is terminal, never converted to a passing score.
    if(!isFormatFailure(error)||criteria.length===1)throw error;
    const mid=Math.ceil(criteria.length/2);
    return [
      ...await gradeChunk(payload,criteria.slice(0,mid),invoke),
      ...await gradeChunk(payload,criteria.slice(mid),invoke),
    ];
  }
}

function mergeJudgeParts(parts:EvaluateAiResult[],criteria:Criterion[],testCases:JudgePayload["testCases"]):EvaluateAiResult{
  const expected=new Set(criteria.map(c=>c.id));
  const ordered=new Map<string,EvaluateAiResult["criteria"][number]>();
  for(const part of parts)for(const row of part.criteria){
    if(!expected.has(row.criterionId)||ordered.has(row.criterionId)){
      throw Object.assign(new Error("分片评审 Criterion 结果重复或越界，拒绝合并。"),{code:"AI_JUDGE_IDENTITY_MISMATCH"});
    }
    ordered.set(row.criterionId,row);
  }
  if(ordered.size!==expected.size)throw Object.assign(new Error("分片评审未覆盖全部 Criterion，拒绝合并。"),{code:"AI_JUDGE_INCOMPLETE"});
  // Multi-criterion cases may be rated from different rubric angles.
  // Suppress their ambiguous case-level scores; settlement uses individually
  // verified Criterion rows tied to the original execution receipts instead.
  const counts=new Map<string,number>();
  for(const test of testCases)counts.set(test.id,0);
  for(const part of parts)for(const row of part.cases)counts.set(row.testCaseId,(counts.get(row.testCaseId)??0)+1);
  const cases=parts.flatMap(part=>part.cases.filter(row=>counts.get(row.testCaseId)===1));
  const weight=criteria.reduce((sum,c)=>sum+c.weight,0)||1;
  const average=(key:"accuracy"|"evidence"|"riskCoverage"|"completeness")=>
    Math.round(parts.reduce((sum,part)=>{
      // Each part was produced for an exact subset of criteria; sum the weights
      // of its returned Criterion IDs, not the count of answers.
      const ids=new Set(part.criteria.map(row=>row.criterionId));
      const partWeight=criteria.filter(c=>ids.has(c.id)).reduce((sum,c)=>sum+c.weight,0);
      return sum+part[key]*partWeight;
    },0)/weight);
  const safety=parts.some(part=>part.safety==="FAIL")?"FAIL":parts.some(part=>part.safety==="REVIEW")?"REVIEW":"PASS";
  const notes=[...new Set(parts.flatMap(part=>part.notes))].slice(0,20);
  const failures=[...new Set(parts.flatMap(part=>part.failures))].slice(0,20);
  return EvaluateAiResultSchema.parse({
    accuracy:average("accuracy"),evidence:average("evidence"),
    riskCoverage:average("riskCoverage"),completeness:average("completeness"),
    safety,notes:[...notes,"独立 Judge 对同一真实执行证据按 Criterion 分片复评；重复的跨标准逐题评分未作为通过依据。"],
    failures,cases,
    criteria:criteria.map(c=>ordered.get(c.id)!),
  });
}

export async function runServerEvidenceJudge(
  raw:unknown,invoke:JudgeCall=(payload)=>runServerAi("evaluate",payload),
):Promise<EvaluateAiResult>{
  try {
    return await invoke(raw);
  } catch(error) {
    if(!isFormatFailure(error))throw error;
    const parsed=ShardableJudgePayload.safeParse(raw);
    if(!parsed.success||!canShard(parsed.data))throw error;
    const payload=parsed.data;
    // Standard route already retried once. Retry in small, bounded AI requests
    // only for invalid final JSON; no changes to the scoring route or evidence.
    const chunks:Criterion[][]=[];
    for(let i=0;i<payload.acceptanceRubric.length;i+=3)
      chunks.push(payload.acceptanceRubric.slice(i,i+3));
    const results:EvaluateAiResult[]=[];
    for(const criteria of chunks)results.push(...await gradeChunk(payload,criteria,invoke));
    return mergeJudgeParts(results,payload.acceptanceRubric,payload.testCases);
  }
}
