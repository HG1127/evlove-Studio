// @vitest-environment node
import {afterEach,describe,expect,it,vi} from "vitest";
import {createHash} from "node:crypto";
import {Blob as NodeBlob} from "node:buffer";
import type {EvolveProject,TestCase} from "@evolution/contracts";
import {executeServerBaselineExternal} from "./server-baseline";

const {getBlob}=vi.hoisted(()=>({getBlob:vi.fn()}));
vi.mock("./artifact-runtime",()=>({getServerArtifactStore:()=>({get:getBlob})}));

const previousRunUrl=process.env.EVOLUTION_TARGET_RUN_URL;
const previousToken=process.env.EVOLUTION_TARGET_BEARER_TOKEN;

afterEach(()=>{
  if(previousRunUrl===undefined)delete process.env.EVOLUTION_TARGET_RUN_URL;
  else process.env.EVOLUTION_TARGET_RUN_URL=previousRunUrl;
  if(previousToken===undefined)delete process.env.EVOLUTION_TARGET_BEARER_TOKEN;
  else process.env.EVOLUTION_TARGET_BEARER_TOKEN=previousToken;
  vi.unstubAllGlobals();
});

describe("server campaign HTTP Target composition",()=>{
  it("routes an HTTP Target Baseline through the server proxy instead of Sandbox fallback",async()=>{
    process.env.EVOLUTION_TARGET_RUN_URL="https://runner.internal/run";
    process.env.EVOLUTION_TARGET_BEARER_TOKEN="server-secret";
    const html="<html><body>LIVE TARGET</body></html>";
    getBlob.mockReset().mockResolvedValue(new NodeBlob([html],{type:"text/html"}));
    const expectedHash=createHash("sha256").update(html).digest("hex");
    const project={
      id:"http-baseline",
      targetConnection:{adapter:"http",connectionId:"prod-runner",status:"connected",label:"HTTP Target"},
      sourceArtifacts:[{
        id:"html",name:"index.html",role:"target",artifactKind:"document",mimeType:"text/html",size:html.length,extension:"html",
        inputMode:"upload",parseStatus:"ready",textContent:"STALE PARSED INDEX",textExcerpt:"STALE PARSED INDEX",structure:[],warnings:[],createdAt:"2026-09-22T00:00:00.000Z",
      }],
    } as unknown as EvolveProject;
    const testCase={
      id:"E2E",title:"Target E2E",input:"run",expected:["ok"],tags:[],hidden:false,criterionIds:[],
      executionMode:"external-runner",evidenceScope:"product-behavior",
    } as TestCase;
    const fetchMock=vi.fn(async(input:string|URL|Request,init?:RequestInit)=>{
      expect(String(input)).toBe("https://runner.internal/run");
      expect((init?.headers as Record<string,string>).Authorization).toBe("Bearer server-secret");
      const body=JSON.parse(String(init?.body)) as {projectId:string;connectionId:string;artifact?:{content:string}};
      expect(body.projectId).toBe("http-baseline");
      expect(body.connectionId).toBe("prod-runner");
      expect(body.artifact?.content).toBe(html);
      return new Response(JSON.stringify({
        testCaseId:"E2E",output:"remote verified",latencyMs:5,cost:0,
        verificationStatus:"verified",artifactHash:expectedHash,trace:[],
      }),{status:200,headers:{"Content-Type":"application/json"}});
    });
    vi.stubGlobal("fetch",fetchMock);

    const [result]=await executeServerBaselineExternal(project,[testCase]);
    expect(result?.verificationStatus).toBe("verified");
    expect(result?.output).toBe("remote verified");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(getBlob).toHaveBeenCalledWith("html");
  });
});
