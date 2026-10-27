import {describe,expect,it,vi} from "vitest";
import {TestCaseSchema,type EvolveProject,type EvalSuiteAiResult} from "@evolution/contracts";
import {reserveServerMissionFinalPaper,serverFinalPaperExecutionContract} from "./server-final-paper";
import {prepareServerIndependentFinalPaper} from "@evolution/harness";
import {acceptedPackageFixture} from "@evolution/testkit";
const project={targetConnection:{adapter:"artifact"},sourceArtifacts:[{id:"s",role:"target",extension:"html"}],campaign:{currentRound:0}} as unknown as EvolveProject;
const suite=(mode:"manual"|"artifact-runtime")=>({validationCases:[],hiddenCases:[TestCaseSchema.parse({id:"F",title:"F",input:"novel scenario",expected:["correct"],executionMode:mode})],summary:"generated"}) satisfies EvalSuiteAiResult;
describe("bound server final-paper capabilities",()=>{
 it("advertises browser assertions without fabricating human or visual ports",()=>{
  expect(serverFinalPaperExecutionContract(project)?.supportedModes).toEqual(["artifact-runtime","static-evidence","roundtrip","external-runner"]);
  expect(serverFinalPaperExecutionContract(project)?.browserAssertionModes).toEqual(["external-runner"]);
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
 it("rejects declared browser steps on a semantic mode without deleting or relabeling them",async()=>{
  const generated=suite("artifact-runtime");generated.hiddenCases[0]!.browserSteps=[{action:"visible",selector:"#actual"}];
  const original=structuredClone(generated),generate=vi.fn(async()=>generated);
  await expect(reserveServerMissionFinalPaper(project,{},generate)).rejects.toThrow("浏览器断言");
  expect(generated).toEqual(original);expect(generate).toHaveBeenCalledOnce();
 });
 it("uses only the existing preplanning contract correction to obtain an executable paper",async()=>{
  const {project:p}=acceptedPackageFixture(false);
  p.acceptanceRubric=[{id:"CONTENT",title:"Content",requirement:"correct",source:"user-command",weight:100,hardGate:true,judgeType:"llm",validationMethod:"semantic-judge",minScore:85,evidenceExpected:["observed"],protectedConstraint:false,artifactIds:["source"],category:"outcome"}];
  p.evalSuite=[];p.hiddenEvalSuite=[];p.candidates=[];p.experimentRun.candidateResults=[];
  p.validationRun={id:"v",status:"idle",runs:[],baselineRuns:[],checks:[]};
  p.artifactAcceptance={...p.artifactAcceptance,candidateId:undefined,attempts:0};p.roundHistory=[];
  const invalid=suite("artifact-runtime");invalid.hiddenCases[0]!.criterionIds=["CONTENT"];
  invalid.hiddenCases[0]!.browserSteps=[{action:"visible",selector:"#actual"}];
  const valid=structuredClone(invalid);valid.hiddenCases[0]!.executionMode="external-runner";
  const generate=vi.fn().mockResolvedValueOnce(invalid).mockResolvedValueOnce(valid);
  const prepared=await prepareServerIndependentFinalPaper(p,{round:1,at:p.updatedAt,artifacts:[],executionContract:serverFinalPaperExecutionContract(p),
    reserve:payload=>reserveServerMissionFinalPaper(p,payload,generate)});
  expect(generate).toHaveBeenCalledTimes(2);expect(generate.mock.calls[1]![0]).toMatchObject({generationCorrection:expect.stringContaining("浏览器断言")});
  expect(prepared.project.finalHoldout?.suite[0]).toMatchObject({executionMode:"external-runner",browserSteps:invalid.hiddenCases[0]!.browserSteps});
  expect(p.finalHoldout).toBeUndefined();expect(p.candidates).toEqual([]);
 });
});
