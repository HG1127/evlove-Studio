// @vitest-environment node
import {afterEach,describe,expect,it,vi} from "vitest";
import {failureObservationFixture,learningContextHash} from "@evolution/testkit";
import {serverExperimentBuildCheckpoint,serverExperimentExecutionCheckpoint,serverExperimentObservationBinding} from "@evolution/harness";
import {buildServerFailurePlanningObservations} from "./server-failure-observations";
import {readServerHoldoutArtifactFingerprint} from "./server-holdout-artifact-binding";
import {runServerAi} from "./ai-gateway";
import {withExplicitServerAiConnection} from "./server-ai-connection";
const m=vi.hoisted(()=>({source:undefined as unknown,blobs:new Map<string,Blob>()}));
vi.mock("./artifact-runtime",()=>({getServerArtifactStore:()=>({get:async(id:string)=>m.blobs.get(id)})}));
vi.mock("./production-runtime",()=>({getServerProductionRuntime:()=>({missions:{get:async()=>m.source}})}));
afterEach(()=>{vi.unstubAllGlobals();vi.unstubAllEnvs();m.blobs.clear();});
async function fixture(historical?:string){
  const x=failureObservationFixture();for(const [id,b]of x.blobs)m.blobs.set(id,b);
  const ports={fingerprint:async(s:string)=>learningContextHash(s),readExecutionArtifactFingerprint:({project,candidate}:Parameters<typeof readServerHoldoutArtifactFingerprint>[0])=>readServerHoldoutArtifactFingerprint({project,candidate,observationDeploymentSha:historical??null})};
  const cp=await serverExperimentBuildCheckpoint(x.source,x.candidate,ports),binding=await serverExperimentObservationBinding(x.source,x.candidate,cp,ports);
  x.source.experimentRun.executionCheckpoints=[(await serverExperimentExecutionCheckpoint(x.source,x.candidate,cp,x.source.experimentRun.candidateResults[0]!.runs,Date.parse(x.at),ports,binding))!];
  x.current.failureObservationSources=[{...x.sourceRef(),...(historical?{executionDeploymentSha:historical}:{})}];m.source=x.source;
  vi.stubEnv("EVOLUTION_AI_FULL_REPAIR_TEXT_MISSIONS",[x.source.id,x.current.id].join(","));return x;
}
describe("failure-observation backend composition",()=>{
  it.each([undefined,"historical-deployment"])("verifies actual fixture bytes and historical namespace %s before the real router egress",async historical=>{
    vi.stubEnv("VERCEL_GIT_COMMIT_SHA","current-deployment");const x=await fixture(historical),out=await buildServerFailurePlanningObservations(x.current),requests:unknown[]=[];
    expect(out?.observations[0].comparisons[0]).toMatchObject({delta:-5});
    vi.stubGlobal("fetch",vi.fn(async(_url,init)=>{requests.push(JSON.parse(String(init.body)));throw Object.assign(Error("OFFLINE_CAPTURE_ONLY"),{code:"OFFLINE_CAPTURE_ONLY"});}));
    await expect(withExplicitServerAiConnection({connectionId:"failure-test",label:"Test",apiKey:"synthetic-key",baseUrl:"https://failure.example.test/v1",model:"test",protocol:"chat-completions",responseFormat:"json-object"},()=>runServerAi("plan",{project:{goal:"new task"},failureObservations:out}))).rejects.toMatchObject({code:"OFFLINE_CAPTURE_ONLY"});
    const wire=JSON.stringify(requests);expect(requests).toHaveLength(1);expect(wire).toContain("Current complete body");expect(wire).toContain(x.sourceRef().missionSha256);
    expect(wire).not.toMatch(/PRIVATE_.*SENTINEL|"(?:independentFinal|artifactSnapshots|runs|patches)"/);
  });
  it("rejects missing physical bytes before any provider request",async()=>{
    const x=await fixture();m.blobs.delete(x.candidate.artifactSnapshots[0]!.frozenArtifact!.blobId);const fetch=vi.fn();vi.stubGlobal("fetch",fetch);
    await expect(buildServerFailurePlanningObservations(x.current)).rejects.toThrow("readback");expect(fetch).not.toHaveBeenCalled();
  });
});
