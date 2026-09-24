// @vitest-environment node
import {afterEach,beforeEach,describe,expect,it,vi} from "vitest";
import {probeOutcomeSampleStore,readOutcomeSamples} from "./outcome-sample-store";

const originalEnv={...process.env};

function row(id:string,observedAt="2026-09-24T00:00:00Z"){
  return {
    id,workspace_id:"workspace-test",mission_id:"mission/test",candidate_id:"candidate/a",
    deployment_id:null,arm:"candidate",metric_key:"conversion",metric_kind:"business",
    direction:"higher",value:1,unit:null,segment:"all",source:"test",
    observed_at:observedAt,metadata:{},
  };
}

describe("Outcome sample store pagination",()=>{
  beforeEach(()=>{
    process.env.NODE_ENV="test";
    process.env.SUPABASE_URL="https://supabase.test";
    process.env.SUPABASE_SECRET_KEY="server-secret-key-for-outcome-store-test";
    process.env.EVOLUTION_WORKSPACE_ID="workspace-test";
  });
  afterEach(()=>{
    process.env={...originalEnv};
    vi.unstubAllGlobals();
  });

  it("continues after short pages imposed by a server row cap",async()=>{
    const stored=[row("a"),row("b"),row("c","2026-09-24T00:01:00Z")];
    const queries:URLSearchParams[]=[];
    vi.stubGlobal("fetch",vi.fn(async(input:RequestInfo|URL)=>{
      const query=new URL(String(input)).searchParams;
      queries.push(query);
      const offset=Number(query.get("offset"));
      return new Response(JSON.stringify(stored.slice(offset,offset+1)),{status:200});
    }));

    const samples=await readOutcomeSamples({missionId:"mission/test",candidateId:"candidate/a"});
    expect(samples.map((sample)=>sample.id)).toEqual(["a","b","c"]);
    expect(queries.map((query)=>query.get("offset"))).toEqual(["0","1","2","3"]);
    expect(queries.every((query)=>query.get("order")==="observed_at.asc,id.asc"
      &&query.get("mission_id")==="eq.mission/test"
      &&query.get("candidate_id")==="eq.candidate/a"
      &&query.get("workspace_id")==="eq.workspace-test")).toBe(true);
  });

  it("stops at the caller limit even when another page exists",async()=>{
    const stored=[row("a"),row("b"),row("c")];
    const fetchMock=vi.fn(async(input:RequestInfo|URL)=>{
      const query=new URL(String(input)).searchParams;
      const offset=Number(query.get("offset"));
      return new Response(JSON.stringify(stored.slice(offset,offset+1)),{status:200});
    });
    vi.stubGlobal("fetch",fetchMock);

    expect((await readOutcomeSamples({missionId:"mission/test",limit:2})).map((sample)=>sample.id))
      .toEqual(["a","b"]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("rejects a repeated page instead of silently double-counting a sample",async()=>{
    vi.stubGlobal("fetch",vi.fn(async()=>new Response(JSON.stringify([row("a")]),{status:200})));
    await expect(readOutcomeSamples({missionId:"mission/test"})).rejects.toThrow(/repeated an id/);
  });

  it("rejects null metric values instead of converting them to zero",async()=>{
    vi.stubGlobal("fetch",vi.fn(async()=>new Response(JSON.stringify([{...row("a"),value:null}]),{status:200})));
    await expect(readOutcomeSamples({missionId:"mission/test"})).rejects.toThrow();
  });

  it("rejects rows outside the requested workspace and malformed pages",async()=>{
    vi.stubGlobal("fetch",vi.fn(async()=>new Response(JSON.stringify([{...row("a"),workspace_id:"other"}]),{status:200})));
    await expect(readOutcomeSamples({missionId:"mission/test"})).rejects.toThrow(/requested scope/);
    vi.stubGlobal("fetch",vi.fn(async()=>new Response(JSON.stringify({id:"a"}),{status:200})));
    await expect(readOutcomeSamples({missionId:"mission/test"})).rejects.toThrow(/not an array/);
  });

  it("probes the same ordered page query without reading metric values",async()=>{
    const fetchMock=vi.fn(async(_input:RequestInfo|URL)=>new Response("[]",{status:200}));
    vi.stubGlobal("fetch",fetchMock);
    await expect(probeOutcomeSampleStore()).resolves.toBe(true);
    const url=new URL(String(fetchMock.mock.calls[0][0]));
    expect(url.searchParams.get("select")).toBe("id");
    expect(url.searchParams.get("order")).toBe("observed_at.asc,id.asc");
    expect(url.searchParams.get("limit")).toBe("1");
    expect(url.searchParams.get("offset")).toBe("0");
  });
});
