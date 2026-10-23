import {describe,expect,it} from "vitest";
import {CandidateSchema,type Candidate,type EvolveProject} from "@evolution/contracts";
import {scopeCandidateIdsForRound} from "./candidate-round-identity";

const candidate=(id:string):Candidate=>CandidateSchema.parse({
  id,name:id,change:"source-bound revision",patches:[],
});
function project(priorIds:string[]=[]):EvolveProject{
  return {
    candidates:[],roundHistory:priorIds.map((winnerCandidateId,index)=>({
      round:index+1,winnerCandidateId,
    })),
    evolutionArchive:[],
  } as unknown as EvolveProject;
}

describe("multi-round immutable Candidate identities",()=>{
  it("preserves unique first-round IDs and normalizes duplicate plan results deterministically",()=>{
    const p=project();
    const raw=[candidate("candidate-B"),candidate("candidate-A"),candidate("candidate-B")];
    const selected=scopeCandidateIdsForRound(p,raw,1);
    expect(selected.map(x=>x.id)).toEqual(["candidate-B","candidate-A","candidate-B-2"]);
    expect(raw.map(x=>x.id)).toEqual(["candidate-B","candidate-A","candidate-B"]);
    expect(p.roundHistory).toEqual([]);
    expect(scopeCandidateIdsForRound(p,raw,1)).toEqual(selected);
  });
  it("namespaces round two after the accepted Champion and all archived winners",()=>{
    const p=project(["candidate-B","r2-candidate-B"]);
    p.searchChampion={candidate:candidate("candidate-B")} as EvolveProject["searchChampion"];
    p.evolutionArchive=[{candidate:candidate("r2-candidate-A")} as EvolveProject["evolutionArchive"][number]];
    const raw=[candidate("candidate-B"),candidate("candidate-A"),candidate("new")];
    expect(scopeCandidateIdsForRound(p,raw,2).map(x=>x.id))
      .toEqual(["r2-candidate-B-2","r2-candidate-A-2","r2-new"]);
    expect(p.searchChampion?.candidate?.id).toBe("candidate-B");
  });
  it("does not reuse a Candidate name when the model repeats itself within a later plan",()=>{
    const mapped=scopeCandidateIdsForRound(project(),[
      candidate("r2-change"),candidate("r2-change"),candidate("unexpected/../fragment"),
    ],2);
    expect(mapped.map(x=>x.id)).toEqual(["r2-change","r2-change-2","r2-unexpected-..-fragment"]);
    expect(mapped.every(x=>!x.id.includes("/"))).toBe(true);
  });
  it("rejects an invalid round rather than creating a misleading checkpoint identity",()=>{
    expect(()=>scopeCandidateIdsForRound(project(),[candidate("A")],0)).toThrow();
    expect(()=>scopeCandidateIdsForRound(project(),[candidate("A")],1.5)).toThrow();
  });
});
