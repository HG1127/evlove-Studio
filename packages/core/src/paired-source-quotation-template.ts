import {PairedSourceQuotationsSchema,type PairedQuotationDocument} from "@evolution/contracts";
import {pairedSourceQuotationIssues,type SourceQuotationIssue} from "./paired-source-quotations";

export type SourceQuotationTemplateIssue=SourceQuotationIssue|{code:"invalid-marker"|"missing-marker"|"duplicate-marker"|"cross-note-marker";noteIndex?:number};
/** A prospective template decoder, never a repair of archived v1 notes. */
export function renderPairedSourceQuotationTemplate(input:{notes:readonly string[];quotations:unknown;subjectDocuments:readonly PairedQuotationDocument[];comparisonDocuments:readonly PairedQuotationDocument[]}):{issues:SourceQuotationTemplateIssue[];notes?:string[]}{
 const claims=PairedSourceQuotationsSchema.safeParse(input.quotations);
 if(!claims.success)return {issues:[{code:"missing-claims"}]};
 const issues:SourceQuotationTemplateIssue[]=[],counts=new Map<number,number>();
 for(const [noteIndex,note] of input.notes.entries()){
  const tokens=[...note.matchAll(/\[\[q:([^\]]*)\]\]/g)];
  if(note.replace(/\[\[q:([^\]]*)\]\]/g,"").includes("[[q"))issues.push({code:"invalid-marker",noteIndex});
  for(const token of tokens){
   if(!/^(0|[1-9][0-9]*)$/.test(token[1]!)){issues.push({code:"invalid-marker",noteIndex});continue;}
   const index=Number(token[1]),claim=claims.data[index];
   if(!Number.isSafeInteger(index)||!claim){issues.push({code:"invalid-marker",noteIndex});continue;}
   counts.set(index,(counts.get(index)??0)+1);
   if(claim.noteIndex!==noteIndex)issues.push({code:"cross-note-marker",noteIndex});
  }
 }
 claims.data.forEach((claim,index)=>{
  if(!counts.has(index))issues.push({code:"missing-marker",noteIndex:claim.noteIndex});
  else if(counts.get(index)!==1)issues.push({code:"duplicate-marker",noteIndex:claim.noteIndex});
 });
 if(issues.length)return {issues};
 const notes=input.notes.map(note=>note.replace(/\[\[q:(0|[1-9][0-9]*)\]\]/g,(_marker,index:string)=>{
  const claim=claims.data[Number(index)]!;
  const label=claim.relation==="present"?`当前来源 ${claim.sourceArtifactId}@${claim.sha256}`
   :`当前来源 ${claim.sourceArtifactId}@${claim.sha256} 缺失；比较来源 ${claim.comparison.sourceArtifactId}@${claim.comparison.sha256} 存在`;
  return `〔${label}〕「${claim.quote}」`;
 }));
 // Still enforce all v1 literal ownership, note coverage, source/hash and absence checks.
 const unsupported=pairedSourceQuotationIssues({...input,notes});
 return unsupported.length?{issues:unsupported}:{issues:[],notes};
}
