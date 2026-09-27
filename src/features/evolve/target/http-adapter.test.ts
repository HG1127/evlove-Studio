import {afterEach,expect,it,vi} from "vitest";
import {demoProject} from "../data/mock-project";
const prepareRelease=vi.hoisted(()=>vi.fn());
const prepareRunFile=vi.hoisted(()=>vi.fn());
const prepareRunHtml=vi.hoisted(()=>vi.fn());
vi.mock("./http-release-artifacts",()=>({prepareBrowserHttpReleaseArtifacts:prepareRelease}));
vi.mock("./http-run-file",()=>({prepareBrowserHttpRunFile:prepareRunFile,prepareBrowserHttpRunHtml:prepareRunHtml}));
import {httpTargetAdapter} from "./http-adapter";

afterEach(()=>{vi.unstubAllGlobals();prepareRelease.mockReset();prepareRunFile.mockReset();prepareRunHtml.mockReset();});

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
  prepareRunHtml.mockResolvedValue({artifact:{name:source.name,content:source.textContent},sha256:"unused"});
  vi.stubGlobal("fetch",vi.fn(async()=>new Response(JSON.stringify({
    testCaseId:"T1",output:"Runner unavailable",latencyMs:1,cost:0,
    verificationStatus:"unverified",trace:[],
  }),{status:200,headers:{"Content-Type":"application/json"}})));
  await expect(httpTargetAdapter.run({project,testCase})).resolves.toMatchObject({
    testCaseId:"T1",verificationStatus:"unverified",output:"Runner unavailable",
  });
});

it("sends a uniquely scoped binary Target file and verifies the remote SHA",async()=>{
  const source={...demoProject.sourceArtifacts[0]!,id:"pdf-source",name:"report.pdf",extension:"pdf",mimeType:"application/pdf",storageRef:"pdf-upload"};
  const project={...demoProject,sourceArtifacts:[source],acceptanceRubric:[{id:"pdf-criterion",artifactIds:["pdf-source"]}] as typeof demoProject.acceptanceRubric};
  const testCase={id:"T1",title:"PDF",input:"inspect",expected:[],tags:[],hidden:false,
    criterionIds:["pdf-criterion"],executionMode:"external-runner" as const,evidenceScope:"product-behavior" as const};
  const file={sourceArtifactId:"pdf-source",name:"report.pdf",mimeType:"application/pdf",sha256:"a".repeat(64),size:3,contentBase64:"bmV3"};
  prepareRunFile.mockResolvedValue(file);
  const fetchMock=vi.fn(async(_url:string,init?:RequestInit)=>{
    const body=JSON.parse(String(init?.body)) as {file:unknown;artifact?:unknown;archiveBase64?:string};
    expect(body.file).toEqual(file);
    expect(body.artifact).toBeUndefined();
    expect(body.archiveBase64).toBeUndefined();
    return new Response(JSON.stringify({testCaseId:"T1",output:"checked",latencyMs:1,cost:0,verificationStatus:"verified",artifactHash:file.sha256,trace:[]}),{status:200});
  });
  vi.stubGlobal("fetch",fetchMock);
  await expect(httpTargetAdapter.run({project,testCase})).resolves.toMatchObject({verificationStatus:"verified"});
  expect(prepareRunFile).toHaveBeenCalledWith(source,undefined);
  const wrong=vi.fn(async()=>new Response(JSON.stringify({testCaseId:"T1",output:"wrong",latencyMs:1,cost:0,verificationStatus:"verified",artifactHash:"wrong",trace:[]}),{status:200}));
  vi.stubGlobal("fetch",wrong);
  await expect(httpTargetAdapter.run({project,testCase})).rejects.toThrow("真实 Target 文件指纹不一致");
});
it("refuses an ambiguous multi-Target Test before calling the remote Runner",async()=>{
  const first={...demoProject.sourceArtifacts[0]!,id:"first",name:"first.pdf",extension:"pdf",mimeType:"application/pdf"};
  const second={...first,id:"second",name:"second.pdf"};
  const project={...demoProject,sourceArtifacts:[first,second]};
  const testCase={id:"T1",title:"Both",input:"inspect",expected:[],tags:[],hidden:false,criterionIds:[],
    executionMode:"external-runner" as const,evidenceScope:"product-behavior" as const};
  const fetchMock=vi.fn();vi.stubGlobal("fetch",fetchMock);
  await expect(httpTargetAdapter.run({project,testCase})).rejects.toThrow("没有唯一的 Target Artifact 绑定");
  expect(prepareRunFile).not.toHaveBeenCalled();
  expect(fetchMock).not.toHaveBeenCalled();
});

it("sends a scoped ZIP through the legacy archive field after exact byte binding",async()=>{
  const html={...demoProject.sourceArtifacts[0]!,id:"html",name:"index.html",extension:"html",mimeType:"text/html"};
  const zip={...html,id:"zip",name:"repo.zip",extension:"zip",mimeType:"application/zip"};
  const project={...demoProject,sourceArtifacts:[html,zip],acceptanceRubric:[{id:"zip-rule",artifactIds:["zip"]}] as typeof demoProject.acceptanceRubric};
  const testCase={id:"T1",title:"ZIP",input:"inspect",expected:[],tags:[],hidden:false,criterionIds:["zip-rule"],
    executionMode:"external-runner" as const,evidenceScope:"product-behavior" as const};
  prepareRunFile.mockResolvedValue({sourceArtifactId:"zip",name:"repo.zip",mimeType:"application/zip",sha256:"a".repeat(64),size:3,contentBase64:"bmV3"});
  const fetchMock=vi.fn(async(_url:string,init?:RequestInit)=>{
    const body=JSON.parse(String(init?.body)) as {archiveBase64:string;file?:unknown;artifact?:unknown};
    expect(body.archiveBase64).toBe("bmV3");expect(body.file).toBeUndefined();expect(body.artifact).toBeUndefined();
    return new Response(JSON.stringify({testCaseId:"T1",output:"ok",latencyMs:1,cost:0,verificationStatus:"verified",artifactHash:"a".repeat(64),trace:[]}),{status:200});
  });
  vi.stubGlobal("fetch",fetchMock);
  await expect(httpTargetAdapter.run({project,testCase})).resolves.toMatchObject({verificationStatus:"verified"});
  expect(prepareRunFile).toHaveBeenCalledWith(zip,undefined);
  expect(prepareRunHtml).not.toHaveBeenCalled();
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