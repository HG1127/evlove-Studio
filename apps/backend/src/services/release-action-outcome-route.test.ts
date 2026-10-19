// @vitest-environment node
import {afterEach,beforeEach,describe,expect,it,vi} from "vitest";

const mocks=vi.hoisted(()=>({
  permission:vi.fn(),missionGet:vi.fn(),missionSave:vi.fn(),eventAppend:vi.fn(),
  execute:vi.fn(),record:vi.fn(),
}));
vi.mock("nitro/h3",()=>({
  defineEventHandler:(handler:unknown)=>handler,
  readBody:(event:{body:unknown})=>event.body,
  createError:(input:{statusCode:number;statusMessage:string})=>Object.assign(new Error(input.statusMessage),input),
}));
vi.mock("@evolution/core",()=>({
  projectHasOnlineReleaseTarget:()=>true,
  htmlProtectionAcceptanceBlocker:()=>undefined,
  projectUsesConnectorRelease:()=>false,
  projectUsesHttpRelease:()=>true,
  projectUsesVercelRelease:()=>false,
  applyReleaseResultToProject:({project,result}:{project:Record<string,unknown>;result:{observedAt:string}})=>({
    ...project,release:{...(project.release as object),status:"shadow",observedAt:result.observedAt},
  }),
  applyProductionLearningGovernance:(project:unknown)=>project,
}));
vi.mock("./security-policy",()=>({requireGovernedEvolutionPermission:mocks.permission}));
vi.mock("./production-runtime",()=>({getServerProductionRuntime:()=>({
  missions:{get:mocks.missionGet,save:mocks.missionSave},events:{append:mocks.eventAppend},
})}));
vi.mock("./release-approval-store",()=>({requireActiveReleaseApprovalGrant:async()=>({id:"grant-1"})}));
vi.mock("./server-html-protection-accepted-authority",()=>({restoreServerHtmlProtectionAcceptedProject:async({project}:{project:unknown})=>({project})}));
vi.mock("./server-release-orchestration",()=>({executeServerReleaseProvider:mocks.execute}));
vi.mock("./release-outcome-telemetry",()=>({
  recordConnectorReleaseOutcomeObservation:vi.fn(),recordHttpReleaseOutcomeObservation:mocks.record,
}));

import route from "../../server/api/evolution/release-action.post";

const mission={
  id:"mission-1",stage:"release",updatedAt:"2026-09-26T00:00:00.000Z",
  releaseTarget:{provider:"http",mode:"preview-promote",status:"connected"},
  candidates:[{id:"candidate-1",artifactSnapshots:[{sourceArtifactId:"source-1",contentHash:"hash-1"}]}],
  experimentRun:{winnerId:"candidate-1"},
  validationRun:{recommendation:"release"},
  artifactAcceptance:{status:"passed",candidateId:"candidate-1"},
  gates:[{id:"artifact-ready",status:"approved"},{id:"release-ready",status:"approved"}],
  release:{status:"idle",candidateId:"candidate-1",trafficPercent:0},
  campaign:{status:"running"},
};
const receipt={
  ok:true,effectiveAction:"shadow",observedAt:"2026-09-26T01:00:00.000Z",note:"observed",
  deploymentId:"deployment-1",stableDeploymentId:"stable-1",trafficPercent:0,
  healthy:true,observationStatus:"healthy",evidenceMode:"live",
  artifactHashes:[{sourceArtifactId:"source-1",contentHash:"hash-1"}],
};

describe("manual Release Outcome feedback",()=>{
  beforeEach(()=>{
    for(const mock of Object.values(mocks))mock.mockReset();
    mocks.permission.mockResolvedValue(undefined);
    mocks.missionGet.mockResolvedValue(mission);
    mocks.missionSave.mockResolvedValue(undefined);
    mocks.eventAppend.mockResolvedValue(undefined);
    mocks.execute.mockResolvedValue(receipt);
  });
  afterEach(()=>vi.restoreAllMocks());

  it("keeps the observed Release and reports a failed Outcome write",async()=>{
    mocks.record.mockRejectedValueOnce(new Error("private database error"));
    const warn=vi.spyOn(console,"warn").mockImplementation(()=>undefined);
    const response=await route({body:{missionId:"mission-1",candidateId:"candidate-1",action:"shadow"}} as never);
    expect(response).toMatchObject({ok:true,outcomeTelemetry:{status:"failed"}});
    expect(mocks.missionSave).toHaveBeenCalledOnce();
    expect(mocks.eventAppend).toHaveBeenCalledWith(expect.objectContaining({
      type:"ReleaseChanged",payload:expect.objectContaining({
        outcomeTelemetry:expect.objectContaining({status:"failed"}),
      }),
    }));
    expect(warn).toHaveBeenCalled();
  });

  it("returns the recorded Outcome receipt after a successful write",async()=>{
    mocks.record.mockResolvedValueOnce({recorded:true,inserted:2,reason:"ok",telemetry:{warnings:[]}});
    const response=await route({body:{missionId:"mission-1",candidateId:"candidate-1",action:"shadow"}} as never);
    expect(response.outcomeTelemetry).toMatchObject({status:"recorded",inserted:2,warningCount:0});
    expect(mocks.eventAppend).toHaveBeenCalledWith(expect.objectContaining({
      payload:expect.objectContaining({outcomeTelemetry:expect.objectContaining({status:"recorded"})}),
    }));
  });
});
