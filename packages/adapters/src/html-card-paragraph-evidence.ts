import {HtmlCardParagraphComparisonRequestSchema,HtmlCardParagraphEvidenceSchema,type HtmlCardParagraphEvidence} from "@evolution/contracts";
import {compareHtmlCardParagraphs} from "@evolution/core";

const sha256=async(bytes:Uint8Array)=>Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",new Uint8Array(bytes).buffer)),b=>b.toString(16).padStart(2,"0")).join("");
/** Caller supplies authoritative artifact references; this producer verifies physical bytes, not storage authority. */
export async function observeHtmlCardParagraphChanges(raw:unknown):Promise<HtmlCardParagraphEvidence>{
 const input=HtmlCardParagraphComparisonRequestSchema.parse(raw);
 // Snapshot both subjects before asynchronous hashing so external buffer mutation cannot change the comparison.
 const original=new Uint8Array(input.original.bytes),candidate=new Uint8Array(input.candidate.bytes);
 const unavailable=(reason:string)=>HtmlCardParagraphEvidenceSchema.parse({schemaVersion:"html-card-paragraph-evidence-v1",status:"unavailable",sourceArtifactId:input.sourceArtifactId,reason});
 const hashes=await Promise.all([sha256(original),sha256(candidate)]);
 if(hashes[0]!==input.original.sha256||hashes[1]!==input.candidate.sha256)return unavailable("Physical Original/Candidate bytes differ from the issued SHA-256 references");
 try{
  const decoder=new TextDecoder("utf-8",{fatal:true});
  const comparison=compareHtmlCardParagraphs(decoder.decode(original),decoder.decode(candidate));
  if(comparison.status!=="compared")return unavailable(comparison.reason);
  const {status:_,...projection}=comparison;void _;
  const evidence=HtmlCardParagraphEvidenceSchema.safeParse({schemaVersion:"html-card-paragraph-evidence-v1",status:"observed",sourceArtifactId:input.sourceArtifactId,
   original:{sha256:hashes[0],sizeBytes:original.byteLength},candidate:{sha256:hashes[1],sizeBytes:candidate.byteLength},...projection,
   semanticAcceptanceEstablished:false,visibilityEstablished:false,authorizationEstablished:false});
  return evidence.success?evidence.data:unavailable("Paragraph projection exceeds the evidence contract; no truncated comparison is substituted");
 }catch{return unavailable("Complete UTF-8 paragraph comparison could not be produced");}
}
