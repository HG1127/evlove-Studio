import {afterEach,expect,it,vi} from "vitest";
import {demoProject} from "../data/mock-project";
import {httpTargetAdapter} from "./http-adapter";

afterEach(()=>vi.unstubAllGlobals());

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
