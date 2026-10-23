import type {Candidate,EvolveProject} from "@evolution/contracts";

/**
 * Give each planned Candidate an immutable Mission-wide identity. Generative
 * planners often reuse names such as candidate-A on every round; without a
 * scoped identity, a round-2 result can appear to be the round-1 Champion in
 * archives, frozen receipts and UI selectors.
 *
 * The first round keeps authored IDs for backwards compatibility. Later rounds
 * include a round prefix. Existing Champions/archives are never rewritten.
 */
export function scopeCandidateIdsForRound(
  project:EvolveProject,
  candidates:Candidate[],
  round:number,
):Candidate[]{
  if(!Number.isInteger(round)||round<1)throw new Error("Invalid Campaign round");
  const used=new Set<string>([
    ...project.evolutionArchive.map(entry=>entry.candidate.id),
    ...project.roundHistory.flatMap(entry=>entry.winnerCandidateId?[entry.winnerCandidateId]:[]),
    ...(project.searchChampion?.candidate?[project.searchChampion.candidate.id]:[]),
    ...project.candidates.map(candidate=>candidate.id),
  ]);
  return candidates.map((candidate,index)=>{
    const raw=candidate.id.trim();
    // IDs are also used in checkpoint keys, file receipts and audit events.
    const clean=raw.replace(/[^a-zA-Z0-9._-]+/g,"-").replace(/^-+|-+$/g,"").slice(0,56)
      ||"candidate-"+(index+1);
    let id=round===1&&raw===clean?clean:
      clean.startsWith("r"+round+"-")?clean:
      "r"+round+"-"+clean;
    const root=id;
    let suffix=2;
    while(used.has(id))id=root+"-"+suffix++;
    used.add(id);
    return {...candidate,id};
  });
}
