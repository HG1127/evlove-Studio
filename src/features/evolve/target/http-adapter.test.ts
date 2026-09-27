import {afterEach,expect,it,vi} from "vitest";
import {demoProject} from "../data/mock-project";
const prepareRelease=vi.hoisted(()=>vi.fn());
vi.mock("./http-release-artifacts",()=>({prepareBrowserHttpReleaseArtifacts:prepareRelease}));
import {httpTargetAdapter} from "./http-adapter";

afterEach(()=>{vi.unstubAllGlobals();prepareRelease.mockReset();});

it("preserves an unverified Target result when the provider cannot return an Artifact hash",async()=>{
  const source={
    ...demoProject.sourceArtifacts[0],extension:"html",mimeType:"text/html",
    textContent:"<!doctype html><title>Test</title>",
  };
  const project={...demoProject,sourceArtifacts:[source]};
  const testCase={
    id:"T1",title:"External",input:"open page",expected:[],tags:[],hidden:false,
    criterionIds:[],executionMode:"external-runner" as const,evidenceScope:"product-behavior" as const,
  };
  vi.stubGlobal("fetch",vi.fn(async()=>new Response(JSON.stringify({
    testCaseId:"T1",output:"Runner unavailable",latencyMs:1,cost:0,
    verificationStatus:"unverified",trace:[],
  }),{status:200,headers:{"Content-Type":"application/json"}})));
  await expect(httpTargetAdapter.run({project,testCase})).resolves.toMatchObject({
    testCaseId:"T1",verificationStatus:"unverified",output:"Runner unavailable",
  });
});

it("uses the separate Release Target connection and sends prepared Gate F bytes",async()=>{
  const candidate=demoProject.candidates[0]!;
  const project={...demoProject,
    targetConnection:{...demoProject.targetConnection,adapter:"http" as const,connectionId:"run-only"},
    releaseTarget:{provider:"http" as const,mode:"preview-promote" as const,status:"connected" as const,label:"Release",connectionId:"release-only",healthPath:"/"},
  };
  const frozenArtifacts=[{sourceArtifactId:"source",snapshotHash:"hash",name:"a.txt",mimeType:"text/plain",sha256:"a".repeat(64),size:3,contentBase64:"bmV3"}];
  prepareRelease.mockResolvedValue({candidate,frozenArtifacts});
  const fetchMock=vi.fn(async(_url:string,init?:RequestInit)=>{
    const body=JSON.parse(String(init?.body)) as {connectionId:string;frozenArtifacts:unknown[];action:string};
    expect(body.connectionId).toBe("release-only");
    expect(body.frozenArtifacts).toEqual(frozenArtifacts);
    expect(body.action).toBe("shadow");
    return new Response(JSON.stringify({ok:true,trafficPercent:0,note:"shadow",healthy:true,kpis:[],evidenceMode:"live"}),{status:200});
  });
  vi.stubGlobal("fetch",fetchMock);
  await expect(httpTargetAdapter.release!({project,candidate,action:"shadow"})).resolves.toMatchObject({ok:true});
  expect(prepareRelease).toHaveBeenCalledOnce();
  expect(fetchMock).toHaveBeenCalledOnce();
});