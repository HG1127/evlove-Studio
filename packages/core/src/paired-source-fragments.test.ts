// @vitest-environment node
import {it,expect} from "vitest";import {createHash} from "node:crypto";
import {buildPairedSourceFragments,resolvePairedSourceSelections} from "./paired-source-fragments";
import {renderPairedSourceQuotationTemplate} from "./paired-source-quotation-template";
const sha=(s:string)=>createHash("sha256").update(s).digest("hex");
const original={sourceArtifactId:"s",sha256:"a".repeat(64),text:"Approval is required.\r\n\nPreserve audit evidence.",complete:true as const};
const candidate={...original,sha256:"b".repeat(64),text:"Approval is required.\r\n\nPreserve audit evidence.\nRetain retry details."};
it("deduplicates only identical logical source identities and partitions the body exactly",()=>{
 const built=buildPairedSourceFragments([candidate,original,original],sha),again=buildPairedSourceFragments([original,candidate],sha);expect(again).toEqual(built);expect(built.manifest.documents).toHaveLength(2);
 for(const doc of built.manifest.documents){const body=doc.sha256===original.sha256?original.text:candidate.text;expect(doc.fragments.map(f=>f.text).join("")).toBe(body);expect(doc.bodyTextSha256).toBe(sha(body));for(const f of doc.fragments)expect(body.slice(f.start,f.start+f.length)).toBe(f.text);}
 const separate=buildPairedSourceFragments([original,{...original,sourceArtifactId:"other"}],sha);expect(separate.manifest.documents).toHaveLength(2);
});
it("rejects contradictory text under one source/hash identity",()=>{expect(()=>buildPairedSourceFragments([original,{...original,text:"Changed"}],sha)).toThrow("Conflicting");});
it("keeps every surrogate pair, CRLF and whitespace unchanged at contextual span boundaries",()=>{
 const body=("中".repeat(799)+"😀").repeat(4)+"\r\n\n\t尾\n",r=buildPairedSourceFragments([{...original,text:body}],sha).manifest.documents[0]!;
 expect(r.fragments.map(f=>f.text).join("")).toBe(body);expect(r.fragments.every(f=>f.length<=800)).toBe(true);
 for(const [i,f] of r.fragments.entries()){
  expect(/[\uD800-\uDBFF]$/.test(f.text)&&/^[\uDC00-\uDFFF]/.test(r.fragments[i+1]?.text??"")).toBe(false);
 }
});
it("binds IDs to source, artifact, body, range and segmentation version",()=>{
 const base=buildPairedSourceFragments([original],sha);for(const changed of [{...original,sourceArtifactId:"t"},{...original,sha256:"c".repeat(64)},{...original,text:original.text+"!"}])expect(buildPairedSourceFragments([changed],sha).manifest.documents[0]!.fragments[0]!.id).not.toBe(base.manifest.documents[0]!.fragments[0]!.id);
});
it("resolves exact text from an explicit present selection, without accepting a foreign slot or unknown ID",()=>{
 const manifest=buildPairedSourceFragments([original,candidate],sha).manifest,own=manifest.documents.find(d=>d.sha256===original.sha256)!,foreign=manifest.documents.find(d=>d.sha256===candidate.sha256)!;
 const x={subjectDocuments:[original],comparisonDocuments:[candidate],selections:[{noteIndex:0,relation:"present",spanId:own.fragments[0]!.id}]};
 const valid=resolvePairedSourceSelections(x,sha);expect(valid.issues).toEqual([]);expect(valid.quotations![0]!.quote).toBe(own.fragments[0]!.text);
 expect(resolvePairedSourceSelections({...x,selections:[{...x.selections[0]!,spanId:foreign.fragments[0]!.id}]},sha).issues[0]!.code).toBe("foreign-present-source");
 expect(resolvePairedSourceSelections({...x,selections:[{...x.selections[0]!,spanId:"q"+"f".repeat(24)}]},sha).issues[0]!.code).toBe("unknown-span");
});
it("still requires an explicit note marker and a verified complete-body absence",()=>{
 const manifest=buildPairedSourceFragments([original,candidate],sha).manifest,other=manifest.documents.find(d=>d.sha256===candidate.sha256)!,selected=other.fragments.at(-1)!;
 const x={subjectDocuments:[original],comparisonDocuments:[candidate],selections:[{noteIndex:0,relation:"absent",spanId:selected.id}]},resolved=resolvePairedSourceSelections(x,sha);
 expect(resolved.issues).toEqual([]);expect(renderPairedSourceQuotationTemplate({...x,notes:["Missing detail [[q:0]]"],quotations:resolved.quotations}).issues).toEqual([]);
 expect(renderPairedSourceQuotationTemplate({...x,notes:["Uncited assertion"],quotations:resolved.quotations}).issues[0]!.code).toBe("missing-marker");
 const longer={...candidate,text:original.text+"\n"+"x".repeat(900)},longerManifest=buildPairedSourceFragments([original,longer],sha).manifest,common=longerManifest.documents.find(d=>d.sha256===longer.sha256)!.fragments[0]!;
 const present=resolvePairedSourceSelections({...x,comparisonDocuments:[longer],selections:[{...x.selections[0]!,spanId:common.id}]},sha);
 expect(renderPairedSourceQuotationTemplate({...x,comparisonDocuments:[longer],notes:["Missing [[q:0]]"],quotations:present.quotations}).issues).toContainEqual({code:"unsupported-absence",noteIndex:0});
});
it("rejects literal absence when a combining mark is present before Unicode composition",()=>{
 const subject={...original,text:"a\u0301"},comparison={...candidate,text:"\u0301"};
 const manifest=buildPairedSourceFragments([subject,comparison],sha).manifest,span=manifest.documents.find(d=>d.sha256===comparison.sha256)!.fragments[0]!;
 const resolved=resolvePairedSourceSelections({subjectDocuments:[subject],comparisonDocuments:[comparison],selections:[{noteIndex:0,relation:"absent",spanId:span.id}]},sha);
 expect(resolved.issues).toContainEqual({code:"unsupported-absence",noteIndex:0});expect(resolved.quotations).toBeUndefined();
});
it("uses short exact manifest-local aliases while the full manifest binds the source and range",()=>{
 const policy="manifest-local-source-fragments-v2",built=buildPairedSourceFragments([candidate,original],sha,policy);
 expect(built.manifest.policy).toBe(policy);expect(built.manifest.documents.map(d=>d.fragments[0]!.id)).toEqual(["d0s0","d1s0"]);
 expect(buildPairedSourceFragments([original,candidate],sha,policy)).toEqual(built);
 expect(buildPairedSourceFragments([{...original,text:original.text+"!"},candidate],sha,policy).sha256).not.toBe(built.sha256);
 const input={subjectDocuments:[original],comparisonDocuments:[candidate],selections:[{noteIndex:0,relation:"present",spanId:"d0s0"}]};
 expect(resolvePairedSourceSelections(input,sha,policy).quotations![0]!.quote).toBe(original.text);
 expect(resolvePairedSourceSelections({...input,selections:[{...input.selections[0]!,spanId:"d1s0"}]},sha,policy).issues).toContainEqual({code:"foreign-present-source",noteIndex:0});
 expect(resolvePairedSourceSelections({...input,selections:[{...input.selections[0]!,spanId:"d63s19999"}]},sha,policy).issues).toContainEqual({code:"unknown-span",noteIndex:0});
 expect(resolvePairedSourceSelections(input,sha).issues.length).toBeGreaterThan(0);
});
