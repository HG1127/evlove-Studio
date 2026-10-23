// @vitest-environment node
import {createHash} from "node:crypto";
import {beforeEach,describe,expect,it,vi} from "vitest";
import {ArtifactMetadataSchema,SourceArtifactSchema,type EvolveProject} from "@evolution/contracts";
import {serverHtmlPreservationObservation} from "./server-html-preservation-observation";
const store=vi.hoisted(()=>({get:vi.fn(),getMetadata:vi.fn()}));
vi.mock("./artifact-runtime",()=>({getServerArtifactStore:()=>store}));
vi.mock("./server-experiment-artifacts",()=>({serverArtifactSha256:async(bytes:Uint8Array)=>createHash("sha256").update(bytes).digest("hex")}));
const original='<html><head><style>p{color:red}</style><script>const PRIVATE_SCRIPT_SENTINEL=1;</script></head><body><article class="slide-card" id="slide-1"><p>old</p></article></body></html>';
const sha=(value:string)=>createHash("sha256").update(value).digest("hex");
function fixture(){
  const source=SourceArtifactSchema.parse({id:"source",storageRef:"original",name:"guide.html",extension:"html",mimeType:"text/html",artifactKind:"document",role:"target",size:Buffer.byteLength(original),inputMode:"upload",parseStatus:"ready",createdAt:"2026-10-23T00:00:00.000Z"});
  const metadata=ArtifactMetadataSchema.parse({schemaVersion:"artifact-v1",id:"original",missionId:"mission",kind:"source",bucket:"artifacts",objectPath:"original",mimeType:"text/html",sizeBytes:source.size,sha256:sha(original),createdAt:source.createdAt,updatedAt:source.createdAt});
  store.get.mockResolvedValue(new Blob([original]));store.getMetadata.mockResolvedValue(metadata);
  const candidateHtml=original.replace("<p>old</p>","<p>clearer configuration</p>");
  return {project:{id:"mission",protectedItems:[]} as unknown as EvolveProject,source,candidateBytes:new TextEncoder().encode(candidateHtml),candidateSha256:sha(candidateHtml),metadata};
}
beforeEach(()=>{store.get.mockReset();store.getMetadata.mockReset();});
describe("physical HTML preservation observation",()=>{
  it("binds both physical identities and returns metadata without raw HTML or script fragments",async()=>{
    const args=fixture(),result=await serverHtmlPreservationObservation(args);
    expect(result).toMatchObject({available:true,originalSha256:sha(original),candidateSha256:args.candidateSha256,
      observation:{scriptBlocksUnchanged:true,styleBlocksUnchanged:true,elementTreeAndAttributesUnchanged:true,originalSlideCardCount:1}});
    expect(JSON.stringify(result)).not.toContain("PRIVATE_SCRIPT_SENTINEL");expect(JSON.stringify(result)).not.toContain("<html>");
  });
  it.each(["mission","sha","size","kind"])("does not claim preservation on mismatched Original %s",async field=>{
    const args=fixture();const metadata={...args.metadata};
    if(field==="mission")metadata.missionId="other";if(field==="sha")metadata.sha256="c".repeat(64);
    if(field==="size")metadata.sizeBytes++;if(field==="kind")metadata.kind="candidate";
    store.getMetadata.mockResolvedValue(metadata);
    expect(await serverHtmlPreservationObservation(args)).toMatchObject({available:false});
  });
  it("reports script changes as observations without inventing a quality or runtime verdict",async()=>{
    const args=fixture(),changed=new TextDecoder().decode(args.candidateBytes).replace("SENTINEL=1","SENTINEL=2");
    args.candidateBytes=new TextEncoder().encode(changed);args.candidateSha256=sha(changed);
    const result=await serverHtmlPreservationObservation(args);
    expect(result).toMatchObject({available:true,observation:{scriptBlocksUnchanged:false}});
    expect(result).not.toHaveProperty("passed");
  });
  it("refuses a Candidate byte/hash mismatch before claiming a comparison",async()=>{
    const args=fixture();args.candidateSha256="f".repeat(64);
    expect(await serverHtmlPreservationObservation(args)).toMatchObject({available:false});
  });
  it("does not replace a previously locked Original with changed source metadata",async()=>{
    const args=fixture();
    args.project.baselineRun={originalReferences:[{schemaVersion:"original-artifact-reference-v1",missionId:"mission",sourceArtifactId:"source",blobId:"original",sha256:"d".repeat(64),sizeBytes:args.source.size}]} as EvolveProject["baselineRun"];
    expect(await serverHtmlPreservationObservation(args)).toMatchObject({available:false});
  });
});
