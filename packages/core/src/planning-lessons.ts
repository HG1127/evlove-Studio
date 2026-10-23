import type {Lesson} from "@evolution/contracts";

/** Lesson integration prepends new evidence. Preserve that order and exclude revoked knowledge. */
export function selectPlanningLessons(lessons:readonly Lesson[],limit=6):Lesson[]{
  const seen=new Set<string>();
  return lessons.filter(lesson=>{
    if(seen.has(lesson.id))return false;
    seen.add(lesson.id);
    if(lesson.governance&&["revoked","degraded","superseded"].includes(lesson.governance.status))return false;
    return lesson.reusable||lesson.status==="anti-pattern";
  }).slice(0,Math.max(0,Math.floor(limit)));
}
