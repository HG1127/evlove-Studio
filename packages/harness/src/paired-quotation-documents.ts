import {z} from "zod";
import {PairedQuotationObservationSchema,type PairedQuotationDocument} from "@evolution/contracts";

/** Project attested ranges only. Legacy and partial observations are never upgraded to complete text. */
export function pairedQuotationDocuments(raw:unknown,bindings:readonly {sourceArtifactId:string;sha256:string}[]):PairedQuotationDocument[]{
 const packet=z.object({observations:z.array(z.unknown())}).parse(raw),documents:PairedQuotationDocument[]=[];
 for(const row of packet.observations){
  if(!row||typeof row!=="object"||!("quotationSource" in row))continue;
  const {output,quotationSource:s}=PairedQuotationObservationSchema.parse(row);
  if(!bindings.some(b=>b.sourceArtifactId===s.sourceArtifactId&&b.sha256===s.sha256))throw Error("Quotation document source binding differs");
  const text=output.slice(s.start,s.start+s.length),existing=documents.find(d=>d.sourceArtifactId===s.sourceArtifactId&&d.sha256===s.sha256);
  if(existing&&existing.text!==text)throw Error("Quotation document observations conflict");
  if(!existing)documents.push({sourceArtifactId:s.sourceArtifactId,sha256:s.sha256,text,complete:true});
 }
 if(documents.length!==bindings.length||bindings.some(b=>!documents.some(d=>d.sourceArtifactId===b.sourceArtifactId&&d.sha256===b.sha256)))throw Error("Complete bound quotation documents unavailable");
 return documents;
}
