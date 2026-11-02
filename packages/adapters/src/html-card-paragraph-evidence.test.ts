// @vitest-environment node
import {createHash} from "node:crypto";
import {expect,it} from "vitest";
import {observeHtmlCardParagraphChanges as observe} from "./html-card-paragraph-evidence";
const html=(body:string)=>`<html><head><script>PRIVATE_SCRIPT</script><style>PRIVATE_STYLE</style></head><body><article class="slide-card" id="slide-1">${body}</article></body></html>`;
const reference=(text:string)=>({sha256:createHash("sha256").update(text).digest("hex"),bytes:new TextEncoder().encode(text)});
const fixture=()=>({sourceArtifactId:"source",original:reference(html("<p>input</p><p>output</p>")),candidate:reference(html("<p></p><p>output</p>"))});
it("binds exact physical identities and reports only static paragraph changes",async()=>{
 const x=fixture(),result=await observe(x);
 expect(result).toMatchObject({status:"observed",original:{sha256:x.original.sha256},candidate:{sha256:x.candidate.sha256},changes:[{cardId:"slide-1",removed:["input"],added:[]}],semanticAcceptanceEstablished:false,visibilityEstablished:false,authorizationEstablished:false});
 expect(JSON.stringify(result)).not.toMatch(/PRIVATE_SCRIPT|PRIVATE_STYLE|<p>/);
});
it.each(["original","candidate"] as const)("refuses mismatched %s bytes",async arm=>{
 const x=fixture();x[arm].sha256="0".repeat(64);expect(await observe(x)).toMatchObject({status:"unavailable"});
});
it("snapshots both buffers before awaiting hashes",async()=>{
 const x=fixture(),promise=observe(x);x.original.bytes.fill(0);x.candidate.bytes.fill(0);
 expect(await promise).toMatchObject({status:"observed",changes:[{removed:["input"]}]});
});
it("refuses invalid UTF-8 even when the raw-byte hash matches",async()=>{
 const x=fixture(),bytes=new Uint8Array([0xff]);x.candidate={bytes,sha256:createHash("sha256").update(bytes).digest("hex")};
 expect(await observe(x)).toMatchObject({status:"unavailable"});
});
it("refuses missing card identities and over-budget paragraphs without substituting empty success",async()=>{
 for(const text of ["<html><p>no card</p></html>",html('<p>'+"x".repeat(64_001)+'</p>')]){
  const x=fixture();x.candidate=reference(text);expect(await observe(x)).toMatchObject({status:"unavailable"});
 }
});
it("validates external inputs before comparison",async()=>{
 await expect(observe({...fixture(),sourceArtifactId:""})).rejects.toThrow();
});
