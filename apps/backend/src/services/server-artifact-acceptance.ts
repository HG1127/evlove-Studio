import type {AcceptanceCriterion,Candidate,EvolveProject,FrozenArtifact,RepairArtifactAiResult} from "@evolution/contracts";
import {campaignRepairLimitStopReason,evidenceFingerprint,htmlBuildBodyEditAnchors,htmlParagraphConstructionContext,htmlKnownSemanticComponents,htmlRepairBodyContext,htmlRepairTextNodeContext,resolveBoundHtmlBodyNodeEdits,indexUniqueById,reconcileAcceptedOfflineChampion,visibleRepairFeedbackContext,userGoalScopeContext,userGoalProgress} from "@evolution/core";
import {isKnownHtmlNativeSubject} from "@evolution/adapters/html-native-profile";
import {measuredDocumentObservations,runServerArtifactAcceptance,runServerVisibleRepair,type ServerArtifactVerification} from "@evolution/harness";
import {runServerAi} from "./ai-gateway";
import {getServerArtifactStore} from "./artifact-runtime";
import {materializeServerCandidateArtifacts,readServerCandidateParentText,readServerCandidateParentNativeStructure,serverArtifactSha256,verifyServerCandidateFrozenArtifact} from "./server-experiment-artifacts";

import {buildServerCandidateTargetContext,requireServerCandidateOutputModes} from "./server-candidate-context";
import {verifyServerIndependentFinalHoldout} from "./server-independent-final-holdout";
import {serverRepairMeasuredTextAuthorized} from "./server-ai-repair-consent";
import {archiveServerRepairEvidence} from "./server-repair-evidence";
import {SERVER_HTML_PARAGRAPH_CONSTRUCTION_INSTRUCTION} from "./server-html-build-context";
import {serverCandidateConstructionCorrection} from "./server-candidate-construction-feedback";
import {assertServerControlExecutionActive} from "./server-control-execution";

export async function verifyServerFrozenCandidateArtifacts({project,candidate}:{project:EvolveProject;candidate:Candidate}):Promise<ServerArtifactVerification>{
  const targetIds=project.sourceArtifacts.filter((artifact)=>artifact.role==="target").map((artifact)=>artifact.id);
  const targets=indexUniqueById(targetIds,(id)=>id);
  const snapshots=indexUniqueById(candidate.artifactSnapshots,(item)=>item.sourceArtifactId);
  if(targets.duplicateIds.size||snapshots.duplicateIds.size||candidate.artifactSnapshots.length!==targetIds.length){
    return {verified:[],unavailable:["Target 与 Candidate Snapshot 的 sourceArtifactId 必须一一对应且唯一"],failed:[]};
  }
  const verified:FrozenArtifact[]=[];
  const unavailable:string[]=[];
  const failed:string[]=[];
  for(const targetId of targetIds){
    const snapshot=snapshots.byId.get(targetId);
    const receipt=snapshot?.frozenArtifact;
    if(!snapshot||!receipt||receipt.sourceArtifactId!==targetId){
      unavailable.push(`${targetId}: Candidate 缺少 frozen Artifact receipt`);
      continue;
    }
    const blob=await getServerArtifactStore().get(receipt.blobId);
    if(!blob){
      unavailable.push(`${targetId}: Artifact Blob ${receipt.blobId} 不可用`);
      continue;
    }
    if(!await verifyServerCandidateFrozenArtifact(snapshot)){
      failed.push(`${targetId}: frozen bytes/hash/size、Snapshot 正文/hash 或文件名/MIME 与 receipt 不一致`);
      continue;
    }
    verified.push(receipt);
  }
  return {verified,unavailable,failed};
}

export async function repairServerArtifactCandidate(args:{
  project:EvolveProject;
  candidate:Candidate;
  failedCriteria:AcceptanceCriterion[];
  attempt:number;
  feedbackPhase?:"visible";
}){
  const failedIds=new Set(args.failedCriteria.map((criterion)=>criterion.id));
  const feedbackContext=args.feedbackPhase==="visible"?visibleRepairFeedbackContext(args.project,args.candidate,args.failedCriteria.map(c=>c.id),args.attempt):undefined;
  const relativeFeedback=feedbackContext?.kind==="relative-target-regression";
  const mixedFeedback=feedbackContext?.kind==="combined-criterion-failure";
  const authorizedBody=serverRepairMeasuredTextAuthorized(args.project.id);
  const expectedParents=new Map<string,string>();
  const htmlParents=new Map<string,{html:string;sha256:string;nodes:ReturnType<typeof htmlRepairTextNodeContext>;components:ReturnType<typeof htmlKnownSemanticComponents>;paragraphs?:ReturnType<typeof htmlParagraphConstructionContext>}>();
  const focused = {...args.candidate, change: args.failedCriteria.map((criterion) => `${criterion.title}: ${criterion.requirement}`).join("\n")};
  const rawContexts = await buildServerCandidateTargetContext(args.project,focused,
    async(source)=>{
      const actual=await readServerCandidateParentText(args.project,source,args.candidate);
      expectedParents.set(source.id,await serverArtifactSha256(new TextEncoder().encode(actual)));
      if(!authorizedBody||!/^html?$/i.test(source.extension))return actual;
      const safe=htmlRepairBodyContext(actual);
      if(safe===undefined)throw new Error("HTML repair requires complete physical body boundaries before sharing mutation context");
      const sha256=args.candidate.artifactSnapshots.find(snapshot=>snapshot.sourceArtifactId===source.id)?.frozenArtifact?.sha256;
      if(!sha256)throw new Error("HTML body repair requires the verified frozen parent SHA-256");
      const known=isKnownHtmlNativeSubject(actual);
      htmlParents.set(source.id,{html:actual,sha256,nodes:htmlRepairTextNodeContext(actual,sha256),components:known?htmlKnownSemanticComponents(actual):[],
        ...(known?{paragraphs:htmlParagraphConstructionContext(actual,sha256,htmlBuildBodyEditAnchors(actual,sha256))}:{})});
      return safe;
    },args.candidate,
    (source)=>readServerCandidateParentNativeStructure(args.project,source,args.candidate),{completeHtmlBuildContext:false});
  const contexts=rawContexts.map(context=>{
    const parent=htmlParents.get(context.id);
    return parent?{...context,content:"",structuredContext:undefined,mutationMode:"html-body-node-edits-v1",truncated:false,
      originalChars:parent.html.length,parentSha256:parent.sha256,htmlTextNodes:parent.nodes,htmlRendererComponents:parent.components,
      htmlParagraphGroups:parent.paragraphs,
      contextProjection:"complete body text nodes with physical edit IDs; no raw tags, attributes, scripts, styles or template code"}:context;
  });
  const visibleFeedback=args.feedbackPhase==="visible"?args.project.experimentRun.candidateResults.find(result=>result.candidateId===args.candidate.id):undefined;
  const boundObservation=authorizedBody
    &&args.project.validationRun.candidateId===args.candidate.id
    &&args.project.validationRun.evidenceFingerprint===evidenceFingerprint(args.project,args.candidate);
  const payload={
    ...(userGoalScopeContext(args.project)?{winnerGoalScope:userGoalScopeContext(args.project),
      userGoalProgress:visibleFeedback&&args.project.baselineRun.result?userGoalProgress(args.project,visibleFeedback.evaluation,args.project.baselineRun.result):
        boundObservation&&args.project.validationRun.evaluation&&args.project.validationRun.baselineEvaluation?
          userGoalProgress(args.project,args.project.validationRun.evaluation,args.project.validationRun.baselineEvaluation,args.project.hiddenEvalSuite):undefined}:{}),
    htmlParagraphConstructionInstruction:SERVER_HTML_PARAGRAPH_CONSTRUCTION_INSTRUCTION,
    project:{
      name:args.project.name,
      objectType:args.project.objectType,
      goal:args.project.goal,
      evolutionCommand:args.project.evolutionCommand,
      protectedItems:args.project.protectedItems,
      editableItems:args.project.editableItems,
    },
    candidate:{
      id:args.candidate.id,
      title:args.candidate.title??args.candidate.name,
      patches:authorizedBody?[]:args.candidate.patches,
      artifacts:contexts.map((context)=>({
        sourceArtifactId:context.id,
        name:context.name,
        mimeType:context.mimeType,
        extension:context.extension,
        artifactKind:context.artifactKind,
        structuredContext:context.structuredContext,
        content:context.content,
        contentHash:context.currentSnapshotHash,
        currentVersion:context.currentVersion,
        originalChars:context.originalChars,
        truncated:context.truncated,
        mutationMode:context.mutationMode,
        contextProjection:"contextProjection" in context?context.contextProjection:undefined,
        parentSha256:"parentSha256" in context?context.parentSha256:undefined,
        htmlTextNodes:"htmlTextNodes" in context?context.htmlTextNodes:undefined,
        htmlRendererComponents:"htmlRendererComponents" in context?context.htmlRendererComponents:undefined,
        htmlParagraphGroups:"htmlParagraphGroups" in context?context.htmlParagraphGroups:undefined,
      })),
    },
    feedbackPhase:args.feedbackPhase??"hidden",
    feedbackContext,
    feedbackInstruction:mixedFeedback?"This one repair combines verified absolute criterion failures with separately verified user-goal regressions against the same Visible Baseline. Rows labelled relative-target-regression still PASS their original absolute minimums; restore their paired baseline quality without fabricating absolute FAIL scores. Address the entire supplied scope in this same repair, preserve other improvements and protected behavior, and rerun every original gate. No extra repair, new final paper, threshold or Winner rule is granted.":relativeFeedback?"The requested target criteria still PASS their original absolute minimums. The measured failure is a paired target regression against the same Visible Baseline, not a fabricated absolute FAIL. Improve only those verified regressed targets, preserve other improvements and all protected behavior, and rerun every original gate. A repair is not acceptance and cannot change the Winner rule.":undefined,
    measuredCandidateDocuments:measuredDocumentObservations(authorizedBody&&visibleFeedback?visibleFeedback.runs:boundObservation?args.project.validationRun.runs:[]),
    scopeInstruction:"Address the entire supplied verified feedback scope in the actual document. Use complete htmlTextNodes and existing measuredCandidateDocuments to understand its full chapter/configuration scope; do not replace a request for concrete configuration detail with generic instructions telling the reader to add details. These are existing measured text observations, not quality verdicts or script/style/runtime proof. For html-body-node-edits-v1 use only exact supplied anchorIds and complete replacement plain text. The server binds the current frozen parent; do not select a parent or return a hash. Never concatenate rendered paragraphs into a raw HTML anchor. Spread concrete, accurate configuration explanations across the chapters that need them, preserving all existing facts and protected interactions. All original goals, protected items and acceptance thresholds remain binding. A new Candidate must pass the complete Visible suite, ordinary Hidden and the unchanged independent final paper before acceptance.",
    failedCriteria:args.failedCriteria.map((criterion)=>{
      const score=(visibleFeedback?.evaluation??args.project.validationRun.evaluation)?.criterionScores?.find((item)=>item.criterionId===criterion.id);
      const comparison=feedbackContext?.comparisons.find(c=>c.criterionId===criterion.id);
      return {
        criterionId:criterion.id,
        title:criterion.title,
        requirement:criterion.requirement,
        minScore:criterion.minScore,
        validationMethod:criterion.validationMethod,
        evidence:score?.evidence??[],
        gaps:score?.gaps??[],
        ...(comparison?{feedbackKind:"relative-target-regression" as const,absoluteMinimumPassed:true,currentScore:score?.score,
          baselineScore:comparison.baselineScore}:mixedFeedback?{feedbackKind:"absolute-criterion-failure" as const,absoluteMinimumPassed:false,currentScore:score?.score}:{}),
      };
    }),
    instruction:"Change only the supplied criteria with VERIFIED evidence above. Preserve every other artifact behavior and protected item. Return exactly one artifact for every supplied target. For an unchanged DOCX/PPTX/XLSX/XLS/ODS/CSV/TSV/ZIP target return JSON {kind:'keep-parent',sourceArtifactId:'EXACT target id'} so the server reuses the verified frozen bytes; never reconstruct native file bytes from an excerpt. For other unchanged targets return their current content; for unchanged excerpted text targets return one exact text-edit with identical before/after. For changed DOCX targets return {kind:'document',parts:[{path:'word/document.xml',textRuns:[{index:0,text:'new text'}]}]}; for PPTX return {kind:'presentation',slides:[{number:1,textRuns:[{index:0,text:'new text'}]}]}, using only real indexed paths/slides from structuredContext. For changed spreadsheets return {kind:'spreadsheet',sheets:[{name:'Existing Sheet',cells:[{address:'A1',value:'new value'}]}]} using only real Sheet/A1 locations and preserving formulas; do not fabricate calculated formula caches. Every changed native target must have actual differences. For codebase/package targets return a JSON overlay {kind:'codebase',overlay:true,files:[{path,content}],deletions:[path]} containing only actual changes/deletions. For text artifacts with mutationMode text-edits, return content JSON {kind:'text-edits',edits:[{before,after,start?,end?}]}, anchored verbatim to current Candidate chunks without chunk markers or ellipses. The server applies edits to the complete tested Candidate, preserving untouched bytes. Do not rewrite a whole artifact from excerpts. The output becomes a NEW Candidate and must be re-tested on the full Hidden Holdout.",
    htmlBodyInstruction:"For mutationMode html-body-node-edits-v1, artifact.content MUST be JSON {kind:'html-body-node-edits-v1',edits:[{anchorId:'EXACT supplied ID',text:'complete replacement plain text'}]}. Return only changed nodes. DO NOT include parentSha256 or any parent/hash field: the server owns that binding. Text is plain prose, never HTML markup; the server escapes it and preserves all surrounding markup/code/styles. Preserve htmlRendererComponents labels and their two paragraph slots; new text beside those slots inside their content-block would be discarded by the renderer. Do not use text-edits or rendered text as a raw HTML anchor for these targets.",
  };
  const nextId=`${args.candidate.id}-repair-${args.attempt}-${Date.now()}`;
  const construct=async(response:RepairArtifactAiResult)=>{
    const artifacts=response.artifacts.map(artifact=>{
      const parent=htmlParents.get(artifact.sourceArtifactId);
      return parent?{...artifact,content:resolveBoundHtmlBodyNodeEdits(parent.html,artifact.content,parent.sha256)}:artifact;
    });
    requireServerCandidateOutputModes(contexts,artifacts);
    if(response.repairedCriteria.some((id)=>!failedIds.has(id))){
      throw new Error(`Repair AI attempted out-of-scope criteria: ${response.repairedCriteria.filter((id)=>!failedIds.has(id)).join("、")}`);
    }
    if(!response.repairedCriteria.length)throw new Error("Repair AI did not acknowledge any VERIFIED failed criterion");
    const currentBySource=new Map(args.candidate.artifactSnapshots.map((snapshot)=>[snapshot.sourceArtifactId,snapshot.content.trim()]));
    if(response.artifacts.length&&response.artifacts.every((artifact)=>currentBySource.get(artifact.sourceArtifactId)===artifact.content.trim())){
      throw new Error("Repair AI returned a no-op artifact; refusing to mint a new Candidate identity");
    }
    const next:Candidate={
      ...args.candidate,
      id:nextId,
      name:`${args.candidate.name} · Repair ${args.attempt}`,
      title:`${args.candidate.title??args.candidate.name} · Server Repair ${args.attempt}`,
      status:"draft",
      artifactSnapshots:[],
      artifactBuildStatus:"idle",
      artifactBuildSummary:undefined,
      notes:[...args.candidate.notes,`Server Targeted Repair ${args.attempt}: ${response.summary}`],
    };
    return materializeServerCandidateArtifacts(
      args.project,
      next,
      artifacts.map((artifact)=>({...artifact,buildMode:"ai-full" as const})),
      `Targeted Repair ${args.attempt}: ${response.summary}`,
      args.candidate,
      expectedParents,
    );
  };
  const response=await runServerAi("repair-artifact",payload);
  try{return await construct(response);}
  catch(error){
    if(args.project.experimentPolicy?.repairConstructionCorrection!=="repair-construction-correction-v1")throw error;
    const correction=serverCandidateConstructionCorrection(error,response.artifacts);
    if(!correction)throw error;
    const limit=campaignRepairLimitStopReason(args.project);
    if(limit)throw new Error("修复构造纠错前已达到试验限额："+limit,{cause:error});
    await assertServerControlExecutionActive(args.project.id);
    // These typed errors occur during all-target preflight, before the first Blob write.
    // Keep one Candidate identity and the existing repair debit; never retry evaluation or persistence.
    const corrected=await runServerAi("repair-artifact",{...payload,constructionCorrection:{...correction,
      instruction:correction.instruction+" For html-body-node-edits-v1, use the SAME supplied htmlTextNodes anchorIds and plain text replacements. This is the only pre-write construction correction inside this already claimed repair; no additional repair, paper, Candidate or time window is authorized."}});
    return construct(corrected);
  }
}

/**
 * Restore only a previously passed offline Gate F round whose Champion
 * projection was omitted. Re-read the same exact frozen file bytes before
 * writing a single Mission metadata change; never rebuild or publish.
 */
export async function recoverServerAcceptedOfflineChampion(project:EvolveProject){
  const recovered=reconcileAcceptedOfflineChampion(project);
  if(!recovered?.searchChampion?.candidate)return undefined;
  const candidate=recovered.searchChampion.candidate;
  const check=await verifyServerFrozenCandidateArtifacts({project,candidate});
  if(check.failed.length||check.unavailable.length
    ||check.verified.length!==candidate.artifactSnapshots.length)return undefined;
  const receipts=project.artifactAcceptance.frozenArtifacts??[];
  if(check.verified.some(receipt=>!receipts.some(original=>
    original.sourceArtifactId===receipt.sourceArtifactId
    &&original.blobId===receipt.blobId
    &&original.sha256===receipt.sha256
    &&original.snapshotHash===receipt.snapshotHash
    &&original.size===receipt.size)))return undefined;
  return recovered;
}

export async function runServerMissionArtifactAcceptance(project:EvolveProject,persistProject?:(project:EvolveProject)=>Promise<unknown>){
  return runServerArtifactAcceptance(project,{verifyFrozenArtifacts:verifyServerFrozenCandidateArtifacts,repairCandidate:repairServerArtifactCandidate,
    verifyIndependentFinal:verifyServerIndependentFinalHoldout,persistProject,
    fingerprint:wire=>serverArtifactSha256(new TextEncoder().encode(wire)),archiveRepairEvidence:archiveServerRepairEvidence});
}

/** The caller owns the revision-scoped Mission store; never construct an unbound writer here. */
export async function runServerMissionVisibleRepair(project:EvolveProject,persistProject:(project:EvolveProject)=>Promise<unknown>){
  return runServerVisibleRepair(project,{persistProject,repairCandidate:repairServerArtifactCandidate,
    fingerprint:wire=>serverArtifactSha256(new TextEncoder().encode(wire)),verifyFrozenArtifact:verifyServerCandidateFrozenArtifact,
    archiveRepairEvidence:archiveServerRepairEvidence});
}
