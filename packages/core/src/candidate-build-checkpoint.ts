import type {Candidate,EvolveProject} from "@evolution/contracts";
function buildInput(project:EvolveProject){
  return JSON.stringify({id:project.id,version:project.version,command:project.evolutionCommand,goal:project.goal,
    protectedItems:project.protectedItems,champion:project.searchChampion,
    sources:project.sourceArtifacts.filter(source=>source.role==="target")});
}
/** A saved build belongs to the same source version, intent and Candidate patches. */
export function checkpointCandidateBuild(current:EvolveProject,expected:EvolveProject,built:Candidate):EvolveProject{
  const previous=expected.candidates.find(candidate=>candidate.id===built.id);
  const latest=current.candidates.find(candidate=>candidate.id===built.id);
  if(!previous||!latest||buildInput(current)!==buildInput(expected)
    ||JSON.stringify(latest.patches)!==JSON.stringify(previous.patches))throw new Error("任务内容或改进方案已改变，旧候选文件未覆盖新版本。请按当前方案重新验证。");
  return {...current,candidates:current.candidates.map(candidate=>candidate.id===built.id?{...candidate,
    artifactSnapshots:built.artifactSnapshots,artifactBuildStatus:built.artifactBuildStatus,artifactBuildSummary:built.artifactBuildSummary}:candidate)};
}
