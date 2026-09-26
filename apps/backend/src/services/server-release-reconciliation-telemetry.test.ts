// @vitest-environment node
import {afterEach,describe,expect,it,vi} from "vitest";
import type {Candidate,EvolveProject,ReleaseAdapterResult,VercelReleaseObservation} from "@evolution/contracts";

const {observeHttp,observeConnector,observeVercel,recordHttp,recordConnector,recordVercel}=vi.hoisted(()=>({
  observeHttp:vi.fn(),observeConnector:vi.fn(),observeVercel:vi.fn(),
  recordHttp:vi.fn(async(_project:EvolveProject,_observation:ReleaseAdapterResult)=>{
    void _project;void _observation;return{recorded:true,inserted:1,reason:"ok",telemetry:{warnings:[]}};
  }),
  recordConnector:vi.fn(async(_project:EvolveProject,_observation:ReleaseAdapterResult)=>{
    void _project;void _observation;return{recorded:true,inserted:1,reason:"ok",telemetry:{warnings:[]}};
  }),
  recordVercel:vi.fn(async(_project:EvolveProject,_observation:VercelReleaseObservation)=>{
    void _project;void _observation;return{recorded:true,inserted:1,reason:"ok",telemetry:{warnings:[]}};
  }),
}));

vi.mock("./http-target-gateway",()=>({observeHttpTarget:observeHttp}));
vi.mock("./connector-release",()=>({observeConnectorReleaseReality:observeConnector}));
vi.mock("./vercel-release",()=>({observeVercelReleaseReality:observeVercel}));
vi.mock("./release-outcome-telemetry",()=>({
  recordHttpReleaseOutcomeObservation:recordHttp,
  recordConnectorReleaseOutcomeObservation:recordConnector,
  recordReleaseOutcomeObservation:recordVercel,
}));

import {runServerMissionReleaseReconciliation} from "./server-release-reconciliation";

afterEach(()=>{
  observeHttp.mockReset();observeConnector.mockReset();observeVercel.mockReset();
  recordHttp.mockClear();recordConnector.mockClear();recordVercel.mockClear();
});

function fixture(provider:"http"|"connector"){
  const candidate={
    id:"C1",name:"candidate",change:"x",patches:[],
    artifactSnapshots:[{id:"s",sourceArtifactId:"source",name:"a.txt",mimeType:"text/plain",content:"new",contentHash:"hash-c1",createdAt:"now"}],
  } as unknown as Candidate;
  return{
    id:"release-reconciliation",version:"V12",currentVersionId:"V12",appliedPatches:[],versions:[],updatedAt:"old",stage:"release",
    candidates:[candidate],experimentRun:{winnerId:"C1"},searchChampion:{candidate},
    targetConnection:provider==="connector"
      ?{adapter:"connector",connectionId:"connector",status:"connected",label:"Connector"}
      :{adapter:"http",connectionId:"http",status:"connected",label:"HTTP"},
    releaseTarget:{provider,mode:"preview-promote",status:"connected",label:"Target Release",connectionId:"release",healthPath:"/"},
    campaign:{status:"paused",stopReason:"[server-release-provider-pending] promote result unknown",schedule:{enabled:false}},
    release:{
      status:"shadow",candidateId:"C1",deploymentId:"candidate-deployment",stableDeploymentId:"stable-deployment",
      trafficPercent:0,healthy:true,evidenceMode:"live",observationStatus:"healthy",environment:"preview",kpis:[],history:[],
      recovery:{status:"pending",action:"promote",reason:"provider timeout",at:"2026-09-24T18:00:00Z"},
    },
  } as unknown as EvolveProject;
}

function receipt(action:"shadow"|"promote",hash="hash-c1"):ReleaseAdapterResult{
  return{
    ok:true,trafficPercent:action==="promote"?100:0,note:"observed",healthy:true,kpis:[],evidenceMode:"live",
    effectiveAction:action,observationStatus:"healthy",deploymentId:"candidate-deployment",stableDeploymentId:"stable-deployment",
    artifactHashes:[{sourceArtifactId:"source",contentHash:hash}],
    environment:action==="shadow"?"preview":"production",observedAt:"2026-09-24T18:05:00Z",sampleSize:2,windowMinutes:1,
  };
}

function vercelObservation(productionId:string):VercelReleaseObservation{
  return{
    provider:"vercel",checkedAt:"2026-09-24T18:05:00Z",
    productionDeployment:{id:productionId,url:"https://prod.example.test",state:"READY",target:"production"},
    boundDeployment:{id:"candidate-deployment",url:"https://candidate.example.test",state:"READY",target:"preview"},
    productionHealth:{ready:true,url:"https://prod.example.test",checkedAt:"2026-09-24T18:05:00Z",latencyMs:2,checks:[],message:"ok"},
    boundHealth:{ready:true,url:"https://candidate.example.test",checkedAt:"2026-09-24T18:05:00Z",latencyMs:2,checks:[],message:"ok"},
    errors:[],
  };
}

describe("server release reconciliation telemetry gate",()=>{
  for(const provider of ["http","connector"] as const){
    it(`does not record or advertise an invalid ${provider} observation`,async()=>{
      const observe=provider==="http"?observeHttp:observeConnector;
      const record=provider==="http"?recordHttp:recordConnector;
      observe.mockResolvedValue(receipt("shadow","wrong"));
      const outcome=await runServerMissionReleaseReconciliation(fixture(provider));
      expect(outcome.disposition).toBe("manual-check");
      expect(outcome.previewReady).toBe(false);
      expect(outcome.boundHealthReady).toBeUndefined();
      expect(outcome.project.release.recovery?.status).toBe("manual-check");
      expect(record).not.toHaveBeenCalled();
      expect(outcome.outcomeTelemetry.status).toBe("skipped");
    });

    it(`does not report stale Production health for rejected ${provider} observations`,async()=>{
      const observe=provider==="http"?observeHttp:observeConnector;
      const project=fixture(provider);
      project.release={...project.release,status:"promoted",environment:"production",trafficPercent:100};
      observe.mockResolvedValue(receipt("promote","wrong"));
      const outcome=await runServerMissionReleaseReconciliation(project);
      expect(outcome.disposition).toBe("manual-check");
      expect(outcome.productionHealthReady).toBeUndefined();
    });

    it(`records a reconciled exact ${provider} observation`,async()=>{
      const observe=provider==="http"?observeHttp:observeConnector;
      const record=provider==="http"?recordHttp:recordConnector;
      observe.mockResolvedValue(receipt("promote"));
      const outcome=await runServerMissionReleaseReconciliation(fixture(provider));
      expect(outcome.disposition).toBe("terminal-live-decision");
      expect(record).toHaveBeenCalledTimes(1);
      expect(record.mock.calls[0]?.[0].release.status).toBe("promoted");
      expect(outcome.outcomeTelemetry).toMatchObject({status:"recorded",inserted:1});
    });

    it(`reports a retryable ${provider} Outcome write failure without changing the live release decision`,async()=>{
      const observe=provider==="http"?observeHttp:observeConnector;
      const record=provider==="http"?recordHttp:recordConnector;
      observe.mockResolvedValue(receipt("promote"));
      record.mockRejectedValueOnce(new Error("database unavailable"));
      const warn=vi.spyOn(console,"warn").mockImplementation(()=>undefined);
      const outcome=await runServerMissionReleaseReconciliation(fixture(provider));
      expect(outcome.disposition).toBe("terminal-live-decision");
      expect(outcome.outcomeTelemetry.status).toBe("failed");
      expect(warn).toHaveBeenCalled();
      warn.mockRestore();
    });
  }

  it("does not record or advertise Vercel health when Production identity is unknown",async()=>{
    const project=fixture("http");
    project.releaseTarget={provider:"vercel",mode:"preview-promote",status:"connected",label:"Vercel",healthPath:"/"};
    observeVercel.mockResolvedValue(vercelObservation("unknown-deployment"));
    const outcome=await runServerMissionReleaseReconciliation(project);
    expect(outcome.disposition).toBe("manual-check");
    expect(outcome.previewReady).toBe(false);
    expect(outcome.productionHealthReady).toBe(false);
    expect(outcome.boundHealthReady).toBe(false);
    expect(recordVercel).not.toHaveBeenCalled();
  });

  it("records Vercel health after the exact Production deployment is reconciled",async()=>{
    const project=fixture("http");
    project.releaseTarget={provider:"vercel",mode:"preview-promote",status:"connected",label:"Vercel",healthPath:"/"};
    observeVercel.mockResolvedValue(vercelObservation("candidate-deployment"));
    const outcome=await runServerMissionReleaseReconciliation(project);
    expect(outcome.disposition).toBe("terminal-live-decision");
    expect(outcome.productionHealthReady).toBe(true);
    expect(recordVercel).toHaveBeenCalledTimes(1);
  });
});
