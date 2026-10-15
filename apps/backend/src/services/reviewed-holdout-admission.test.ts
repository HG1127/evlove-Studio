// @vitest-environment node
import {beforeEach,describe,expect,it,vi} from "vitest";
import {reviewedHoldoutFixture} from "@evolution/testkit";
import type {EvolutionActor,EvolveProject} from "@evolution/contracts";
import {previewReviewedHoldout} from "./reviewed-holdout-admission";
import {reviewedScope,reviewedSha,requireReviewedHuman} from "./reviewed-holdout-identity";
const m=vi.hoisted(()=>({read:vi.fn(),physical:vi.fn(),store:vi.fn(),route:vi.fn()}));
vi.mock("./production-runtime",()=>({getServerMissionEnvelope:m.read}));
vi.mock("./server-holdout-artifact-binding",()=>({readServerHoldoutArtifactFingerprint:m.physical}));
vi.mock("./artifact-runtime",()=>({getServerArtifactStore:m.store}));
vi.mock("./ai-gateway",()=>({serverAiScoringRouteFingerprint:m.route}));
let p:EvolveProject;
beforeEach(()=>{vi.resetAllMocks();const x=reviewedHoldoutFixture();p=x.project;m.read.mockImplementation(async()=>({payload:structuredClone(p)}));m.physical.mockResolvedValue("a".repeat(64));m.route.mockResolvedValue("route");m.store.mockReturnValue(x.store);});
describe("reviewed Holdout admission physical boundary",()=>{
  it("previews exact Original, frozen Candidate, paper, REVIEW and full input hashes without writes",async()=>{
    const before=structuredClone(p),preview=await previewReviewedHoldout(p);
    expect(preview.binding.baselineSha256).toBe(reviewedSha(p.baselineRun));
    expect(preview.binding.frozenSha256).not.toBe(preview.binding.originalSha256);
    expect(preview.binding.hiddenSha256).toBe(reviewedSha(p.hiddenEvalSuite));
    expect(preview.reviewNotes).toEqual(p.baselineRun.result!.notes);expect(p).toEqual(before);
  });
  it.each(["physical","route","original","generation","route-after"])("rejects %s drift/unavailability",async kind=>{
    if(kind==="physical")m.physical.mockResolvedValue(undefined);
    if(kind==="route")m.route.mockResolvedValue(undefined);
    if(kind==="original")m.store.mockReturnValue({get:async()=>undefined});
    if(kind==="generation")m.read.mockResolvedValue({payload:{...p,goal:"changed"}});
    if(kind==="route-after")m.route.mockResolvedValueOnce("route").mockResolvedValue("changed");
    await expect(previewReviewedHoldout(p)).rejects.toThrow();
  });
  it("rejects an unchanged Candidate even with a valid SHA receipt",async()=>{
    const x=reviewedHoldoutFixture();p=x.project;
    x.blobs.set("source",x.blobs.get(x.current.artifactSnapshots[0]!.frozenArtifact!.blobId)!);
    p.sourceArtifacts[0]!.size=x.blobs.get("source")!.size;m.store.mockReturnValue(x.store);
    await expect(previewReviewedHoldout(p)).rejects.toThrow("实际文件改动");
  });
  it.each(["service","vercel-protected-internal"])("rejects %s as human confirmation",source=>{
    expect(()=>requireReviewedHuman({id:"a",role:"admin",source} as EvolutionActor)).toThrow();
  });
  it.each(["viewer","approver","service"])("rejects role %s",role=>{
    expect(()=>requireReviewedHuman({id:"a",role,source:"browser-session"} as EvolutionActor)).toThrow();
  });
  it.each(["browser-session","trusted-header","internal-dev"])("allows governed human source %s",source=>{
    expect(()=>requireReviewedHuman({id:"a",role:"operator",source} as EvolutionActor)).not.toThrow();
  });
  it("scope binds rubric, protection, source, REVIEW, frozen files and paper",()=>{
    const before=reviewedScope(p);p.acceptanceRubric[0]!.minScore=91;expect(reviewedScope(p)).not.toBe(before);
  });
});
