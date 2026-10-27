import type {EvolveProject,Lesson} from "@evolution/contracts";
import {governProductionLessons} from "./learning-governance";

/** Lesson integration prepends new evidence. Preserve that order and exclude revoked knowledge. */
export function selectPlanningLessons(lessons:readonly Lesson[],limit=6):Lesson[]{
  const seen=new Set<string>();
  return lessons.filter(lesson=>{
    if(seen.has(lesson.id))return false;
    seen.add(lesson.id);
    if(lesson.governance&&["revoked","degraded","superseded"].includes(lesson.governance.status))return false;
    if(lesson.status==="verified-skill"&&(!lesson.provenance||lesson.governance?.status!=="active"
      ||!lesson.provenance.candidateId||lesson.provenance.candidateId!==lesson.governance.candidateId
      ||!lesson.provenance.deploymentId||lesson.provenance.deploymentId!==lesson.governance.deploymentId))return false;
    return lesson.reusable||lesson.status==="anti-pattern";
  }).slice(0,Math.max(0,Math.floor(limit)));
}

/** Recheck stored source bindings/freshness at use time; do not wait for a write-side refresh. */
export function selectProjectPlanningLessons(project:EvolveProject,limit=6,now=Date.now()):Lesson[]{
  return selectPlanningLessons(governProductionLessons(project,{now}).lessons,limit);
}
