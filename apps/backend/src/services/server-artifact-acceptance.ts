import type {AcceptanceCriterion,Candidate,EvolveProject,FrozenArtifact} from "@evolution/contracts";
import {indexUniqueById} from "@evolution/core";
import {runServerArtifactAcceptance,type ServerArtifactVerification} from "@evolution/harness";
import {runServerAi} from "./ai-gateway";
import {getServerArtifactStore} from "./artifact-runtime";
import {materializeServerCandidateArtifacts,readServerCandidateParentText,verifyServerCandidateFrozenArtifact} from "./server-experiment-artifacts";

import {buildServerCandidateTargetContext,requireServerCandidateOutputModes} from "./server-candidate-context";

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
    if(!await verifyServerCandidateFrozenArtifact(snapshot,project.sourceArtifacts.find((item)=>item.id===targetId))){
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
}){
  const failedIds=new Set(args.failedCriteria.map((criterion)=>criterion.id));
  const focused = {...args.candidate, change: args.failedCriteria.map((criterion) => `${criterion.title}: ${criterion.requirement}`).join("\n")};
  const contexts = await buildServerCandidateTargetContext(args.project, focused, (source) => readServerCandidateParentText(args.project, source, args.candidate), args.candidate);
  const response=await runServerAi("repair-artifact",{
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
      patches:args.candidate.patches,
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
      })),
    },
    failedCriteria:args.failedCriteria.map((criterion)=>{
      const score=args.project.validationRun.evaluation?.criterionScores?.find((item)=>item.criterionId===criterion.id);
      return {
        criterionId:criterion.id,
        title:criterion.title,
        requirement:criterion.requirement,
        minScore:criterion.minScore,
        validationMethod:criterion.validationMethod,
        evidence:score?.evidence??[],
        gaps:score?.gaps??[],
      };
    }),
    instruction:"Change only the VERIFIED failed criteria above. Preserve every other artifact behavior and protected item. Return exactly one artifact for every supplied target; for unchanged excerpted text targets return one exact text-edit with identical before/after, and for other unchanged targets return their current content. For codebase/package targets return a JSON overlay {kind:'codebase',overlay:true,files:[{path,content}],deletions:[path]} containing only actual changes/deletions. For text artifacts with mutationMode text-edits, return content JSON {kind:'text-edits',edits:[{before,after,start?,end?}]}, anchored verbatim to current Candidate chunks without chunk markers or ellipses. The server applies edits to the complete tested Candidate, preserving untouched bytes. Do not rewrite a whole artifact from excerpts. The output becomes a NEW Candidate and must be re-tested on the full Hidden Holdout.",
  });
  requireServerCandidateOutputModes(contexts, response.artifacts);
  if(response.repairedCriteria.some((id)=>!failedIds.has(id))){
    throw new Error(`Repair AI attempted out-of-scope criteria: ${response.repairedCriteria.filter((id)=>!failedIds.has(id)).join("、")}`);
  }
  if(!response.repairedCriteria.length)throw new Error("Repair AI did not acknowledge any VERIFIED failed criterion");
  const currentBySource=new Map(args.candidate.artifactSnapshots.map((snapshot)=>[snapshot.sourceArtifactId,snapshot.content.trim()]));
  if(response.artifacts.length&&response.artifacts.every((artifact)=>currentBySource.get(artifact.sourceArtifactId)===artifact.content.trim())){
    throw new Error("Repair AI returned a no-op artifact; refusing to mint a new Candidate identity");
  }
  const suffix=`${args.attempt}-${Date.now()}`;
  const next:Candidate={
    ...args.candidate,
    id:`${args.candidate.id}-repair-${suffix}`,
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
    response.artifacts.map((artifact)=>({...artifact,buildMode:"ai-full" as const})),
    `Targeted Repair ${args.attempt}: ${response.summary}`,
    args.candidate,
  );
}

export async function runServerMissionArtifactAcceptance(project:EvolveProject){
  return runServerArtifactAcceptance(project,{verifyFrozenArtifacts:verifyServerFrozenCandidateArtifacts,repairCandidate:repairServerArtifactCandidate});
}
