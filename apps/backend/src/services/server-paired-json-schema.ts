import {pairedEvaluationJsonSchema} from "@evolution/contracts";

type Binding={criterionId:string;testCaseIds:string[]};
export const SERVER_PAIRED_GENERATION_SCHEMA_VERSION="issued-paired-generation-schema-v1";

/** Project the already validated issued scope into generation guidance, without altering any reply. */
export function serverIssuedPairedJsonSchema(requestFingerprint:string,bindings:Binding[],caseIds:string[]){
  const base=pairedEvaluationJsonSchema.schema,versions=base.properties.versions,version=versions.items;
  const evaluation=version.properties.result,criteria=evaluation.properties.criteria,row=criteria.items;
  const boundRows=bindings.map(binding=>({...row,properties:{...row.properties,
    criterionId:{type:"string",enum:[binding.criterionId]},
    testCaseIds:{type:"array",items:{type:"string",enum:[...binding.testCaseIds]},
      minItems:binding.testCaseIds.length,maxItems:binding.testCaseIds.length,uniqueItems:true,
      description:"Copy every issued case ID for this criterion exactly once, regardless of score or pass. Do not invent or infer aliases from document text."},
  }}));
  const cases=evaluation.properties.cases;
  const boundEvaluation={...evaluation,properties:{...evaluation.properties,
    criteria:{...criteria,minItems:bindings.length,maxItems:bindings.length,items:{anyOf:boundRows}},
    cases:{...cases,items:{...cases.items,properties:{...cases.items.properties,testCaseId:{type:"string",enum:[...caseIds]}}}},
  }};
  return {...pairedEvaluationJsonSchema,schema:{...base,properties:{...base.properties,
    requestFingerprint:{type:"string",enum:[requestFingerprint]},
    versions:{...versions,items:{...version,properties:{...version.properties,result:boundEvaluation}}},
  }}};
}
