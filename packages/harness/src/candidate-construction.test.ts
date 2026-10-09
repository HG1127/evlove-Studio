import {describe,expect,it,vi} from "vitest";
import type {BuildCandidateAiResult} from "@evolution/contracts";
import {CandidateConstructionOutputError,runCandidateConstruction,verifiedCandidateTextAnchors} from "./candidate-construction";
const first:BuildCandidateAiResult={summary:"initial",artifacts:[]};const repaired:BuildCandidateAiResult={summary:"repaired",artifacts:[]};
describe("Candidate construction content-only retry",()=>{
 it("returns first validated result without requesting a repair",async()=>{const recover=vi.fn();expect(await runCandidateConstruction({initial:async()=>first,prepare:async output=>output.summary,recover})).toBe("initial");expect(recover).not.toHaveBeenCalled();});
 it("passes one typed failure and the exact previous blueprint into repair",async()=>{
  const recover=vi.fn(async(args:{attempt:1})=>{expect(args.attempt).toBe(1);return repaired;});const prepare=vi.fn(async(_output:typeof first,attempt:0|1)=>{if(!attempt)throw new CandidateConstructionOutputError("text-edits","missing anchor");return "frozen";});
  expect(await runCandidateConstruction({initial:async()=>first,prepare,recover})).toBe("frozen");expect(recover).toHaveBeenCalledOnce();expect(recover.mock.calls[0]?.[0]).toMatchObject({attempt:1,failure:{code:"text-edits"},previousOutput:first});expect(prepare).toHaveBeenCalledTimes(2);
 });
 it.each(["initial","prepare","recover"])("does not retry infrastructure failure in %s",async stage=>{
  const error=new Error("identity / storage / provider failure");const recover=vi.fn(async()=>{if(stage==="recover")throw error;return repaired;});
  await expect(runCandidateConstruction({initial:async()=>{if(stage==="initial")throw error;return first;},prepare:async()=>{if(stage==="prepare")throw error;throw new CandidateConstructionOutputError("unchanged","no change");},recover})).rejects.toBe(error);expect(recover).toHaveBeenCalledTimes(stage==="recover"?1:0);
 });
 it("stops with both content failures rather than attempting a third build",async()=>{
  const recover=vi.fn(async()=>repaired);await expect(runCandidateConstruction({initial:async()=>first,prepare:async()=>{throw new CandidateConstructionOutputError("html-protection","protected title lost");},recover})).rejects.toMatchObject({code:"CANDIDATE_CONSTRUCTION_RECOVERY_FAILED",initialFailure:{code:"html-protection"},recoveryFailure:{code:"html-protection"}});expect(recover).toHaveBeenCalledOnce();
 });
 it("only supplies unique full-parent anchors and unchanged offset coordinates",()=>{
  const source="repeated repeated\r\n"+"保留内容。".repeat(100)+"unique actual anchor";const anchors=verifiedCandidateTextAnchors(source,["repeated","missing","unique actual anchor","unique actual anchor","x".repeat(6001)]);expect(anchors).toEqual([{text:"unique actual anchor",start:source.indexOf("unique actual anchor"),end:source.length}]);expect(source.slice(anchors[0]!.start,anchors[0]!.end)).toBe(anchors[0]!.text);
 });
 it("does not truncate anchors or exceed the requested shared context budget",()=>{const source="first unique block | second unique block";expect(verifiedCandidateTextAnchors(source,["first unique block","second unique block"],{maxChars:20})).toEqual([{start:0,end:18,text:"first unique block"}]);expect(verifiedCandidateTextAnchors(source,["first unique block"],{maxChars:0})).toEqual([]);});

});
