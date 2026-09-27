import type {AcceptanceCriterion,Candidate,EvolveProject,FrozenArtifact} from "@evolution/contracts";
import {indexUniqueById} from "@evolution/core";
import {runServerArtifactAcceptance,type ServerArtifactVerification} from "@evolution/harness";
import {runServerAi} from "./ai-gateway";
import {getServerArtifactStore} from "./artifact-runtime";
import {materializeServerCandidateArtifacts,serverArtifactSha256} from "./server-experiment-artifacts";

async function verifyFrozenArtifacts({project,candidate}:{project:EvolveProject;candidate:Candidate}):Promise<ServerArtifactVerification>{
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
    const sha256=await serverArtifactSha256(await blob.arrayBuffer());
    if(sha256!==receipt.sha256||blob.size!==receipt.size){
      failed.push(`${targetId}: frozen bytes/hash/size 与 receipt 不一致`);
      continue;
    }
    if(snapshot.contentHash&&snapshot.contentHash!==receipt.snapshotHash){
      failed.push(`${targetId}: Candidate Snapshot hash 与 frozen receipt 不一致`);
      continue;
    }
    verified.push(receipt);
  }
  return {verified,unavailable,failed};
}

async function repairCandidate(args:{
  project:EvolveProject;
  candidate:Candidate;
  failedCriteria:AcceptanceCriterion[];
  attempt:number;
}){
  const failedIds=new Set(args.failedCriteria.map((criterion)=>criterion.id));
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
      artifacts:args.candidate.artifactSnapshots.map((snapshot)=>({
        sourceArtifactId:snapshot.sourceArtifactId,
        name:snapshot.name,
        mimeType:snapshot.mimeType,
        content:snapshot.content,
        contentHash:snapshot.contentHash,
        frozenSha256:snapshot.frozenArtifact?.sha256,
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
    instruction:"Change only the VERIFIED failed criteria above. Preserve every other artifact behavior and protected item. The output becomes a NEW Candidate and must be re-tested on the full Hidden Holdout.",
  });
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
  );
}

export async function runServerMissionArtifactAcceptance(project:EvolveProject){
  return runServerArtifactAcceptance(project,{verifyFrozenArtifacts,repairCandidate});
}
