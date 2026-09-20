import { it, expect, vi } from "vitest";
const mocks = vi.hoisted(() => ({ status: vi.fn(), call: vi.fn() }));
vi.mock("../ai/service", () => ({ getAiProviderStatus: mocks.status, runEvolveAi: mocks.call }));
import { evaluateRuns } from "./service";
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
