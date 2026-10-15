import {afterEach,describe,expect,it,vi} from "vitest";
import {previewReviewedHoldout,startReviewedHoldout} from "./reviewed-holdout-client";
import type {ReviewedHoldoutRequest} from "@evolution/contracts";
const binding={schemaVersion:"reviewed-holdout-binding-v1" as const,missionId:"m",sourceUpdatedAt:"at",baselineId:"b",baselineSha256:"a".repeat(64),
  candidateId:"C1",snapshotSha256:"b".repeat(64),frozenSha256:"c".repeat(64),originalSha256:"d".repeat(64),hiddenSha256:"e".repeat(64),
  inputSha256:"f".repeat(64),physicalSha256:"1".repeat(64),scoringRouteFingerprint:"route"};
const request:ReviewedHoldoutRequest={binding,idempotencyKey:"same-key",humanReviewNote:"Reviewed explicitly",preserveReview:true,preserveAcceptanceGates:true};
afterEach(()=>vi.unstubAllGlobals());
describe("reviewed Holdout HTTP client",()=>{
  it("GET preview does not auto-start or call any model endpoint",async()=>{
    const fetch=vi.fn().mockResolvedValue(Response.json({binding,reviewNotes:["Keep REVIEW"],preservationNotice:"REVIEW 保留；仅同一冻结文件的隔离隐藏验证；验收标准、保护要求和 Gate F 不豁免。"}));vi.stubGlobal("fetch",fetch);
    expect((await previewReviewedHoldout("m")).binding).toEqual(binding);expect(fetch).toHaveBeenCalledExactlyOnceWith("/api/evolution/reviewed-holdout?missionId=m",undefined);
  });
  it("sends only the strict explicit request to the dedicated endpoint",async()=>{
    const fetch=vi.fn().mockResolvedValue(Response.json({missionId:"m",controlJobId:"j",runId:"r",status:"queued"}));vi.stubGlobal("fetch",fetch);
    await startReviewedHoldout(request);expect(fetch).toHaveBeenCalledOnce();
    const [url,init]=fetch.mock.calls[0]!;expect(url).toBe("/api/evolution/reviewed-holdout");expect(JSON.parse(init.body)).toEqual(request);
  });
  it("does not fabricate a receipt on an unknown start acknowledgement",async()=>{
    vi.stubGlobal("fetch",vi.fn().mockResolvedValue(Response.json({error:"启动结果尚未确认"},{status:503})));
    await expect(startReviewedHoldout(request)).rejects.toThrow("尚未确认");
  });
  it("rejects a receipt from another Mission",async()=>{
    vi.stubGlobal("fetch",vi.fn().mockResolvedValue(Response.json({missionId:"other",controlJobId:"j",runId:"r",status:"queued"})));
    await expect(startReviewedHoldout(request)).rejects.toThrow("不属于");
  });
});
