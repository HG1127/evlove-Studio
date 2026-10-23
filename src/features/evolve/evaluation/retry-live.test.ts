import { beforeEach, it, expect, vi } from "vitest";
const mocks = vi.hoisted(() => ({ status: vi.fn(), call: vi.fn(), mode:vi.fn(), server:vi.fn() }));
vi.mock("../ai/service", () => ({ getAiProviderStatus: mocks.status, runEvolveAi: mocks.call }));
vi.mock("../runtime/production-runtime",()=>({productionRuntimeMode:mocks.mode}));
vi.mock("../runtime/server-ai-client",async(importOriginal)=>({...await importOriginal<typeof import("../runtime/server-ai-client")>(),runServerAiOperation:mocks.server}));
beforeEach(()=>{mocks.mode.mockReturnValue("local");mocks.server.mockReset();});
import {ServerAiUnavailableError} from "../runtime/server-ai-client";
import { evaluateRuns } from "./service";
import { AcceptanceCriterionSchema, type TargetRunResult, type TestCase } from "../schemas";
it("手动补跑连续两次都请求新评审，绕过结果缓存", async () => {
 mocks.status.mockReturnValue({live:true});
 mocks.call.mockResolvedValue({accuracy:90,evidence:90,riskCoverage:90,completeness:90,safety:"PASS",cases:[],criteria:[]});
 const args={testCases:[],runs:[],context:{project:{aiProfile:{mode:"project"}}},forceRefresh:true};
 await evaluateRuns(args); await evaluateRuns(args);
 expect(mocks.call).toHaveBeenCalledTimes(2);
 expect(mocks.call.mock.calls[0][4]).toEqual({forceRefresh:true,requireLive:true});
 expect(mocks.status).toHaveBeenCalledWith("evaluate",args.context);
});
it("没有真实连接明确失败，不能静默用本地评分完成补跑", async () => {
 mocks.status.mockReturnValue({live:false}); mocks.call.mockClear();
 await expect(evaluateRuns({testCases:[],runs:[],context:{},forceRefresh:true})).rejects.toThrow(/真实模型连接/);
 expect(mocks.call).not.toHaveBeenCalled();
});

it("只对完整证据分批补评漏返的验收项，不重新执行整套盲测", async () => {
 mocks.call.mockClear();
 mocks.status.mockReturnValue({live:true});
 const criteria=["A","B","C","D"].map((id)=>AcceptanceCriterionSchema.parse({id,title:id,requirement:`检查 ${id}`,validationMethod:"semantic-judge",hardGate:true,minScore:85}));
 const testCases=criteria.map((criterion)=>({id:`H-${criterion.id}`,title:criterion.title,input:"检查当前成果",expected:[criterion.requirement],tags:[],hidden:true,criterionIds:[criterion.id],executionMode:"artifact-runtime" as const,evidenceScope:"product-behavior" as const})) satisfies TestCase[];
 const runs=testCases.map((testCase)=>({testCaseId:testCase.id,output:`当前成果已包含 ${testCase.id}`,latencyMs:1,cost:0,trace:[],verificationStatus:"verified" as const})) satisfies TargetRunResult[];
 const generic={accuracy:90,evidence:90,riskCoverage:90,completeness:90,safety:"PASS",notes:[],failures:[],cases:[],criteria:[]};
 mocks.call.mockImplementation(async (_operation: string,payload: {recovery?: {criterionIds:string[]}})=>payload.recovery
   ? {...generic,criteria:payload.recovery.criterionIds.map((criterionId)=>({criterionId,score:92,pass:true,evidence:["当前成果已核查"],gaps:[],testCaseIds:[`H-${criterionId}`]}))}
   : generic);
 const result=await evaluateRuns({testCases,runs,context:{mode:"holdout",project:{acceptanceRubric:criteria}}});
 expect(result.unverifiedCriterionIds).toEqual([]);
 expect(result.criterionScores).toHaveLength(4);
 expect(mocks.call).toHaveBeenCalledTimes(3);
 expect(mocks.call.mock.calls.slice(1).map((call)=>call[1].recovery.criterionIds)).toEqual([["A","B"],["C","D"]]);
});

it("片段证据不能靠补评升级为完整验证", async () => {
 mocks.call.mockClear();
 mocks.status.mockReturnValue({live:true});
 const criterion=AcceptanceCriterionSchema.parse({id:"LONG",title:"长文档",requirement:"完整",validationMethod:"semantic-judge"});
 const testCase={id:"H-LONG",title:"长文档",input:"检查",expected:["完整"],tags:[],hidden:true,criterionIds:[criterion.id],executionMode:"artifact-runtime" as const,evidenceScope:"product-behavior" as const} satisfies TestCase;
 const run={testCaseId:testCase.id,output:"retrieved context",latencyMs:1,cost:0,trace:[],verificationStatus:"partial" as const} satisfies TargetRunResult;
 mocks.call.mockResolvedValue({accuracy:90,evidence:90,riskCoverage:90,completeness:90,safety:"PASS",notes:[],failures:[],cases:[],criteria:[]});
 const result=await evaluateRuns({testCases:[testCase],runs:[run],context:{mode:"holdout",project:{acceptanceRubric:[criterion]}}});
 expect(result.unverifiedCriterionIds).toEqual(["LONG"]);
 expect(mocks.call).toHaveBeenCalledTimes(1);
});

it("漏判补评读取有界完整正文并强制新判定，避免反复复验同一片段", async () => {
 mocks.call.mockClear(); mocks.status.mockReturnValue({live:true});
 const criterion=AcceptanceCriterionSchema.parse({id:"CLOSURE",title:"流程完整闭环",requirement:"步骤有完成检查与恢复路径",hardGate:true,minScore:92,validationMethod:"semantic-judge"});
 const testCase={id:"H-CLOSURE",title:criterion.title,input:"检查 SOP",expected:["检查与恢复路径"],tags:[],hidden:true,criterionIds:[criterion.id],executionMode:"artifact-runtime" as const,evidenceScope:"product-behavior" as const} satisfies TestCase;
 const output="完整当前 SOP 正文 "+"前置准备、配置填写、结果检查；".repeat(1800)+"末尾异常恢复路径：修正配置后重试。";
 const run={testCaseId:testCase.id,output,latencyMs:1,cost:0,trace:[],verificationStatus:"verified" as const} satisfies TargetRunResult;
 const generic={accuracy:95,evidence:95,riskCoverage:95,completeness:95,safety:"PASS",notes:[],failures:[],cases:[],criteria:[]};
 mocks.call.mockImplementation(async (_operation: string,payload: {recovery?: unknown})=>payload.recovery
   ? {...generic,criteria:[{criterionId:criterion.id,score:95,pass:true,evidence:["当前 SOP 写明异常恢复步骤"],gaps:[],testCaseIds:[testCase.id]}]}
   : generic);
 const result=await evaluateRuns({testCases:[testCase],runs:[run],forceRefresh:true,context:{mode:"holdout",project:{acceptanceRubric:[criterion]}}});
 expect(result.unverifiedCriterionIds).toEqual([]);
 expect(mocks.call.mock.calls[0][1].runs[0].outputMeta.truncated).toBe(true);
 const recovery=mocks.call.mock.calls[1];
 expect(recovery[1].runs[0].outputChunks).toEqual([output]);
 expect(recovery[1].runs[0].outputMeta.truncated).toBe(false);
 expect(recovery[4]).toMatchObject({forceRefresh:true,requireLive:true});
});
it("后台已有评审模型时，浏览器无密钥也使用真实后台评审",async()=>{
 mocks.mode.mockReturnValue("http");mocks.status.mockReturnValue({live:false});mocks.call.mockClear();
 mocks.server.mockResolvedValue({accuracy:88,evidence:88,riskCoverage:88,completeness:88,safety:"PASS",cases:[],criteria:[]});
 const args={testCases:[],runs:[],context:{project:{aiProfile:{mode:"project"}}},forceRefresh:true};
 const result=await evaluateRuns(args);
 expect(result.demoJudged).not.toBe(true);expect(mocks.server).toHaveBeenCalledWith("evaluate",expect.objectContaining({project:expect.objectContaining({aiProfile:args.context.project.aiProfile})}));expect(mocks.call).not.toHaveBeenCalled();
});
it("后台请求失败保留具体原因，不替换成演示评审",async()=>{
 mocks.mode.mockReturnValue("http");mocks.status.mockReturnValue({live:false});mocks.call.mockClear();
 mocks.server.mockRejectedValue(new Error("真实评审超时"));
 await expect(evaluateRuns({testCases:[],runs:[],context:{}})).rejects.toThrow("真实评审超时");expect(mocks.call).not.toHaveBeenCalled();
});
it("后台不可用时只允许真实浏览器模型，禁止演示兜底",async()=>{
 mocks.mode.mockReturnValue("http");mocks.status.mockReturnValue({live:false});mocks.call.mockClear();
 mocks.server.mockRejectedValue(new ServerAiUnavailableError("后台未配置"));mocks.call.mockRejectedValue(new Error("需要真实模型连接"));
 await expect(evaluateRuns({testCases:[],runs:[],context:{}})).rejects.toThrow("真实模型连接");
 expect(mocks.call.mock.calls[0][4]).toMatchObject({requireLive:true});
});
