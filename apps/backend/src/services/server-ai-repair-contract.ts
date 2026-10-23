import {z} from "zod";
import {RepairArtifactAiResultSchema,jsonSchemas} from "@evolution/contracts";

const RepairScope=z.object({failedCriteria:z.array(z.object({criterionId:z.string().min(1)})).min(1)});

/** The provider and parser share the exact allowed failed IDs, never descriptive claims or preserved criteria. */
export function serverAiRepairContract(payload:unknown){
  const scope=RepairScope.parse(payload);
  const ids=scope.failedCriteria.map(criterion=>criterion.criterionId);
  if(new Set(ids).size!==ids.length)throw new Error("Repair scope contains duplicate criterion IDs");
  const parser=RepairArtifactAiResultSchema.extend({repairedCriteria:z.array(z.enum(ids as [string,...string[]])).min(1).max(ids.length)});
  const base=jsonSchemas.repairArtifact;
  return {parser,schema:{...base,schema:{...base.schema,properties:{...base.schema.properties,
    repairedCriteria:{type:"array",items:{type:"string",enum:ids},minItems:1,maxItems:ids.length},
  }}},instruction:"Repair only explicitly supplied VERIFIED failed criteria on exact current Candidate artifacts. Preserve unrelated/protected behavior; never claim validation passed. repairedCriteria MUST contain only exact criterionId strings from failedCriteria: "+JSON.stringify(ids)+". Do not append descriptions, report preserved criteria, or invent additional IDs."};
}
