import {z} from "zod";
import {BuildCandidateAiResultSchema,HtmlBuildBodyContextSchema,HtmlBuildBodyNodeEditsSchema,TextArtifactEditsSchema,jsonSchemas} from "@evolution/contracts";
import {serverHtmlBuildAnchorFeedback} from "./server-html-build-anchor-feedback";

const Target=z.object({id:z.string().min(1),bodyAnchorPolicy:z.enum(["issued-body-ranges-v1","issued-body-nodes-v1"]).optional(),htmlBuildBodyContext:HtmlBuildBodyContextSchema.optional()});
const Scope=z.object({project:z.object({currentTargets:z.array(Target).optional()}).optional()});
const Envelope=z.object({project:z.object({currentTargets:z.array(z.unknown()).optional()}).optional()});
const PolicySelection=z.object({bodyAnchorPolicy:z.unknown().optional()});
const instruction="Construct exact Candidate artifacts from the CURRENT target version and Candidate plan. Preserve protected/untouched scope; never claim tests passed.";

/** Request-owned HTML ranges are schema feedback, never an instruction to relocate a model's edit silently. */
export function serverAiBuildContract(payload:unknown){
  const legacy={schema:jsonSchemas.buildCandidate,parser:BuildCandidateAiResultSchema,instruction};
  const envelope=Envelope.safeParse(payload);
  if(!envelope.success||!(envelope.data.project?.currentTargets??[]).some(t=>{
    const selected=PolicySelection.safeParse(t);return selected.success&&selected.data.bodyAnchorPolicy!==undefined;
  }))return legacy;
  const scope=Scope.parse(payload),targets=scope.project?.currentTargets??[];
  const byId=new Map(targets.map(t=>[t.id,t]));
  if(byId.size!==targets.length)throw new Error("Build scope contains duplicate Target IDs");
  for(const t of targets)if(t.bodyAnchorPolicy&&!t.htmlBuildBodyContext)throw new Error("Issued body ranges require the complete request-bound body index");
  for(const t of targets)if(t.bodyAnchorPolicy==="issued-body-nodes-v1"
    &&new Set(t.htmlBuildBodyContext!.anchors.map(a=>a.anchorId)).size!==t.htmlBuildBodyContext!.anchors.length)throw new Error("Issued HTML body nodes require unique IDs");
  const parser=BuildCandidateAiResultSchema.superRefine((value,context)=>{
    const seenTargets=new Set<string>();
    for(const [artifactIndex,artifact] of value.artifacts.entries()){
      const path=["artifacts",artifactIndex,"content"],target=byId.get(artifact.sourceArtifactId);
      const reject=(message:string)=>context.addIssue({code:"custom",path,message});
      if(!target||seenTargets.has(artifact.sourceArtifactId)){reject("Build Target is unknown or duplicated; copy the exact currentTargets.id");continue;}
      seenTargets.add(artifact.sourceArtifactId);
      if(!target.bodyAnchorPolicy)continue;
      let raw:unknown;try{raw=JSON.parse(artifact.content);}catch{reject(target.bodyAnchorPolicy==="issued-body-nodes-v1"
        ?"Use complete html-build-body-node-edits-v1 JSON with edits:[{anchorId,after}] for this Target":"Use complete text-edits JSON for the issued HTML body Target");continue;}
      if(target.bodyAnchorPolicy==="issued-body-nodes-v1"){
        const parsed=HtmlBuildBodyNodeEditsSchema.safeParse(raw);
        if(!parsed.success){reject("Use html-build-body-node-edits-v1 with only edits:[{anchorId,after}]. Copy an exact issued ID; never return before, offsets or parent/hash fields.");continue;}
        const allowed=new Set(target.htmlBuildBodyContext!.anchors.map(a=>a.anchorId)),seen=new Set<string>();
        for(const [index,edit] of parsed.data.edits.entries()){
          if(!allowed.has(edit.anchorId))reject(serverHtmlBuildAnchorFeedback(edit.anchorId,target.htmlBuildBodyContext!.anchors,index));
          else if(seen.has(edit.anchorId))reject(`Edit ${index+1}: duplicate issued anchorId ${edit.anchorId}. Return one complete replacement for this node; do not select another node to bypass the duplicate.`);
          seen.add(edit.anchorId);
        }
        continue;
      }
      const parsed=TextArtifactEditsSchema.safeParse(raw);
      if(!parsed.success){reject("Use text-edits with complete before/after and optional start/end, without extra parent/hash fields");continue;}
      const anchors=target.htmlBuildBodyContext!.anchors,seen=new Set<string>();
      for(const [editIndex,edit] of parsed.data.edits.entries()){
        const matches=anchors.filter(a=>a.before===edit.before);
        const selected=edit.start===undefined&&edit.end===undefined
          ?matches.length===1?matches[0]:undefined
          :matches.find(a=>a.start===edit.start&&a.end===edit.end);
        if(!selected){
          const locations=matches.slice(0,5).map(a=>({start:a.start,end:a.end}));
          // The provider's existing correction boundary keeps only the first 240 characters per issue.
          reject(`Edit ${editIndex+1}: expected issued body ranges (${matches.length} matches): ${JSON.stringify(locations)}. Omit BOTH positions for one match; otherwise copy one exact issued pair. Use COMPLETE raw before from the body index, never chunk offsets, substrings or search attributes.${matches.length>5?` ${matches.length-5} more ranges remain in the complete index.`:""}`);
          continue;
        }
        if(seen.has(selected.anchorId))reject(`Edit ${editIndex+1} repeats an issued body node; return one replacement per anchor`);
        seen.add(selected.anchorId);
      }
    }
    for(const t of targets)if(!seenTargets.has(t.id))context.addIssue({code:"custom",path:["artifacts"],message:"Missing build Target: "+t.id});
  });
  const ranges=targets.some(t=>t.bodyAnchorPolicy==="issued-body-ranges-v1")?" For bodyAnchorPolicy issued-body-ranges-v1, use only COMPLETE raw before values from that Target's issued body anchors. OMIT start/end for a unique body node; the server supplies its verified physical range. For repeated real body nodes copy exact start AND end from the chosen issued anchor. Do not calculate offsets, use chunk offsets, alter parent/hash fields, or select attribute copies. This uses the existing single schema correction and does not grant another Candidate, repair, final paper or time window.":"";
  const nodes=targets.some(t=>t.bodyAnchorPolicy==="issued-body-nodes-v1")?" For bodyAnchorPolicy issued-body-nodes-v1, artifact.content MUST be complete JSON {kind:'html-build-body-node-edits-v1',edits:[{anchorId:'EXACT issued anchorId',after:'raw replacement of the selected TEXT SPAN'}]}. Copy the COMPLETE anchorId from that Target's htmlBuildBodyContext.anchors, even when many nodes share before text. Never calculate positions, return before/parent/hash fields, shorten IDs or invent nodes. element names the enclosing parent; its tags are OUTSIDE the selected span and stay in the file. Do not wrap a li text anchor in another li, or a p text anchor in another p. Keep the intended original item/number; do not select item 1 to replace item 5. Plain text and inline markup update an existing item; valid new paragraph/list markup remains possible at appropriate HTML boundaries. All protection and construction checks still apply. The server supplies exact before/start/end from this request's SHA-bound parent. This uses the existing single schema correction and grants no additional Candidate, repair, paper or window.":"";
  return {schema:jsonSchemas.buildCandidate,parser,instruction:instruction+ranges+nodes};
}
