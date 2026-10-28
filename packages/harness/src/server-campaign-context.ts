import {PlanningDocumentContextSchema,PLANNING_ARTIFACT_CONTEXT_CHARS,type EvolveProject,type PlanningDocumentContext} from "@evolution/contracts";
import {htmlPlanningDocument,planningBaselineFailures} from "@evolution/core";
import {retrieveTextContext} from "./context-retrieval";

export type ServerPlanningDocumentLoader=(project:EvolveProject)=>Promise<PlanningDocumentContext[]>;

/** Bounded fallback excerpts are never a claim that the whole source has been supplied. */
export function compactCampaignArtifacts(project:EvolveProject){
  const problem=project.problems.find(item=>item.id===project.selectedProblemId)??project.problems[0];
  const query=[...(problem?.evidence??[]),...(project.diagnosis?.evidence??[]),problem?.title,problem?.summary,problem?.rootCause,
    project.diagnosis?.rootCause,project.diagnosis?.summary,...planningBaselineFailures(project),project.problemStatement,project.goal,project.evolutionCommand,
    ...project.acceptanceRubric.map(criterion=>criterion.requirement)].filter(Boolean).join("\n");
  const championBySource=new Map((project.searchChampion?.candidate?.artifactSnapshots??[]).map(snapshot=>[snapshot.sourceArtifactId,snapshot]));
  const ordered=[...project.sourceArtifacts].sort((a,b)=>Number(b.role==="target")-Number(a.role==="target"));
  let remaining=48_000;
  const selected=ordered.slice(0,12);
  return selected.map((artifact,index)=>{
    const champion=championBySource.get(artifact.id),full=champion?.content||artifact.textContent||artifact.textExcerpt||"";
    // Existing bounded HTML context must also respect the body-only boundary.
    const html=/^html?$/i.test(artifact.extension),body=html?htmlPlanningDocument(full):undefined,projection=html?body?.text:full;
    const safe=projection??"[HTML body boundaries unavailable; raw script/style markup omitted]";
    const targetsRemaining=selected.slice(index).filter(row=>row.role==="target").length;
    const allowance=Math.max(0,Math.min(10_000,artifact.role==="target"?Math.floor(remaining/Math.max(1,targetsRemaining)):remaining));
    const content=retrieveTextContext(safe,query,{maxChars:allowance,maxChunks:4});
    remaining=Math.max(0,remaining-content.length);
    return {id:artifact.id,name:artifact.name,role:artifact.role,artifactKind:artifact.artifactKind,
      structure:html?(body?.outline.map(row=>`${row.id||`section[${row.index}]`}: ${row.title}`)??[]):artifact.structure.slice(0,40),content,
      contentSource:champion?`search-champion:${project.searchChampion?.versionLabel??project.searchChampion?.id}`:"source",originalChars:full.length,
      truncated:content!==safe||projection===undefined,contextRepresentation:html?"html-body-text-excerpt":"source-excerpt"};
  });
}

/** Validate the injected source boundary before replacing bounded excerpts with a complete body. */
export async function serverCampaignArtifacts(project:EvolveProject,load?:ServerPlanningDocumentLoader){
  const compact=compactCampaignArtifacts(project);
  if(project.sourceArtifacts.some(source=>source.role==="target"&&!compact.some(row=>row.id===source.id)))throw new Error("Planning context cannot omit a Target beyond the source-count limit");
  if(!load){
    if(JSON.stringify(compact).length>PLANNING_ARTIFACT_CONTEXT_CHARS)throw new Error("Planning context exceeds capacity; no Target outline was silently truncated");
    return compact;
  }
  const documents=(await load(project)).map(raw=>PlanningDocumentContextSchema.parse(raw));
  if(new Set(documents.map(row=>row.sourceArtifactId)).size!==documents.length)throw new Error("Planning documents have duplicate source identities");
  for(const document of documents){
    const sources=project.sourceArtifacts.filter(source=>source.id===document.sourceArtifactId&&source.role==="target"&&/^html?$/i.test(source.extension));
    if(sources.length!==1||document.currentVersion!==(project.searchChampion?.versionLabel??project.version))throw new Error("Planning document is not bound to the current HTML Target/version");
  }
  const context=compact.map(artifact=>{
    const document=documents.find(row=>row.sourceArtifactId===artifact.id);
    if(!document)return artifact;
    const {text,...metadata}=document;
    return {...artifact,content:text,structure:document.outline.map(row=>document.schemaVersion==="planning-document-context-v2"
      ?`${"element" in row?row.element:""}${row.id?`#${row.id}`:`[outline=${row.index}]`}: ${row.title}`
      :`${row.id||`section[${row.index}]`}: ${row.title}`),originalChars:document.inputChars,
      truncated:false,contextRepresentation:"complete-html-body-text",planningDocument:metadata};
  });
  if(JSON.stringify(context).length>PLANNING_ARTIFACT_CONTEXT_CHARS)throw new Error("Complete planning context exceeds capacity; no chapters were truncated");
  return context;
}

/** A source locator does not authorize raw HTML program/style excerpts in a model narrative. */
export function planningNarrative<T extends {evidenceRefs?:EvolveProject["problems"][number]["evidenceRefs"]}>(project:EvolveProject,narrative:T){
  const html=new Set(project.sourceArtifacts.filter(source=>/^html?$/i.test(source.extension)).map(source=>source.id));
  return {...narrative,evidenceRefs:narrative.evidenceRefs?.map(ref=>ref.artifactId&&html.has(ref.artifactId)?{...ref,excerpt:undefined}:ref)};
}
