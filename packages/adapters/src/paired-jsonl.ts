import {PairedEvaluationAiResultSchema,PairedJsonlRecordSchema,PairedJsonlReferenceRecordSchema,PairedJsonlScopeSchema,type PairedEvaluationAiResult} from "@evolution/contracts";

/** Strict whole-response parse. No repairs, inferred rows, filtering, or partial acceptance. */
export function parsePairedJsonl(text:string,rawScope:unknown):PairedEvaluationAiResult{
 const scope=PairedJsonlScopeSchema.parse(rawScope);
 const invalid=()=>Object.assign(new Error("Paired JSONL output is invalid or differs from its issued scope"),{code:"AI_OUTPUT_INVALID_JSONL"});
 try{
  if(text.length>4_000_000||text.startsWith("\uFEFF"))throw invalid();
  const lines=text.split(/\r?\n/);if(lines.at(-1)==="")lines.pop();
  if(lines.length>101||lines.some(line=>!line.trim()))throw invalid();
  const recordSchema=scope.relativeCriterionIds?PairedJsonlReferenceRecordSchema:PairedJsonlRecordSchema;
  const records=lines.map(line=>recordSchema.parse(JSON.parse(line))),header=records[0],end=records.at(-1);
  if(header?.kind!=="header"||end?.kind!=="end"||header.requestFingerprint!==scope.requestFingerprint||end.requestFingerprint!==scope.requestFingerprint
   ||records.filter(r=>r.kind==="header").length!==1||records.filter(r=>r.kind==="end").length!==1)throw invalid();
  const summaries=records.filter(r=>r.kind==="summary"),rows=records.filter(r=>r.kind==="criterion");
  if(summaries.length!==3||new Set(summaries.map(r=>r.slot)).size!==3||rows.length!==scope.bindings.length*3||end.criterionRecords!==rows.length)throw invalid();
  const caseIds=new Set(scope.bindings.flatMap(b=>b.testCaseIds));
  const versions=summaries.map(s=>{
   const criteria=rows.filter(r=>r.slot===s.slot).map(r=>r.value);
   if(criteria.length!==scope.bindings.length||new Set(criteria.map(r=>r.criterionId)).size!==criteria.length||s.value.cases.some(c=>!caseIds.has(c.testCaseId)))throw invalid();
   for(const row of criteria){const binding=scope.bindings.find(b=>b.criterionId===row.criterionId);
    if(!binding||row.testCaseIds.length!==binding.testCaseIds.length||row.testCaseIds.some(id=>!binding.testCaseIds.includes(id)))throw invalid();
    if("relativeEvidenceStatus" in row&&!scope.relativeCriterionIds?.includes(row.criterionId))throw invalid();
   }
   return {slot:s.slot,result:{...s.value,criteria}};
  });
  return PairedEvaluationAiResultSchema.parse({schemaVersion:"paired-evaluation-v1",requestFingerprint:scope.requestFingerprint,versions});
 }catch{throw invalid();}
}
