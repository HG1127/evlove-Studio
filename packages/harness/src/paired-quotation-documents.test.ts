import {describe,expect,it} from "vitest";
import {htmlNativeEvidenceFixture} from "@evolution/testkit";
import {measuredDocumentObservations} from "./server-measured-review-evidence";
import {pairedQuotationDocuments} from "./paired-quotation-documents";
describe("runtime-owned complete quotation ranges",()=>{
 const run=htmlNativeEvidenceFixture(),binding={sourceArtifactId:run.nativeHtmlProof!.sourceArtifactId,sha256:run.renderedDocumentEvidence!.artifactSha256};
 it("extracts only the exact observed body, excluding wrappers and paragraph facts",()=>{
  const packet=measuredDocumentObservations([run]);
  expect(pairedQuotationDocuments(packet,[binding])).toEqual([{...binding,text:run.renderedDocumentEvidence!.text,complete:true}]);
 });
 it("rejects foreign hashes and missing, legacy, omitted or unverified observations",()=>{
  const packet=measuredDocumentObservations([run]);
  expect(()=>pairedQuotationDocuments(packet,[{...binding,sha256:"e".repeat(64)}])).toThrow("binding differs");
  for(const raw of [{observations:[]},{observations:[{output:"allegedly complete body"}]},measuredDocumentObservations([run],1),measuredDocumentObservations([{...run,verificationStatus:"partial"}])])expect(()=>pairedQuotationDocuments(raw,[binding])).toThrow("unavailable");
 });
 it("rejects out-of-range, incomplete, and conflicting projections without truncation",()=>{
  for(const mutate of [(row:Record<string,unknown>)=>Object.assign(row.quotationSource!,{length:99999999}),(row:Record<string,unknown>)=>Object.assign(row.quotationSource!,{complete:false})]){
   const packet=measuredDocumentObservations([run]);mutate(packet.observations[0]!);expect(()=>pairedQuotationDocuments(packet,[binding])).toThrow();
  }
  const packet=measuredDocumentObservations([run]),other=structuredClone(packet.observations[0]!);other.output="x".repeat(other.output.length);
  packet.observations.push(other);expect(()=>pairedQuotationDocuments(packet,[binding])).toThrow("conflict");
 });
});
