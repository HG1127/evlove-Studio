import {PlanningDocumentContextSchema,PLANNING_DOCUMENT_CONTEXT_VERSION,PLANNING_DOCUMENT_TOTAL_CHARS,type EvolveProject} from "@evolution/contracts";
import {htmlPlanningDocument} from "@evolution/core";
import {trustedServerBaselineChampion} from "@evolution/harness";
import {readServerCandidateParentText,serverArtifactSha256} from "./server-experiment-artifacts";
import {serverRepairMeasuredTextAuthorized} from "./server-ai-repair-consent";

/** Reuses exact-Mission body consent; no model or Sandbox call. Read the actual current parent. */
export async function buildServerPlanningDocuments(project:EvolveProject,ports?:{readCurrentText?:typeof readServerCandidateParentText}){
  if(!serverRepairMeasuredTextAuthorized(project.id))return [];
  const champion=trustedServerBaselineChampion(project);
  if(project.searchChampion&&!champion)throw new Error("Planning requires the trusted current Champion, not a stale Source fallback");
  let remaining=PLANNING_DOCUMENT_TOTAL_CHARS;
  const documents=[];
  for(const source of project.sourceArtifacts.filter(row=>row.role==="target"&&/^html?$/i.test(row.extension))){
    const parents=champion?.artifactSnapshots.filter(snapshot=>snapshot.sourceArtifactId===source.id)??[];
    const originals=(project.baselineRun.originalReferences??[]).filter(ref=>ref.sourceArtifactId===source.id&&ref.missionId===project.id);
    if(champion&&(parents.length!==1||!parents[0]?.frozenArtifact)||!champion&&originals.length>1)throw new Error("Planning parent identity is ambiguous");
    const expected=parents[0]?.frozenArtifact?.sha256??originals[0]?.sha256;
    if(!expected&&(source.inputMode!=="paste"||source.storageRef?.trim()))throw new Error("Complete HTML planning requires the Baseline-bound original SHA-256");
    if(!champion&&originals[0]&&(originals[0].blobId!==(source.storageRef?.trim()||source.id)||originals[0].sizeBytes!==source.size))throw new Error("Planning original reference differs from the current Source");
    const html=await (ports?.readCurrentText??readServerCandidateParentText)(project,source),parentSha256=await serverArtifactSha256(new TextEncoder().encode(html));
    if(expected&&expected!==parentSha256)throw new Error("Planning physical parent changed after Baseline; cannot use a stale index");
    const body=htmlPlanningDocument(html);
    if(!body)throw new Error("Complete HTML planning needs physical body boundaries");
    const document=PlanningDocumentContextSchema.parse({schemaVersion:PLANNING_DOCUMENT_CONTEXT_VERSION,sourceArtifactId:source.id,
      currentVersion:champion?(project.searchChampion!.versionLabel):project.version,parentSha256,inputChars:html.length,text:body.text,textChars:body.text.length,
      complete:true,outline:body.outline,excludes:["scripts","styles","templates","noscript","svg","executable-attributes","runtime-verdicts"]});
    remaining-=JSON.stringify(document).length;
    if(remaining<0)throw new Error("Complete planning documents exceed the context budget; no chapters were truncated");
    documents.push(document);
  }
  return documents;
}
