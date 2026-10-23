import {z} from "zod";
import {CandidateSchema,EvolutionArchiveEntrySchema,EvolveProjectSchema,SearchChampionSchema,type EvaluationResult,type EvolveProject} from "@evolution/contracts";
import {candidateMetricDeltas} from "@evolution/core";

// Narrow compatibility reader for derived percentages stored by the old division-by-zero bug.
// Every other field, including Artifact/Evidence identities, still uses the current contracts.
const LegacyDelta=z.union([z.number(),z.null(),z.custom<number>(value=>typeof value==="number"&&!Number.isFinite(value))]).optional();
const LegacyCandidate=CandidateSchema.extend({costDelta:LegacyDelta,speedDelta:LegacyDelta});
const LegacyProject=EvolveProjectSchema.extend({
  candidates:z.array(LegacyCandidate),
  searchChampion:SearchChampionSchema.extend({candidate:LegacyCandidate.optional()}).optional(),
  evolutionArchive:z.array(EvolutionArchiveEntrySchema.extend({candidate:LegacyCandidate})).default([]),
});
function repair(candidate:z.infer<typeof LegacyCandidate>,evaluation?:EvaluationResult,baseline?:EvaluationResult){
  const measured=candidateMetricDeltas(evaluation,baseline);
  const invalidCost=candidate.costDelta!==undefined&&(candidate.costDelta===null||!Number.isFinite(candidate.costDelta));
  const invalidSpeed=candidate.speedDelta!==undefined&&(candidate.speedDelta===null||!Number.isFinite(candidate.speedDelta));
  return {...candidate,...(invalidCost?{costDelta:measured.costDelta,costDeltaKnown:measured.costDeltaKnown}:{}),
    ...(invalidSpeed?{speedDelta:measured.speedDelta,speedDeltaKnown:measured.speedDeltaKnown}:{})};
}
export function parseStoredEvolveProject(raw:unknown):EvolveProject{
  const current=EvolveProjectSchema.safeParse(raw);
  if(current.success)return current.data;
  const legacy=LegacyProject.parse(raw);
  const baseline=(legacy.experimentRun.comparisonBaseline??legacy.baselineRun).result;
  const candidates=legacy.candidates.map(candidate=>{
    const matches=legacy.experimentRun.candidateResults.filter(result=>result.candidateId===candidate.id);
    return repair(candidate,matches.length===1?matches[0]!.evaluation:undefined,baseline);
  });
  const champion=legacy.searchChampion;
  // Historical percentages without their exact comparison baseline remain unmeasured.
  const searchChampion=champion?.candidate?{...champion,candidate:repair(champion.candidate,champion.evaluation,champion.validation?.baselineEvaluation)}:champion;
  const evolutionArchive=legacy.evolutionArchive.map(entry=>({...entry,candidate:repair(entry.candidate,entry.evaluation)}));
  return EvolveProjectSchema.parse({...legacy,candidates,searchChampion,evolutionArchive});
}
export function parseStoredEvolveProjects(raw:unknown):EvolveProject[]{
  return z.array(z.unknown()).parse(raw).map(parseStoredEvolveProject);
}
