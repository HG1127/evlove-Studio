import type {EvolveProject,SourceArtifact,TestCase} from "@evolution/contracts";

/** Resolve exactly one target. A multi-artifact assertion requires its own evaluator. */
export function resolveTestTargetArtifact(project:Pick<EvolveProject,"sourceArtifacts"|"acceptanceRubric">,testCase:TestCase):SourceArtifact|undefined{
  const targets=project.sourceArtifacts.filter(source=>source.role==="target");
  if(!targets.length)return undefined;
  if(new Set(targets.map(source=>source.id)).size!==targets.length)throw Error(`Test Case ${testCase.id} 没有唯一的 Target Artifact 绑定：Target 身份重复。`);
  const criteria=new Set(testCase.criterionIds??[]);
  const scopedIds=new Set((project.acceptanceRubric??[]).filter(criterion=>criteria.has(criterion.id))
    .flatMap(criterion=>criterion.artifactIds));
  const selected=scopedIds.size?targets.filter(source=>scopedIds.has(source.id)):targets;
  if(selected.length!==1||(scopedIds.size>0&&selected.length!==scopedIds.size)){
    throw Error(`Test Case ${testCase.id} 没有唯一的 Target Artifact 绑定，不能选用首个 Source。`);
  }
  return selected[0];
}
