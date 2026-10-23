import {OriginalArtifactReferenceProofSchema,type EvolveProject} from "@evolution/contracts";

/** A Baseline of the unchanged Original locks the reference; Candidate acceptance remains separate. */
export function originalBaselineReferenceCriteria(project:EvolveProject,raw:unknown[]):string[]{
  if(project.stage!=="baseline"||project.searchChampion)return [];
  const parsed=raw.map(value=>OriginalArtifactReferenceProofSchema.safeParse(value));
  if(parsed.some(p=>!p.success))return [];
  const proofs=parsed.map(p=>p.data!);
  const targets=project.sourceArtifacts.filter(source=>source.role==="target");
  if(new Set(targets.map(s=>s.id)).size!==targets.length)return [];
  return project.acceptanceRubric.filter(criterion=>{
    const preservation=criterion.protectedConstraint&&criterion.source==="protected-item";
    const singleArtifactComparison=project.sourceArtifacts.length===1&&criterion.source==="source-understanding"
      &&criterion.validationMethod==="cross-artifact";
    if(!criterion.hardGate||criterion.judgeType!=="pairwise"||(!preservation&&!singleArtifactComparison))return false;
    const ids=new Set(criterion.artifactIds);
    const scope=targets.filter(source=>!ids.size||ids.has(source.id));
    if(!scope.length||(ids.size&&scope.length!==ids.size))return false;
    return scope.every(source=>{
      const matched=proofs.filter(p=>p.sourceArtifactId===source.id);
      const proof=matched[0];
      return matched.length===1&&proof?.missionId===project.id&&proof.sizeBytes===source.size
        &&proof.blobId===(source.storageRef?.trim()||(source.inputMode==="upload"?source.id:undefined));
    });
  }).map(criterion=>criterion.id);
}
