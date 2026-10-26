import {z} from "zod";
import {HtmlBodyNodeEditsSchema,RepairArtifactAiResultSchema,jsonSchemas} from "@evolution/contracts";

const RepairScope=z.object({failedCriteria:z.array(z.object({criterionId:z.string().min(1)})).min(1),
  candidate:z.object({artifacts:z.array(z.object({sourceArtifactId:z.string().min(1),mutationMode:z.string().optional(),
    htmlTextNodes:z.array(z.object({anchorId:z.string().min(1)})).max(4096).optional()}))}).optional()});

/** The provider and parser share the exact allowed failed IDs, never descriptive claims or preserved criteria. */
export function serverAiRepairContract(payload:unknown){
  const scope=RepairScope.parse(payload);
  const ids=scope.failedCriteria.map(criterion=>criterion.criterionId);
  if(new Set(ids).size!==ids.length)throw new Error("Repair scope contains duplicate criterion IDs");
  const targets=scope.candidate?.artifacts??[],byId=new Map(targets.map(target=>[target.sourceArtifactId,target]));
  if(byId.size!==targets.length)throw new Error("Repair scope contains duplicate target IDs");
  for(const target of targets)if(target.mutationMode==="html-body-node-edits-v1"
    &&(!target.htmlTextNodes?.length||new Set(target.htmlTextNodes.map(node=>node.anchorId)).size!==target.htmlTextNodes.length))
    throw new Error("HTML body repair requires a complete unique anchor index");
  const parser=RepairArtifactAiResultSchema.extend({repairedCriteria:z.array(z.enum(ids as [string,...string[]])).min(1).max(ids.length)}).superRefine((value,context)=>{
    const seenTargets=new Set<string>();
    value.artifacts.forEach((artifact,index)=>{
      const target=byId.get(artifact.sourceArtifactId),path=["artifacts",index,"content"];
      if(targets.length&&(!target||seenTargets.has(artifact.sourceArtifactId))){
        context.addIssue({code:"custom",path,message:"Repair artifact target is unknown or duplicated; copy the exact supplied sourceArtifactId"});return;
      }
      seenTargets.add(artifact.sourceArtifactId);
      if(target?.mutationMode!=="html-body-node-edits-v1")return;
      let raw:unknown;try{raw=JSON.parse(artifact.content);}catch{
        context.addIssue({code:"custom",path,message:"HTML body edits must be complete JSON using html-body-node-edits-v1"});return;
      }
      const edits=HtmlBodyNodeEditsSchema.safeParse(raw);
      if(!edits.success){context.addIssue({code:"custom",path,message:"HTML body edits must match html-body-node-edits-v1 with exact anchorId/text fields and no parent/hash fields"});return;}
      const allowed=new Set(target.htmlTextNodes!.map(node=>node.anchorId)),seen=new Set<string>();
      for(const edit of edits.data.edits){
        if(!allowed.has(edit.anchorId)||seen.has(edit.anchorId)){
          context.addIssue({code:"custom",path,message:"HTML body edit anchor is unknown or duplicated: "+edit.anchorId.slice(0,100)+". Copy each exact anchorId from the supplied htmlTextNodes once; never reconstruct or shorten it."});return;
        }
        seen.add(edit.anchorId);
      }
    });
    for(const target of targets)if(!seenTargets.has(target.sourceArtifactId))context.addIssue({code:"custom",path:["artifacts"],message:"Missing repair target: "+target.sourceArtifactId});
  });
  const base=jsonSchemas.repairArtifact;
  return {parser,schema:{...base,schema:{...base.schema,properties:{...base.schema.properties,
    repairedCriteria:{type:"array",items:{type:"string",enum:ids},minItems:1,maxItems:ids.length},
  }}},instruction:"Repair only explicitly supplied VERIFIED failed criteria on exact current Candidate artifacts. Preserve unrelated/protected behavior; never claim validation passed. repairedCriteria MUST contain only exact criterionId strings from failedCriteria: "+JSON.stringify(ids)+". Do not append descriptions, report preserved criteria, or invent additional IDs. For html-body-node-edits-v1, copy exact anchorId strings from the request-bound htmlTextNodes; never shorten, reconstruct, duplicate or guess an ID. The server owns the full parent binding."};
}
