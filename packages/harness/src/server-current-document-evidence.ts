import {z} from "zod";
import type {EvolveProject,TargetRunResult,TestCase} from "@evolution/contracts";
import {criterionCanUseLocalSnapshotEvidence} from "@evolution/core";

const CompleteHtmlText=z.object({
  id:z.string().min(1),artifactSha256:z.string().regex(/^[a-f0-9]{64}$/),
  content:z.string().min(1).max(28_000),truncated:z.literal(false),
  contextRepresentation:z.literal("complete-html-static-text-projection"),
  originalChars:z.number().int().positive(),projectionChars:z.number().int().positive(),excludes:z.array(z.string()),
}).passthrough().refine(row=>row.projectionChars<=row.originalChars&&row.projectionChars<=row.content.length);

/** Reading the complete current document is execution evidence; the independent Judge determines quality. */
export function currentHtmlDocumentTextObservation(project:EvolveProject,test:TestCase,raw:Array<Record<string,unknown>>):TargetRunResult|undefined{
  if(test.executionMode!=="artifact-runtime"||!test.criterionIds.length)return undefined;
  const mapped=project.acceptanceRubric.filter(c=>test.criterionIds.includes(c.id));
  if(mapped.length!==new Set(test.criterionIds).size||!mapped.every(c=>criterionCanUseLocalSnapshotEvidence(project,c)))return undefined;
  const ids=new Set(mapped.flatMap(c=>c.artifactIds));
  const targets=project.sourceArtifacts.filter(s=>s.role==="target"&&(!ids.size||ids.has(s.id)));
  if(!targets.length||(ids.size&&targets.length!==ids.size)||targets.some(s=>!/^(html|htm)$/i.test(s.extension)
    ||!["document","knowledge","generic"].includes(s.artifactKind)))return undefined;
  const observations=targets.map(source=>{
    const entries=raw.filter(row=>row.id===source.id);
    return entries.length===1?CompleteHtmlText.safeParse(entries[0]):undefined;
  });
  if(observations.some(p=>!p?.success))return undefined;
  const files=observations.map(p=>p!.data!);
  if(files.reduce((sum,file)=>sum+file.content.length,0)>56_000)return undefined;
  if(files.some(file=>!["scripts","styles","visual-fidelity","runtime-behavior"].every(scope=>file.excludes.includes(scope))))return undefined;
  return {testCaseId:test.id,verificationStatus:"verified",latencyMs:0,cost:0,
    ...(files.length===1?{artifactHash:files[0]!.artifactSha256}:{}),
    output:"COMPLETE CURRENT DOCUMENT TEXT OBSERVATION (not a passing verdict)\n"+files.map(file=>
      `Source ${file.id} · SHA-256 ${file.artifactSha256}\n${file.content}`).join("\n\n"),
    trace:[{id:"current-document-text-"+test.id,stage:"current-document-text-evidence",status:"pass",
      summary:"实际当前文件的完整正文已读取，质量由独立评审判断",
      detail:JSON.stringify(files.map(file=>({sourceArtifactId:file.id,sha256:file.artifactSha256,projectionChars:file.projectionChars,excludes:file.excludes})))}]};
}
