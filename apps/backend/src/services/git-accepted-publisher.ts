import {
  GitAcceptedPublishRequestSchema,
  GitAcceptedPublishResponseSchema,
  type CandidateArtifactSnapshot,
  type EvolveProject,
  type GitAcceptedPublishRequest,
  type GitFileChange,
  type GitRepositoryBinding,
  type GitTargetActionResponse,
} from "@evolution/contracts";
import {hasExactFrozenArtifactSet,materializeAcceptedChampionPackage} from "@evolution/core";
import {executeGitTargetAction} from "./github-target";

type Executor=(input:unknown)=>Promise<GitTargetActionResponse>;

function sameRepository(left:GitRepositoryBinding,right:GitRepositoryBinding){
  return left.provider===right.provider
    &&left.owner===right.owner
    &&left.repo===right.repo
    &&left.baseBranch===right.baseBranch
    &&(left.pathPrefix??"")===(right.pathPrefix??"");
}

function assertGitPublishBinding(project:EvolveProject,input:GitAcceptedPublishRequest){
  if(project.targetConnection.adapter!=="git"||project.targetConnection.status!=="connected"){
    throw new Error("Git publish requires the connected Mission Git target");
  }
  const repository=project.targetConnection.git;
  const locked=project.targetConnection.gitSnapshot;
  if(!repository)throw new Error("Git publish Mission is missing repository binding");
  if(!locked?.commitSha)throw new Error("Git publish requires the exact locked source commit from Mission materialization");
  if(!sameRepository(repository,input.repository)){
    throw new Error("Git publish repository does not match the Mission Git target binding");
  }
  if(input.expectedBaseSha!==locked.commitSha){
    throw new Error(`Git publish base SHA ${input.expectedBaseSha} does not match locked Mission source ${locked.commitSha}`);
  }
  return {repository,locked};
}

function acceptedChampion(project:EvolveProject){
  const champion=project.searchChampion;
  if(!champion?.candidate)throw new Error("Git publish requires Search Champion Candidate");
  const candidate=champion.candidate;
  const acceptance=champion.artifactAcceptance??project.artifactAcceptance;
  if(acceptance.status!=="passed")throw new Error("Git publish requires Gate F · Artifact Ready = passed");
  if(acceptance.candidateId&&acceptance.candidateId!==candidate.id){
    throw new Error("Artifact Acceptance candidate does not match Search Champion");
  }
  if(!candidate.artifactSnapshots.length)throw new Error("Accepted Champion has no artifact snapshots");
  if(!hasExactFrozenArtifactSet(project,candidate,acceptance))throw new Error("Accepted Champion frozen Artifact identities do not exactly match Target Snapshots");
  return {champion,candidate,acceptance};
}

function assertUniquePaths(changes:GitFileChange[]){
  const seen=new Set<string>();
  for(const change of changes){
    const key=change.path.replace(/\\/g,"/").toLowerCase();
    if(seen.has(key))throw new Error("Git publish contains duplicate path: "+change.path);
    seen.add(key);
  }
}

function sourceGitChanges(project:EvolveProject,snapshot:CandidateArtifactSnapshot):GitFileChange[]{
  const source=project.sourceArtifacts.find((item)=>item.id===snapshot.sourceArtifactId);
  const descriptor=source?.artifactDescriptor;
  if(descriptor?.family==="codebase"||descriptor?.family==="package"){
    const parsed=(()=>{try{return JSON.parse(snapshot.content) as {files?:Array<{path?:unknown;content?:unknown}>};}catch{return undefined;}})();
    if(!parsed?.files?.length)throw new Error("Accepted code/package snapshot lacks files[] blueprint for Git writeback");
    return parsed.files.map((file)=>{
      if(typeof file.path!=="string"||!file.path.trim()||typeof file.content!=="string"){
        throw new Error("Accepted code/package blueprint contains an invalid file entry");
      }
      return {path:file.path,content:file.content,delete:false};
    });
  }
  const extension=(source?.extension??snapshot.name.split(".").pop()??"").toLowerCase();
  const textLike=Boolean(
    source?.mimeType.startsWith("text/")
    ||["application/json","application/yaml","application/x-yaml","application/javascript","application/sql"].includes(source?.mimeType??"")
    ||["txt","md","mdx","json","jsonl","yaml","yml","xml","html","htm","css","scss","less","js","jsx","ts","tsx","mjs","cjs","py","go","rs","java","kt","php","vue","svelte","sql","csv","tsv"].includes(extension)
  );
  if(!textLike){
    throw new Error("Accepted binary artifact "+snapshot.name+" must be materialized by Server Renderer; Git publisher refuses blueprint-as-binary writeback");
  }
  return [{path:snapshot.name,content:snapshot.content,delete:false}];
}

export function acceptedChampionGitChanges(project:EvolveProject,includeMetadata=true){
  const {candidate}=acceptedChampion(project);
  const acceptedPackage=materializeAcceptedChampionPackage(project);
  const primary:GitFileChange[]=candidate.artifactSnapshots.flatMap((snapshot)=>sourceGitChanges(project,snapshot));
  const metadata=includeMetadata
    ?acceptedPackage
      .filter((artifact)=>artifact.kind!=="primary")
      .map((artifact):GitFileChange=>({
        path:".evolution/"+artifact.name,
        content:artifact.content,
        delete:false,
      }))
    :[];
  const changes=[...primary,...metadata];
  assertUniquePaths(changes);
  return {candidateId:candidate.id,primaryCount:primary.length,metadataCount:metadata.length,changes};
}

export async function publishAcceptedChampionToConfiguredGit(
  project:EvolveProject,
  executor:Executor=executeGitTargetAction,
){
  if(project.targetConnection.adapter!=="git")return undefined;
  if(project.targetConnection.status!=="connected")throw new Error("Git target is not connected");
  const repository=project.targetConnection.git;
  if(!repository)throw new Error("Git target connection is missing repository binding");
  const locked=project.targetConnection.gitSnapshot;
  if(!locked?.commitSha)throw new Error("Git target has no exact locked source commit for accepted writeback");
  return publishAcceptedChampionToGit(project,{
    repository,
    missionId:project.id,
    expectedBaseSha:locked.commitSha,
    openPullRequest:true,
    includeMetadata:true,
  },executor);
}

export async function publishAcceptedChampionToGit(
  project:EvolveProject,
  raw:GitAcceptedPublishRequest,
  executor:Executor=executeGitTargetAction,
){
  const input=GitAcceptedPublishRequestSchema.parse(raw);
  if(project.id!==input.missionId)throw new Error("Mission ID does not match loaded project");
  assertGitPublishBinding(project,input);
  const prepared=acceptedChampionGitChanges(project,input.includeMetadata);
  const mutation=await executor({
    action:"mutate",
    repository:input.repository,
    missionId:project.id,
    candidateId:prepared.candidateId,
    expectedBaseSha:input.expectedBaseSha,
    branch:input.branch,
    commitMessage:input.commitMessage??`Evolution OS: publish accepted ${prepared.candidateId}`,
    changes:prepared.changes,
  });
  let pullRequest:GitTargetActionResponse|undefined;
  if(input.openPullRequest){
    if(!mutation.branch)throw new Error("Git mutation did not return a branch");
    pullRequest=await executor({
      action:"open-pr",
      repository:input.repository,
      missionId:project.id,
      candidateId:prepared.candidateId,
      branch:mutation.branch,
      title:input.pullTitle??`Evolution OS · Accepted Candidate ${prepared.candidateId}`,
      body:input.pullBody??[
        `Mission: ${project.id}`,
        `Candidate: ${prepared.candidateId}`,
        "Source: Gate F accepted Search Champion",
        `Acceptance: ${project.searchChampion?.artifactAcceptance?.acceptedAt??project.artifactAcceptance.acceptedAt??"passed"}`,
      ].join("\n"),
    });
  }
  return GitAcceptedPublishResponseSchema.parse({
    provider:"github",
    missionId:project.id,
    candidateId:prepared.candidateId,
    artifactCount:prepared.primaryCount,
    metadataCount:prepared.metadataCount,
    mutation,
    pullRequest,
    observedAt:new Date().toISOString(),
    note:pullRequest
      ?"Published the exact accepted Candidate to an auditable Git branch and pull request."
      :"Published the exact accepted Candidate to an auditable Git branch.",
  });
}
