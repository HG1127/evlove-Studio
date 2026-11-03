import {afterEach,describe,expect,it,vi} from "vitest";
import {missionEnvelope} from "@evolution/contracts";
import {demoProject} from "../../../src/features/evolve/data/mock-project";
import {createHttpProductionPorts} from "./http-production-adapter";
const envelope=(id:string,revision=1)=>missionEnvelope({...demoProject,id,name:id},revision);
const index=(items:Array<{missionId:string;revision:number}>,workspaceId="workspace")=>({schemaVersion:"mission-index-v1",workspaceId,complete:true,items});
const reply=(value:unknown,status=200)=>new Response(JSON.stringify(value),{status,headers:{"Content-Type":"application/json"}});
afterEach(()=>vi.unstubAllGlobals());
describe("indexed full Mission synchronization",()=>{
  it("resumes verified receipts after failure, publishes only complete collections and reads only changed revisions",async()=>{
    let items=[{missionId:"a",revision:1},{missionId:"b",revision:2}],fail=true;
    const reads:string[]=[];
    vi.stubGlobal("fetch",vi.fn(async(input:RequestInfo|URL,init?:RequestInit)=>{
      const path=new URL(String(input),"https://studio.test").pathname;
      expect(init?.cache).toBe("no-store");
      if(path.endsWith("mission-index"))return reply(index(items));
      const id=path.split("/").pop()!;reads.push(id);
      if(id==="b"&&fail)throw new TypeError("network interrupted");
      return reply(envelope(id,items.find(item=>item.missionId===id)!.revision));
    }));
    const ports=createHttpProductionPorts("/api/evolution",{missionIndex:true});
    await expect(ports.missions.list()).rejects.toThrow("network interrupted");
    expect(reads).toEqual(["a","b"]);fail=false;
    const complete=await ports.missions.list();expect(complete.map(item=>item.id).sort()).toEqual(["a","b"]);
    expect(reads).toEqual(["a","b","b"]);
    complete[0].name="caller mutation";
    expect((await ports.missions.list()).some(item=>item.name==="caller mutation")).toBe(false);
    expect(reads).toHaveLength(3);
    items=[{missionId:"a",revision:1},{missionId:"b",revision:3}];await ports.missions.list();
    expect(reads).toEqual(["a","b","b","b"]);
  });
  it("does not publish CAS revision knowledge from a partial list",async()=>{
    let submitted:unknown;
    vi.stubGlobal("fetch",vi.fn(async(input:RequestInfo|URL,init?:RequestInit)=>{
      if(init?.method==="PUT"){submitted=JSON.parse(String(init.body));return reply(envelope("a",9));}
      if(String(input).endsWith("mission-index"))return reply(index([{missionId:"a",revision:8},{missionId:"b",revision:2}]));
      if(String(input).endsWith("/a"))return reply(envelope("a",8));throw new Error("interrupted");
    }));
    const ports=createHttpProductionPorts("/api/evolution",{missionIndex:true});
    await expect(ports.missions.list()).rejects.toThrow("interrupted");await ports.missions.save({...demoProject,id:"a"});
    expect(submitted).toMatchObject({revision:0});
  });
  it("refreshes all cached receipts when the workspace changes",async()=>{
    let workspace="first",reads=0;
    vi.stubGlobal("fetch",vi.fn(async(input:RequestInfo|URL)=>{
      if(String(input).endsWith("mission-index"))return reply(index([{missionId:"a",revision:1}],workspace));
      reads++;return reply({...envelope("a"),payload:{...envelope("a").payload,name:workspace}});
    }));
    const ports=createHttpProductionPorts("/api/evolution",{missionIndex:true});
    expect((await ports.missions.list())[0].name).toBe("first");workspace="second";
    expect((await ports.missions.list())[0].name).toBe("second");expect(reads).toBe(2);
  });
  it("reconciles additions and deletions during a read before publishing",async()=>{
    const snapshots=[index([{missionId:"a",revision:1}]),index([{missionId:"b",revision:2}]),index([{missionId:"b",revision:2}])];
    const reads:string[]=[];
    vi.stubGlobal("fetch",vi.fn(async(input:RequestInfo|URL)=>{
      if(String(input).endsWith("mission-index"))return reply(snapshots.shift());
      const id=String(input).split("/").pop()!;reads.push(id);return reply(envelope(id,id==="b"?2:1));
    }));
    const result=await createHttpProductionPorts("/api/evolution",{missionIndex:true}).missions.list();
    expect(result.map(item=>item.id)).toEqual(["b"]);expect(reads).toEqual(["a","b"]);
  });
  it("bounds continuously changing identities and never returns a prefix",async()=>{
    let revision=0;
    vi.stubGlobal("fetch",vi.fn(async(input:RequestInfo|URL)=>String(input).endsWith("mission-index")?reply(index([{missionId:String(++revision),revision:1}])):reply(envelope(String(input).split("/").pop()!))));
    await expect(createHttpProductionPorts("/api/evolution",{missionIndex:true}).missions.list()).rejects.toThrow("identities changed");
    expect(revision).toBe(3);
  });
  it.each([401,403,503])("does not fall back to legacy data after index HTTP %s",async status=>{
    const fetch=vi.fn(async()=>reply({statusMessage:"unavailable"},status));vi.stubGlobal("fetch",fetch);
    await expect(createHttpProductionPorts("/api/evolution",{missionIndex:true}).missions.list()).rejects.toThrow("HTTP "+status);expect(fetch).toHaveBeenCalledOnce();
  });
  it.each([{},index([{missionId:"a",revision:1},{missionId:"a",revision:2}]),{...index([]),complete:false}])("rejects invalid index data without a fallback",async value=>{
    const fetch=vi.fn(async()=>reply(value));vi.stubGlobal("fetch",fetch);
    await expect(createHttpProductionPorts("/api/evolution",{missionIndex:true}).missions.list()).rejects.toThrow();expect(fetch).toHaveBeenCalledOnce();
  });
  it.each(["older","wrong-identity","malformed"])("rejects %s full payloads even with a valid index",async kind=>{
    const fetch=vi.fn(async(input:RequestInfo|URL)=>String(input).endsWith("mission-index")?reply(index([{missionId:"a",revision:2}])):reply(kind==="older"?envelope("a",1):kind==="wrong-identity"?envelope("b",2):{missionId:"a",revision:2}));vi.stubGlobal("fetch",fetch);
    await expect(createHttpProductionPorts("/api/evolution",{missionIndex:true}).missions.list()).rejects.toThrow();expect(fetch).toHaveBeenCalledTimes(2);
  });
  it("uses legacy complete pages only when the initial index endpoint is absent",async()=>{
    const paths:string[]=[];
    vi.stubGlobal("fetch",vi.fn(async(input:RequestInfo|URL)=>{
      const path=String(input);paths.push(path);return path.endsWith("mission-index")?reply({},404):reply({items:[envelope("a")]});
    }));
    const ports=createHttpProductionPorts("/api/evolution",{missionIndex:true});
    expect((await ports.missions.list()).map(item=>item.id)).toEqual(["a"]);await ports.missions.list();
    expect(paths.filter(path=>path.endsWith("mission-index"))).toHaveLength(1);
  });
  it("rejects a disappearing index after confirming capability",async()=>{
    let absent=false;
    vi.stubGlobal("fetch",vi.fn(async()=>absent?reply({},404):reply(index([]))));
    const ports=createHttpProductionPorts("/api/evolution",{missionIndex:true});await ports.missions.list();absent=true;
    await expect(ports.missions.list()).rejects.toThrow("HTTP 404");
  });
  it("allows concurrent later revisions without relabelling the full receipt",async()=>{
    let indices=0,reads=0;
    vi.stubGlobal("fetch",vi.fn(async(input:RequestInfo|URL)=>{
      if(String(input).endsWith("mission-index"))return reply(index([{missionId:"a",revision:++indices>1?2:1}]));
      return reply(envelope("a",++reads));
    }));
    const ports=createHttpProductionPorts("/api/evolution",{missionIndex:true});
    expect((await ports.missions.list())[0].id).toBe("a");expect(reads).toBe(1);
    await ports.missions.list();expect(reads).toBe(2);
  });
});
