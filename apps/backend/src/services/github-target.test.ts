// @vitest-environment node
import {afterEach,beforeEach,describe,expect,it,vi} from "vitest";
import {downloadExactGitRepositoryArchive,executeGitTargetAction,githubTargetCapabilities} from "./github-target";

const KEYS=["EVOLUTION_GITHUB_TOKEN","GITHUB_TOKEN","EVOLUTION_GITHUB_API_URL","EVOLUTION_GITHUB_REPO_ALLOWLIST","EVOLUTION_GITHUB_WEBHOOK_SECRET"] as const;
const previous=new Map<string,string|undefined>();
const repo={provider:"github" as const,owner:"acme",repo:"app",baseBranch:"main"};

function json(value:unknown,status=200){return new Response(JSON.stringify(value),{status,headers:{"Content-Type":"application/json"}});}

describe("GitHub target provider",()=>{
  beforeEach(()=>{
    for(const key of KEYS){previous.set(key,process.env[key]);delete process.env[key];}
    process.env.EVOLUTION_GITHUB_TOKEN="gh_test_token";
    process.env.EVOLUTION_GITHUB_API_URL="https://api.github.test";
    process.env.EVOLUTION_GITHUB_REPO_ALLOWLIST="acme/app";
  });
  afterEach(()=>{
    vi.unstubAllGlobals();
    for(const key of KEYS){const value=previous.get(key);if(value===undefined)delete process.env[key];else process.env[key]=value;}
  });

  it("reports code-ready but config-blocked when token/allowlist are missing",()=>{
    delete process.env.EVOLUTION_GITHUB_TOKEN;
    delete process.env.EVOLUTION_GITHUB_REPO_ALLOWLIST;
    const caps=githubTargetCapabilities();
    expect(caps.codeReady).toBe(true);
    expect(caps.configured).toBe(false);
    expect(caps.lifecycle).toEqual({read:true,snapshot:true,mutate:true,validate:true,deploy:true,observe:true,rollback:true});
  });

  it("captures exact base commit and tree SHA",async()=>{
    const fetchMock=vi.fn(async(input:RequestInfo|URL)=>{
      const url=String(input);
      if(url.endsWith("/git/ref/heads/main"))return json({object:{sha:"abc1234"}});
      if(url.endsWith("/git/commits/abc1234"))return json({sha:"abc1234",tree:{sha:"tree123"}});
      throw new Error("unexpected "+url);
    });
    vi.stubGlobal("fetch",fetchMock);
    const result=await executeGitTargetAction({action:"snapshot",repository:repo});
    expect(result).toMatchObject({action:"snapshot",commitSha:"abc1234",treeSha:"tree123",branch:"main"});
  });

  it("downloads repository bytes only by exact commit SHA through the allowlisted server credential",async()=>{
    const bytes=Uint8Array.from([0x50,0x4b,0x03,0x04]);
    const fetchMock=vi.fn(async(input:RequestInfo|URL,init?:RequestInit)=>{
      expect(String(input)).toBe("https://api.github.test/repos/acme/app/zipball/abc1234");
      expect((init?.headers as Record<string,string>).Authorization).toBe("Bearer gh_test_token");
      return new Response(bytes,{status:200,headers:{"Content-Type":"application/zip","Content-Length":String(bytes.byteLength)}});
    });
    vi.stubGlobal("fetch",fetchMock);
    expect(await downloadExactGitRepositoryArchive(repo,"abc1234")).toEqual(bytes);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("fails closed when base branch moved before mutation",async()=>{
    const fetchMock=vi.fn(async()=>json({object:{sha:"new9999"}}));
    vi.stubGlobal("fetch",fetchMock);
    await expect(executeGitTargetAction({
      action:"mutate",repository:repo,missionId:"mission-1",candidateId:"C1",expectedBaseSha:"old1111",
      commitMessage:"change",changes:[{path:"src/a.ts",content:"export const a=1"}],
    })).rejects.toThrow(/Base branch moved/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("creates an auditable branch commit without force update",async()=>{
    const requests:Array<{url:string;method:string;body?:unknown}>=[];
    const fetchMock=vi.fn(async(input:RequestInfo|URL,init?:RequestInit)=>{
      const url=String(input);const method=init?.method??"GET";
      let body:unknown;try{body=init?.body?JSON.parse(String(init.body)):undefined;}catch{body=undefined;}
      requests.push({url,method,body});
      if(url.endsWith("/git/ref/heads/main"))return json({object:{sha:"base123"}});
      if(url.includes("/git/ref/heads/evolve/mission-1/C1"))return new Response("missing",{status:404});
      if(url.endsWith("/git/refs")&&method==="POST")return json({ref:"refs/heads/evolve/mission-1/C1"});
      if(url.endsWith("/git/commits/base123")&&method==="GET")return json({tree:{sha:"tree-base"}});
      if(url.endsWith("/git/blobs"))return json({sha:"blob-new"});
      if(url.endsWith("/git/trees"))return json({sha:"tree-new"});
      if(url.endsWith("/git/commits")&&method==="POST")return json({sha:"commit-new"});
      if(url.includes("/git/refs/heads/evolve/mission-1/C1")&&method==="PATCH")return json({object:{sha:"commit-new"}});
      throw new Error("unexpected "+method+" "+url);
    });
    vi.stubGlobal("fetch",fetchMock);
    const result=await executeGitTargetAction({
      action:"mutate",repository:repo,missionId:"mission-1",candidateId:"C1",expectedBaseSha:"base123",
      commitMessage:"candidate C1",changes:[{path:"src/a.ts",content:"export const a=2"}],
    });
    expect(result).toMatchObject({action:"mutate",branch:"evolve/mission-1/C1",commitSha:"commit-new",treeSha:"tree-new"});
    const patch=requests.find((item)=>item.method==="PATCH");
    expect(patch?.body).toEqual({sha:"commit-new",force:false});
    expect(JSON.stringify(requests)).not.toContain("gh_test_token");
  });

  it("reuses an existing branch commit when its tree already matches the requested mutation",async()=>{
    const requests:Array<{url:string;method:string}>=[];

    const fetchMock=vi.fn(async(input:RequestInfo|URL,init?:RequestInit)=>{
      const url=String(input);const method=init?.method??"GET";requests.push({url,method});
      if(url.endsWith("/git/ref/heads/main"))return json({object:{sha:"base123"}});
      if(url.includes("/git/ref/heads/evolve/mission-1/C1"))return json({object:{sha:"commit-existing"}});
      if(url.endsWith("/git/commits/base123")&&method==="GET")return json({tree:{sha:"tree-base"}});
      if(url.endsWith("/git/blobs"))return json({sha:"blob-new"});
      if(url.endsWith("/git/trees"))return json({sha:"tree-new"});
      if(url.endsWith("/git/commits/commit-existing")&&method==="GET")return json({tree:{sha:"tree-new"}});
      throw new Error("unexpected "+method+" "+url);
    });
    vi.stubGlobal("fetch",fetchMock);
    const result=await executeGitTargetAction({
      action:"mutate",repository:repo,missionId:"mission-1",candidateId:"C1",expectedBaseSha:"base123",
      commitMessage:"candidate C1",changes:[{path:"src/a.ts",content:"export const a=2"}],
    });
    expect(result).toMatchObject({
      action:"mutate",branch:"evolve/mission-1/C1",commitSha:"commit-existing",treeSha:"tree-new",
    });
    expect(result.note).toContain("Reused existing");
    expect(requests.some((item)=>item.url.endsWith("/git/commits")&&item.method==="POST")).toBe(false);
    expect(requests.some((item)=>item.method==="PATCH")).toBe(false);
  });

  it("refuses to overwrite an existing evolution branch when its tree differs",async()=>{
    const fetchMock=vi.fn(async(input:RequestInfo|URL,init?:RequestInit)=>{
      const url=String(input);const method=init?.method??"GET";
      if(url.endsWith("/git/ref/heads/main"))return json({object:{sha:"base123"}});
      if(url.includes("/git/ref/heads/evolve/mission-1/C1"))return json({object:{sha:"commit-other"}});
      if(url.endsWith("/git/commits/base123")&&method==="GET")return json({tree:{sha:"tree-base"}});
      if(url.endsWith("/git/blobs"))return json({sha:"blob-new"});
      if(url.endsWith("/git/trees"))return json({sha:"tree-requested"});
      if(url.endsWith("/git/commits/commit-other")&&method==="GET")return json({tree:{sha:"tree-other"}});
      throw new Error("unexpected "+method+" "+url);
    });
    vi.stubGlobal("fetch",fetchMock);
    await expect(executeGitTargetAction({
      action:"mutate",repository:repo,missionId:"mission-1",candidateId:"C1",expectedBaseSha:"base123",
      commitMessage:"candidate C1",changes:[{path:"src/a.ts",content:"export const a=2"}],
    })).rejects.toThrow(/different tree/);
  });

  it("rejects path traversal before creating Git blobs",async()=>{
    const fetchMock=vi.fn();
    vi.stubGlobal("fetch",fetchMock);
    await expect(executeGitTargetAction({
      action:"mutate",repository:repo,missionId:"mission-1",candidateId:"C1",expectedBaseSha:"base123",
      commitMessage:"bad",changes:[{path:"../secret",content:"x"}],
    })).rejects.toThrow(/Unsafe Git path/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refuses merge when PR head SHA drifted",async()=>{
    const fetchMock=vi.fn(async()=>json({head:{sha:"new-head"}}));
    vi.stubGlobal("fetch",fetchMock);
    await expect(executeGitTargetAction({
      action:"merge",repository:repo,missionId:"mission-1",candidateId:"C1",pullNumber:7,
      expectedHeadSha:"reviewed-head",mergeMethod:"squash",
    })).rejects.toThrow(/PR head moved/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("rolls back by creating a new commit with the stable tree, never force-resetting history",async()=>{
    const requests:Array<{url:string;method:string;body?:unknown}>=[];
    const fetchMock=vi.fn(async(input:RequestInfo|URL,init?:RequestInit)=>{
      const url=String(input);const method=init?.method??"GET";
      let body:unknown;try{body=init?.body?JSON.parse(String(init.body)):undefined;}catch{body=undefined;}
      requests.push({url,method,body});
      if(url.endsWith("/git/ref/heads/main"))return json({object:{sha:"prod-head"}});
      if(url.endsWith("/git/commits/stable01"))return json({tree:{sha:"stable-tree"}});
      if(url.endsWith("/git/commits")&&method==="POST")return json({sha:"rollback-commit"});
      if(url.endsWith("/git/refs/heads/main")&&method==="PATCH")return json({object:{sha:"rollback-commit"}});
      throw new Error("unexpected "+method+" "+url);
    });
    vi.stubGlobal("fetch",fetchMock);
    const result=await executeGitTargetAction({
      action:"rollback",repository:repo,missionId:"mission-1",candidateId:"C1",
      expectedHeadSha:"prod-head",stableCommitSha:"stable01",message:"rollback",
    });
    expect(result).toMatchObject({action:"rollback",commitSha:"rollback-commit",treeSha:"stable-tree"});
    expect(requests.find((item)=>item.url.endsWith("/git/commits")&&item.method==="POST")?.body)
      .toEqual({message:"rollback",tree:"stable-tree",parents:["prod-head"]});
    expect(requests.find((item)=>item.method==="PATCH")?.body).toEqual({sha:"rollback-commit",force:false});
  });
});
