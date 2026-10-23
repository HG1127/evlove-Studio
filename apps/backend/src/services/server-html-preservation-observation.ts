import type { EvolveProject, SourceArtifact } from "@evolution/contracts";
import { htmlCandidateProtection } from "@evolution/core";
import { getServerArtifactStore } from "./artifact-runtime";
import { serverArtifactSha256 } from "./server-experiment-artifacts";
export const HTML_PRESERVATION_EXECUTION_VERSION="html-preservation-execution-v1";

/** Physical comparison returns hashes/counts/booleans only, never HTML or extracted source fragments. */
export async function serverHtmlPreservationObservation(args:{project:EvolveProject;source:SourceArtifact;candidateBytes:Uint8Array;candidateSha256:string}){
  if(!/^(html|htm)$/i.test(args.source.extension))return undefined;
  const unavailable=(detail:string)=>({schemaVersion:"html-preservation-observation-v1",available:false,detail});
  try{
    if(args.candidateBytes.byteLength>12_000_000||await serverArtifactSha256(args.candidateBytes)!==args.candidateSha256)return unavailable("Candidate physical bytes do not match the frozen identity.");
    const store=getServerArtifactStore();
    const id=args.source.storageRef?.trim()||(args.source.inputMode==="upload"?args.source.id:undefined);
    if(!id||!store.getMetadata)return unavailable("Original physical Source metadata is unavailable; preservation is unmeasured.");
    const [blob,metadata]=await Promise.all([store.get(id),store.getMetadata(id)]);
    if(!blob||!metadata||metadata.id!==id||metadata.missionId!==args.project.id||metadata.kind!=="source"
      ||blob.size!==args.source.size||metadata.sizeBytes!==blob.size||blob.size>12_000_000)return unavailable("Original Source identity or size does not match this Mission.");
    const bytes=new Uint8Array(await blob.arrayBuffer());
    const originalSha256=await serverArtifactSha256(bytes);
    if(bytes.byteLength!==blob.size||metadata.sha256!==originalSha256)return unavailable("Original physical bytes do not match their authoritative metadata.");
    const references=args.project.baselineRun?.originalReferences?.filter(proof=>proof.sourceArtifactId===args.source.id)??[];
    if(references.length&&(references.length!==1||references[0]!.missionId!==args.project.id||references[0]!.blobId!==id
      ||references[0]!.sha256!==originalSha256||references[0]!.sizeBytes!==bytes.byteLength))return unavailable("Original bytes differ from the locked Baseline reference.");
    const originalHtml=new TextDecoder("utf-8",{fatal:true}).decode(bytes);
    const candidateHtml=new TextDecoder("utf-8",{fatal:true}).decode(args.candidateBytes);
    const report=htmlCandidateProtection({sourceArtifactId:args.source.id,originalHtml,candidateHtml,protectedItems:args.project.protectedItems??[]});
    return {schemaVersion:"html-preservation-observation-v1",available:true,sourceArtifactId:args.source.id,originalSha256,candidateSha256:args.candidateSha256,
      observation:report.nativeObservation,limitations:["Static comparison only; independent document quality and actual browser evidence remain required.",
        "HTML5 parsing normalizes source syntax; element/text/attribute equality is not Original byte identity.",
        "External resource bytes are not compared. Template descendants are outside these parsed-tree observations when templateCount is nonzero."]};
  }catch{return unavailable("Physical Original comparison could not be completed; it is not a product failure or a preservation pass.");}
}
