import {PAIRED_SOURCE_FRAGMENT_POLICY,PAIRED_COMPACT_SOURCE_FRAGMENT_POLICY,PairedSourceFragmentPolicySchema,PairedQuotationDocumentSchema,PairedSourceFragmentManifestSchema,SourceQuotationSelectionsSchema,CompactSourceQuotationSelectionsSchema,type PairedSourceFragmentPolicy,type PairedQuotationDocument,type PairedSourceFragmentManifest,type PairedSourceQuotation} from "@evolution/contracts";

type Digest=(text:string)=>string;
const key=(d:{sourceArtifactId:string;sha256:string})=>JSON.stringify([d.sourceArtifactId,d.sha256]);
const digest=(sha256:Digest,text:string)=>{const value=sha256(text);if(!/^[a-f0-9]{64}$/.test(value))throw Error("SHA256 digest required for source fragment identity");return value;};
/** Partition every observed UTF-16 code unit; never trim, normalize or reconstruct a source. */
export function buildPairedSourceFragments(raw:readonly PairedQuotationDocument[],sha256:Digest,policy:PairedSourceFragmentPolicy=PAIRED_SOURCE_FRAGMENT_POLICY):{manifest:PairedSourceFragmentManifest;sha256:string}{
 PairedSourceFragmentPolicySchema.parse(policy);
 const documents=PairedQuotationDocumentSchema.array().parse(raw),unique=new Map<string,PairedQuotationDocument>();
 for(const doc of documents){const previous=unique.get(key(doc));if(previous&&previous.text!==doc.text)throw Error("Conflicting measured source bodies");unique.set(key(doc),doc);}
 const ids=new Set<string>();
 const manifest=PairedSourceFragmentManifestSchema.parse({policy,documents:[...unique.entries()].sort(([a],[b])=>a<b?-1:a>b?1:0).map(([,doc],documentIndex)=>{
  const bodyTextSha256=digest(sha256,doc.text),fragments:PairedSourceFragmentManifest["documents"][number]["fragments"]=[];
  let start=0;
  // Bounded contextual spans avoid adding an identifier to every short source line.
  // Prefer a line boundary, keep at most 800 code units, and preserve every character.
  while(start<doc.text.length){let end=Math.min(doc.text.length,start+800);
    if(end<doc.text.length){const newline=doc.text.lastIndexOf("\n",end-1);if(newline>=start)end=newline+1;}
    if(end<doc.text.length&&/[\uD800-\uDBFF]/.test(doc.text[end-1]!)&&/[\uDC00-\uDFFF]/.test(doc.text[end]!))end--;
    const text=doc.text.slice(start,end),identity=JSON.stringify([policy,doc.sourceArtifactId,doc.sha256,bodyTextSha256,start,text.length]);
    const id=policy===PAIRED_COMPACT_SOURCE_FRAGMENT_POLICY?`d${documentIndex}s${fragments.length}`:"q"+digest(sha256,identity).slice(0,24);if(ids.has(id))throw Error("Source fragment identity collision");ids.add(id);
    fragments.push({id,start,length:text.length,text});start=end;
  }
  if(start!==doc.text.length||fragments.map(f=>f.text).join("")!==doc.text)throw Error("Source fragment coverage differs from observed body");
  return {sourceArtifactId:doc.sourceArtifactId,sha256:doc.sha256,bodyTextSha256,bodyUtf16Length:doc.text.length,fragments};
 })});
 return {manifest,sha256:digest(sha256,JSON.stringify(manifest))};
}

export type SourceSelectionIssue={code:"invalid-selections"|"unknown-span"|"foreign-present-source"|"foreign-comparison-source"|"unsupported-absence";noteIndex?:number};
/** Resolve only from a newly reconstructed manifest of the actual issued source bodies. */
export function resolvePairedSourceSelections(input:{selections:unknown;subjectDocuments:readonly PairedQuotationDocument[];comparisonDocuments:readonly PairedQuotationDocument[]},sha256:Digest,policy:PairedSourceFragmentPolicy=PAIRED_SOURCE_FRAGMENT_POLICY):{issues:SourceSelectionIssue[];quotations?:PairedSourceQuotation[];manifestSha256:string}{
 const built=buildPairedSourceFragments([...input.subjectDocuments,...input.comparisonDocuments],sha256,policy),selected=(policy===PAIRED_COMPACT_SOURCE_FRAGMENT_POLICY?CompactSourceQuotationSelectionsSchema:SourceQuotationSelectionsSchema).safeParse(input.selections);
 if(!selected.success)return {issues:[{code:"invalid-selections"}],manifestSha256:built.sha256};
 const subject=new Map(input.subjectDocuments.map(d=>[key(d),d])),comparison=new Map(input.comparisonDocuments.map(d=>[key(d),d]));
 const spans=new Map(built.manifest.documents.flatMap(d=>d.fragments.map(f=>[f.id,{doc:d,fragment:f}] as const))),issues:SourceSelectionIssue[]=[],quotations:PairedSourceQuotation[]=[];
 for(const selection of selected.data){
  const found=spans.get(selection.spanId);if(!found){issues.push({code:"unknown-span",noteIndex:selection.noteIndex});continue;}
  const {doc,fragment}=found;
  if(selection.relation==="present"){
   if(!subject.has(key(doc))){issues.push({code:"foreign-present-source",noteIndex:selection.noteIndex});continue;}
   quotations.push({sourceArtifactId:doc.sourceArtifactId,sha256:doc.sha256,noteIndex:selection.noteIndex,relation:"present",quote:fragment.text});
  }else{
   const own=input.subjectDocuments.filter(d=>d.sourceArtifactId===doc.sourceArtifactId);
   if(!comparison.has(key(doc))||own.length!==1){issues.push({code:"foreign-comparison-source",noteIndex:selection.noteIndex});continue;}
   if(own[0]!.text.includes(fragment.text)){issues.push({code:"unsupported-absence",noteIndex:selection.noteIndex});continue;}
   quotations.push({sourceArtifactId:own[0]!.sourceArtifactId,sha256:own[0]!.sha256,noteIndex:selection.noteIndex,relation:"absent",quote:fragment.text,comparison:{sourceArtifactId:doc.sourceArtifactId,sha256:doc.sha256}});
  }
 }
 return issues.length?{issues,manifestSha256:built.sha256}:{issues:[],quotations,manifestSha256:built.sha256};
}
