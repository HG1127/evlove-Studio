// @vitest-environment node
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { HtmlProtectionObligation } from "@evolution/contracts";
import { prepareServerHtmlProtectionVisualPairs, validateServerHtmlProtectionVisualObservations } from "./server-html-protection-visual-observation";
function tile(index: number, y: number) {
  const bytes = Buffer.alloc(33); Buffer.from([137,80,78,71,13,10,26,10]).copy(bytes); bytes.write("IHDR",12,"ascii"); bytes.writeUInt32BE(10,16); bytes.writeUInt32BE(10,20);
  return { stateId: "boot:tile:" + index, material: { value: { image: { mimeType: "image/png", base64: bytes.toString("base64"), sha256: createHash("sha256").update(bytes).digest("hex"), byteLength: bytes.length },
    region: { x:0,y,width:10,height:10 }, viewport: { width:10,height:10 }, documentSize: { width:10,height:20 }, before: {}, after: {}, nativeScrollDispatches: index } } };
}
const required: HtmlProtectionObligation[] = [{ id:"visual", sourceArtifactId:"source", kind:"visual-layout", target:"document", description:"full", evidenceKind:"visual", support:"unresolved" }];
function fixture() {
  const originalTiles = [tile(0,0),tile(1,10)], executedTiles = structuredClone(originalTiles);
  const args = { originalTiles, executedTiles, expectedDocumentStates:["boot"], nativeComplete:true };
  const pairs = prepareServerHtmlProtectionVisualPairs(args), raw = [{ schemaVersion:"html-protection-visual-observations-v1", observations:pairs.map(pair=>({ observationId:pair.observationId,
    originalImageSha256:pair.original.image.sha256,executedImageSha256:pair.executed.image.sha256,status:"retained",originalRegions:[{x:0,y:0,width:10,height:10}],executedRegions:[{x:0,y:0,width:10,height:10}],observedRendering:"Complete actual pixels",differences:[] })) }];
  return { args,pairs,raw,verify:{pairs,raw,required,unresolvedRuntimeObligationIds:[] as string[]} };
}
describe("complete physical paired native visual observations",()=>{
  it("checks every PNG tile and actual full image regions",()=>{const f=fixture();expect(f.pairs).toHaveLength(2);expect(validateServerHtmlProtectionVisualObservations(f.verify).evidence[0]?.verificationStatus).toBe("verified");});
  it.each(["bottom","middle","order","horizontal","png","native"] as const)("refuses incomplete or foreign %s coverage",kind=>{
    const f=fixture();if(kind==="bottom")f.args.executedTiles.pop();if(kind==="middle")f.args.executedTiles[1]!.material.value.region.y=11;
    if(kind==="order")f.args.executedTiles.reverse();if(kind==="horizontal")f.args.executedTiles[0]!.material.value.documentSize.width=30;
    if(kind==="png")f.args.executedTiles[0]!.material.value.image.base64="eA==";if(kind==="native")f.args.nativeComplete=false;
    expect(()=>prepareServerHtmlProtectionVisualPairs(f.args)).toThrow();
  });
  it.each(["hash","region","duplicate"] as const)("rejects model %s claims",kind=>{
    const f=fixture(),row=f.raw[0]!.observations[0]!;if(kind==="hash")row.originalImageSha256="f".repeat(64);if(kind==="region")row.originalRegions[0]!.width=1;if(kind==="duplicate")f.raw[0]!.observations.push(structuredClone(row));
    expect(()=>validateServerHtmlProtectionVisualObservations(f.verify)).toThrow();
  });
  it("keeps real pixel scope partial while continuous responsive/runtime scope remains unknown",()=>{const f=fixture();f.verify.unresolvedRuntimeObligationIds=["responsive"];const result=validateServerHtmlProtectionVisualObservations(f.verify);expect(result.supportedObligationIds).toEqual([]);expect(result.evidence[0]?.verificationStatus).toBe("partial");});
  it("retains missing and unavailable selected-model image observations as gaps",()=>{const f=fixture();f.raw[0]!.observations.pop();expect(validateServerHtmlProtectionVisualObservations(f.verify).gaps).toContain("html-protection-selected-model-full-visual-observation-unavailable");});
});

describe("confirmed finite native visual binding",()=>{
  it.each(["missing","foreign","matched"] as const)("requires independently reconstructed complete native delta: %s",kind=>{
    const f=fixture();for(const pair of f.pairs)pair.nativeComparison={sha256:"d".repeat(64)} as never;
    const raw=f.raw.map(batch=>({...batch,observations:batch.observations.map(row=>({...row,
      ...(kind!=="missing"?{nativeComparisonSha256:(kind==="matched"?"d":"e").repeat(64)}:{})}))}));
    if(kind==="matched")expect(validateServerHtmlProtectionVisualObservations({...f.verify,raw}).evidence[0]?.verificationStatus).toBe("verified");
    else expect(()=>validateServerHtmlProtectionVisualObservations({...f.verify,raw})).toThrow("native-comparison-not-observed");
  });
});
