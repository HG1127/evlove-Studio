import {PairedQuotationDocumentSchema,PairedSourceQuotationsSchema,type PairedQuotationDocument} from "@evolution/contracts";

// Preserve punctuation, case and negation. Only Unicode normalization and whitespace differ.
const text=(value:string)=>value.normalize("NFC").replace(/\s+/gu," ").trim();
const key=(value:{sourceArtifactId:string;sha256:string})=>JSON.stringify([value.sourceArtifactId,value.sha256]);
export type SourceQuotationIssue={code:"missing-claims"|"uncovered-note"|"invalid-note"|"quote-not-in-note"|"foreign-source"|"conflicting-document"|"unsupported-present"|"unsupported-absence";noteIndex?:number};

/** Validates declared literal support only; it cannot verify the prose inference or overall Safety. */
export function pairedSourceQuotationIssues(input:{notes:readonly string[];quotations:unknown;subjectDocuments:readonly PairedQuotationDocument[];comparisonDocuments:readonly PairedQuotationDocument[]}):SourceQuotationIssue[]{
 const subjects=PairedQuotationDocumentSchema.array().parse(input.subjectDocuments),comparisons=PairedQuotationDocumentSchema.array().parse(input.comparisonDocuments);
 const parsed=PairedSourceQuotationsSchema.safeParse(input.quotations);
 if(!parsed.success)return [{code:"missing-claims"}];
 const all=new Map<string,string>(),issues:SourceQuotationIssue[]=[];
 for(const document of [...subjects,...comparisons]){
  const id=key(document),body=text(document.text);
  if(all.has(id)&&all.get(id)!==body)issues.push({code:"conflicting-document"});
  all.set(id,body);
 }
 const own=new Set(subjects.map(key)),other=new Set(comparisons.map(key)),covered=new Set<number>();
 if(!input.notes.length)issues.push({code:"uncovered-note"});
 for(const claim of parsed.data){
  const noteIndex=claim.noteIndex,quote=text(claim.quote),id=key(claim);
  if(noteIndex>=input.notes.length||!input.notes[noteIndex]?.trim())issues.push({code:"invalid-note",noteIndex});
  else if(!quote||!text(input.notes[noteIndex]!).includes(quote))issues.push({code:"quote-not-in-note",noteIndex});
  else covered.add(noteIndex);
  if(!own.has(id)){issues.push({code:"foreign-source",noteIndex});continue;}
  const present=Boolean(quote)&&all.get(id)!.includes(quote);
  if(claim.relation==="present"){
   if(!present)issues.push({code:"unsupported-present",noteIndex});
  }else if(present||!quote||!other.has(key(claim.comparison))||!all.get(key(claim.comparison))?.includes(quote)){
   issues.push({code:"unsupported-absence",noteIndex});
  }
 }
 input.notes.forEach((_,noteIndex)=>{if(!covered.has(noteIndex))issues.push({code:"uncovered-note",noteIndex});});
 return issues;
}
