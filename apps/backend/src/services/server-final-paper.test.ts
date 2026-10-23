import {describe,expect,it,vi} from "vitest";
import {TestCaseSchema,type EvolveProject,type EvalSuiteAiResult} from "@evolution/contracts";
import {reserveServerMissionFinalPaper,serverFinalPaperExecutionContract} from "./server-final-paper";
const project={targetConnection:{adapter:"artifact"},sourceArtifacts:[{id:"s",role:"target",extension:"html"}],campaign:{currentRound:0}} as unknown as EvolveProject;
const suite=(mode:"manual"|"artifact-runtime")=>({validationCases:[],hiddenCases:[TestCaseSchema.parse({id:"F",title:"F",input:"novel scenario",expected:["correct"],executionMode:mode})],summary:"generated"}) satisfies EvalSuiteAiResult;
describe("bound server final-paper capabilities",()=>{
 it("advertises browser assertions without fabricating human or visual ports",()=>{
  expect(serverFinalPaperExecutionContract(project)?.supportedModes).toEqual(["artifact-runtime","static-evidence","roundtrip","external-runner"]);
 });
 it("uses the existing source payload verbatim without new source reads",async()=>{
  const payload={project:{artifacts:[{id:"s",content:"EXISTING-SOURCE"}]},executionContract:serverFinalPaperExecutionContract(project)};
  const generate=vi.fn().mockResolvedValueOnce(suite("artifact-runtime"));
  const result=await reserveServerMissionFinalPaper(project,payload,generate);
  expect(generate.mock.calls[0]![0]).toBe(payload);
  expect(generate).toHaveBeenCalledTimes(1);
  expect(result[0]).toMatchObject({hidden:true,executionMode:"artifact-runtime",id:expect.stringContaining("FINAL-r1-")});
 });
 it("refuses a persistently unavailable paper instead of relabeling or deleting cases",async()=>{
  const generate=vi.fn(async()=>suite("manual"));
  await expect(reserveServerMissionFinalPaper(project,{},generate)).rejects.toThrow("执行能力");
  expect(generate).toHaveBeenCalledTimes(1);
 });
});
