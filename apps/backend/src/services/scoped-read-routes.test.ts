// @vitest-environment node
import {beforeEach,describe,expect,it,vi} from "vitest";

const mocks=vi.hoisted(()=>({
  permission:vi.fn(),exportLedger:vi.fn(),verifyLedger:vi.fn(),
  missionGet:vi.fn(),jobGet:vi.fn(),parseResult:vi.fn(),artifactStore:vi.fn(),
  missionEvidence:vi.fn(),verifyMissionEvidence:vi.fn(),
}));
vi.mock("nitro/h3",()=>({
  defineEventHandler:(handler:unknown)=>handler,
  getQuery:(event:{query?:Record<string,unknown>})=>event.query??{},
  getRouterParam:(event:{params?:Record<string,unknown>},key:string)=>event.params?.[key],
  createError:(input:{statusCode:number;statusMessage:string})=>Object.assign(new Error(input.statusMessage),input),
}));
vi.mock("./security-policy",()=>({requireGovernedEvolutionPermission:mocks.permission}));
vi.mock("./evidence-ledger",()=>({
  createEvidenceLedgerExport:mocks.exportLedger,verifyEvidenceLedger:mocks.verifyLedger,
}));
vi.mock("./evidence-runtime",()=>({
  getMissionEvidence:mocks.missionEvidence,verifyMissionEvidence:mocks.verifyMissionEvidence,
}));
vi.mock("./production-runtime",()=>({
  getServerProductionRuntime:()=>({missions:{get:mocks.missionGet},jobs:{get:mocks.jobGet}}),
}));
vi.mock("./artifact-runtime",()=>({getServerArtifactStore:mocks.artifactStore}));
vi.mock("./source-parse-result",()=>({readSourceParseResult:mocks.parseResult}));

import exportRoute from "../../server/api/evolution/evidence-ledger-export.get";
import verifyRoute from "../../server/api/evolution/evidence-ledger-verify.get";
import checkpointRoute from "../../server/api/evolution/checkpoints.get";
import parseStatusRoute from "../../server/api/evolution/parse-status.get";
import missionEvidenceRoute from "../../server/api/evolution/evidence/[missionId].get";

function queryEvent(query:Record<string,unknown>){return {query} as never;}
function pathEvent(missionId:unknown){return {params:{missionId}} as never;}

describe("scoped read routes",()=>{
  beforeEach(()=>{
    for(const mock of Object.values(mocks))mock.mockReset();
    mocks.permission.mockResolvedValue(undefined);
    mocks.exportLedger.mockResolvedValue({missionId:"mission-1"});
    mocks.verifyLedger.mockResolvedValue({valid:true});
    mocks.missionGet.mockResolvedValue({campaign:{checkpoint:null}});
    mocks.jobGet.mockResolvedValue({id:"parse-1",type:"parse"});
    mocks.parseResult.mockResolvedValue({job:{id:"parse-1"}});
    mocks.artifactStore.mockReturnValue({});
    mocks.missionEvidence.mockResolvedValue([]);
    mocks.verifyMissionEvidence.mockResolvedValue({valid:true});
  });

  it("rejects ambiguous or missing Mission IDs before Evidence and Checkpoint reads",async()=>{
    for(const route of [exportRoute,verifyRoute,checkpointRoute]){
      for(const missionId of [undefined,"","  ",["mission-1","mission-2"],"x".repeat(201)]){
        await expect(route(queryEvent({missionId}))).rejects.toMatchObject({statusCode:400});
      }
    }
    expect(mocks.exportLedger).not.toHaveBeenCalled();
    expect(mocks.verifyLedger).not.toHaveBeenCalled();
    expect(mocks.missionGet).not.toHaveBeenCalled();
  });

  it("keeps valid trimmed Mission reads",async()=>{
    await exportRoute(queryEvent({missionId:" mission-1 "}));
    await verifyRoute(queryEvent({missionId:" mission-1 "}));
    await checkpointRoute(queryEvent({missionId:" mission-1 "}));
    expect(mocks.exportLedger).toHaveBeenCalledWith("mission-1");
    expect(mocks.verifyLedger).toHaveBeenCalledWith("mission-1");
    expect(mocks.missionGet).toHaveBeenCalledWith("mission-1");
  });

  it("rejects malformed Parse Job IDs before the Job lookup",async()=>{
    for(const id of [undefined,"","  ",["parse-1","parse-2"],"x".repeat(201)]){
      await expect(parseStatusRoute(queryEvent({id}))).rejects.toMatchObject({statusCode:400});
    }
    expect(mocks.jobGet).not.toHaveBeenCalled();
    await parseStatusRoute(queryEvent({id:" parse-1 "}));
    expect(mocks.jobGet).toHaveBeenCalledWith("parse-1");
  });

  it("returns HTTP 400 for a missing legacy Evidence path ID",async()=>{
    for(const missionId of [undefined,"","  ","x".repeat(201)]){
      await expect(missionEvidenceRoute(pathEvent(missionId))).rejects.toMatchObject({statusCode:400});
    }
    expect(mocks.missionEvidence).not.toHaveBeenCalled();
    await expect(missionEvidenceRoute(pathEvent(" mission-1 "))).resolves.toEqual({
      entries:[],verification:{valid:true},
    });
    expect(mocks.missionEvidence).toHaveBeenCalledWith("mission-1");
  });
});
