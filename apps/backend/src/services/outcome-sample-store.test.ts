// @vitest-environment node
import {afterEach,beforeEach,describe,expect,it,vi} from "vitest";
import type {OutcomeMetricBatchRequest} from "@evolution/contracts";
import {insertOutcomeSamples,OutcomeSampleIdConflictError,probeOutcomeSampleStore,readOutcomeSamples} from "./outcome-sample-store";

const originalEnv={...process.env};

function row(id:string,observedAt="2026-09-24T00:00:00Z"){
  return {
    id,workspace_id:"workspace-test",mission_id:"mission/test",candidate_id:"candidate/a",
    deployment_id:null,arm:"candidate",metric_key:"conversion",metric_kind:"business",
    direction:"higher",value:1,unit:null,segment:"all",source:"test",
    observed_at:observedAt,metadata:{},
  };
}

function pageAfter(query:URLSearchParams,stored:ReturnType<typeof row>[]){
  const filter=query.get("or");
  if(!filter)return stored.slice(0,1);
  const cursor=/^\(observed_at\.gt\."([^"]+)",and\(observed_at\.eq\."[^"]+",id\.gt\."([^"]+)"\)\)$/.exec(filter);
  if(!cursor)throw new Error("Unexpected Outcome cursor filter: "+filter);
  return stored.filter((sample)=>sample.observed_at>cursor[1]
    ||sample.observed_at===cursor[1]&&sample.id>cursor[2]).slice(0,1);
}

describe("Outcome sample store",()=>{
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

  function sampleBatch(id="sample-1"):OutcomeMetricBatchRequest{
    return {missionId:"mission/test",candidateId:"candidate/a",samples:[{
      id,candidateId:"candidate/a",arm:"candidate" as const,metricKey:"conversion",
      metricKind:"business" as const,direction:"higher" as const,value:1,segment:"all",
      source:"test",observedAt:"2026-09-24T00:00:00Z",metadata:{},
    }]};
  }

  it.each(["legacy","independent-task"])("uses a stable generated ID for an omitted-ID %s replay and detects changed content",async(kind)=>{
    const stored=new Map<string,ReturnType<typeof row>>();
    const fetchMock=vi.fn(async(input:RequestInfo|URL,init?:RequestInit)=>{
      if(init?.method==="POST"){
        const posted=JSON.parse(String(init.body)) as ReturnType<typeof row>[];
        const inserted=posted.filter((sample)=>!stored.has(sample.id));
        for(const sample of inserted)stored.set(sample.id,sample);
        return new Response(JSON.stringify(inserted),{status:201});
      }
      const filter=new URL(String(input)).searchParams.get("id")??"";
      const match=/^in\.\("([^"]+)"\)$/.exec(filter);
      if(!match)throw new Error("Unexpected Outcome ID filter: "+filter);
      return new Response(JSON.stringify([stored.get(match[1]!)].filter(Boolean)),{status:200});
    });
    vi.stubGlobal("fetch",fetchMock);
    const batch=sampleBatch();
    if(kind==="independent-task")batch.samples[0]!.observation={schemaVersion:"outcome-observation-v1",kind:"independent-task",taskId:"actual-task-id"};
    delete batch.samples[0]!.id;
    expect((await insertOutcomeSamples(batch)).inserted).toBe(1);
    batch.samples[0]!.observedAt="2026-09-24T00:00:00.000+00:00";
    expect((await insertOutcomeSamples(batch)).inserted).toBe(0);
    expect(stored.size).toBe(1);
    if(kind==="independent-task"){
      expect([...stored.values()][0]!.metadata).toHaveProperty("__evolutionOutcomeObservation",batch.samples[0]!.observation);
      batch.samples[0]!.observedAt="2026-09-24T01:00:00Z";
      await expect(insertOutcomeSamples(batch)).rejects.toBeInstanceOf(OutcomeSampleIdConflictError);
      expect(stored.size).toBe(1);
    }
    batch.samples[0]!.value=2;
    await expect(insertOutcomeSamples(batch)).rejects.toBeInstanceOf(OutcomeSampleIdConflictError);
  });
  it("round-trips the versioned task identity through existing JSON metadata",async()=>{
    const stored={...row("task-row"),metadata:{note:"synthetic",__evolutionOutcomeObservation:{schemaVersion:"outcome-observation-v1",kind:"independent-task",taskId:"task-1"}}};
    let page=0;vi.stubGlobal("fetch",vi.fn(async()=>new Response(JSON.stringify(page++===0?[stored]:[]))));
    const result=await readOutcomeSamples({missionId:"mission/test",candidateId:"candidate/a",limit:10,requireComplete:true});
    expect(result).toHaveLength(1);expect(result[0]).toMatchObject({observation:stored.metadata.__evolutionOutcomeObservation,metadata:{note:"synthetic"}});
    expect(result[0]!.metadata).not.toHaveProperty("__evolutionOutcomeObservation");
  });
  it("does not reinterpret arbitrary caller metadata as a task identity",async()=>{
    const batch=sampleBatch();batch.samples[0]!.metadata.__evolutionOutcomeObservation={schemaVersion:"outcome-observation-v1",kind:"independent-task",taskId:"claimed-task"};
    const fetchMock=vi.fn();vi.stubGlobal("fetch",fetchMock);
    await expect(insertOutcomeSamples(batch)).rejects.toThrow("reserved");expect(fetchMock).not.toHaveBeenCalled();
  });
  it("rejects two omitted-ID samples with the same observation identity before writing",async()=>{
    const fetchMock=vi.fn();
    vi.stubGlobal("fetch",fetchMock);
    const batch=sampleBatch();
    delete batch.samples[0]!.id;
    batch.samples.push({...batch.samples[0]!,value:2});
    await expect(insertOutcomeSamples(batch)).rejects.toBeInstanceOf(OutcomeSampleIdConflictError);
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("confirms a new insert from the returned canonical row",async()=>{
    const fetchMock=vi.fn(async()=>new Response(JSON.stringify([row("sample-1")]),{status:201}));
    vi.stubGlobal("fetch",fetchMock);
    const result=await insertOutcomeSamples(sampleBatch());
    expect(result.inserted).toBe(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it("accepts an exact same-ID retry only after reading the stored sample",async()=>{
    const fetchMock=vi.fn(async(_input:RequestInfo|URL,init?:RequestInit)=>new Response(JSON.stringify(
      init?.method==="POST"?[]:[row("sample-1")],
    ),{status:200}));
    vi.stubGlobal("fetch",fetchMock);
    const result=await insertOutcomeSamples(sampleBatch());
    expect(result.inserted).toBe(0);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(new URL(String(fetchMock.mock.calls[1][0])).searchParams.get("id"))
      .toBe('in.("sample-1")');
  });

  it("finishes duplicate readback through a short server-capped page",async()=>{
    const fetchMock=vi.fn(async(input:RequestInfo|URL,init?:RequestInit)=>{
      if(init?.method==="POST")return new Response("[]",{status:200});
      const offset=Number(new URL(String(input)).searchParams.get("offset"));
      return new Response(JSON.stringify([row(offset===0?"sample-1":"sample-2")]),{status:200});
    });
    vi.stubGlobal("fetch",fetchMock);
    const batch=sampleBatch();
    batch.samples.push({...batch.samples[0]!,id:"sample-2"});
    const result=await insertOutcomeSamples(batch);
    expect(result.inserted).toBe(0);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
  it("rejects a changed same-ID retry rather than claiming accepted evidence",async()=>{
    vi.stubGlobal("fetch",vi.fn(async(_input:RequestInfo|URL,init?:RequestInit)=>new Response(JSON.stringify(
      init?.method==="POST"?[]:[{...row("sample-1"),value:2}],
    ),{status:200})));
    await expect(insertOutcomeSamples(sampleBatch())).rejects.toBeInstanceOf(OutcomeSampleIdConflictError);
  });

  it("rejects duplicate IDs inside a batch before writing any sample",async()=>{
    const fetchMock=vi.fn();
    vi.stubGlobal("fetch",fetchMock);
    const batch=sampleBatch();
    batch.samples.push({...batch.samples[0]!});
    await expect(insertOutcomeSamples(batch)).rejects.toBeInstanceOf(OutcomeSampleIdConflictError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("requires readback after an ignored duplicate write",async()=>{
    vi.stubGlobal("fetch",vi.fn(async()=>new Response("[]",{status:200})));
    await expect(insertOutcomeSamples(sampleBatch())).rejects.toThrow(/readback is incomplete/);
  });

  it("continues after short pages imposed by a server row cap",async()=>{
    const stored=[row("a"),row("b"),row("c","2026-09-24T00:01:00Z")];
    const queries:URLSearchParams[]=[];
    vi.stubGlobal("fetch",vi.fn(async(input:RequestInfo|URL)=>{
      const query=new URL(String(input)).searchParams;
      queries.push(query);
      return new Response(JSON.stringify(pageAfter(query,stored)),{status:200});
    }));

    const samples=await readOutcomeSamples({missionId:"mission/test",candidateId:"candidate/a"});
    expect(samples.map((sample)=>sample.id)).toEqual(["a","b","c"]);
    expect(queries.map((query)=>query.get("or"))).toEqual([
      null,
      '(observed_at.gt."2026-09-24T00:00:00Z",and(observed_at.eq."2026-09-24T00:00:00Z",id.gt."a"))',
      '(observed_at.gt."2026-09-24T00:00:00Z",and(observed_at.eq."2026-09-24T00:00:00Z",id.gt."b"))',
      '(observed_at.gt."2026-09-24T00:01:00Z",and(observed_at.eq."2026-09-24T00:01:00Z",id.gt."c"))',
    ]);
    expect(queries.every((query)=>query.get("order")==="observed_at.asc,id.asc"
      &&query.get("mission_id")==="eq.mission/test"
      &&query.get("candidate_id")==="eq.candidate/a"
      &&query.get("workspace_id")==="eq.workspace-test")).toBe(true);
  });

  it("stops at the caller limit even when another page exists",async()=>{
    const stored=[row("a"),row("b"),row("c")];
    const fetchMock=vi.fn(async(input:RequestInfo|URL)=>{
      const query=new URL(String(input)).searchParams;
      return new Response(JSON.stringify(pageAfter(query,stored)),{status:200});
    });
    vi.stubGlobal("fetch",fetchMock);

    expect((await readOutcomeSamples({missionId:"mission/test",limit:2})).map((sample)=>sample.id))
      .toEqual(["a","b"]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("refuses an incomplete analysis at its sample ceiling",async()=>{
    const stored=[row("a"),row("b"),row("c")];
    const fetchMock=vi.fn(async(input:RequestInfo|URL)=>{
      const query=new URL(String(input)).searchParams;
      const result=pageAfter(query,stored);
      return new Response(JSON.stringify(query.get("select")==="id"
        ?result.map(({id})=>({id})):result),{status:200});
    });
    vi.stubGlobal("fetch",fetchMock);
    await expect(readOutcomeSamples({missionId:"mission/test",limit:2,requireComplete:true}))
      .rejects.toThrow(/complete evidence is required/);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(new URL(String(fetchMock.mock.calls[2][0])).searchParams.get("select")).toBe("id");
  });

  it("accepts an exact sample ceiling after an empty overflow probe",async()=>{
    const stored=[row("a"),row("b")];
    vi.stubGlobal("fetch",vi.fn(async(input:RequestInfo|URL)=>{
      const query=new URL(String(input)).searchParams;
      return new Response(JSON.stringify(pageAfter(query,stored)),{status:200});
    }));
    expect((await readOutcomeSamples({missionId:"mission/test",limit:2,requireComplete:true}))
      .map((sample)=>sample.id)).toEqual(["a","b"]);
  });

  it("rejects a repeated page instead of silently double-counting a sample",async()=>{
    vi.stubGlobal("fetch",vi.fn(async()=>new Response(JSON.stringify([row("a")]),{status:200})));
    await expect(readOutcomeSamples({missionId:"mission/test"})).rejects.toThrow(/repeated an id/);
  });

  it("does not shift the cursor when an earlier sample is inserted between pages",async()=>{
    const stored=[row("a"),row("b")];
    const fetchMock=vi.fn(async(input:RequestInfo|URL)=>{
      const query=new URL(String(input)).searchParams;
      const result=pageAfter(query,stored);
      if(fetchMock.mock.calls.length===1)stored.unshift(row("zero","2026-09-23T23:00:00Z"));
      return new Response(JSON.stringify(result),{status:200});
    });
    vi.stubGlobal("fetch",fetchMock);
    expect((await readOutcomeSamples({missionId:"mission/test"})).map((sample)=>sample.id))
      .toEqual(["a","b"]);
  });

  it("quotes punctuation in a cursor ID for PostgREST logical filters",async()=>{
    const unusualId='a,(b)"\\';
    const fetchMock=vi.fn(async(input:RequestInfo|URL)=>{
      if(fetchMock.mock.calls.length===2){
        expect(new URL(String(input)).searchParams.get("or"))
          .toContain('id.gt."a,(b)\\"\\\\"');
      }
      return new Response(JSON.stringify(fetchMock.mock.calls.length===1?[row(unusualId)]:[]),{status:200});
    });
    vi.stubGlobal("fetch",fetchMock);
    await readOutcomeSamples({missionId:"mission/test"});
    expect(fetchMock).toHaveBeenCalledTimes(2);
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
    const fetchMock=vi.fn(async(input:RequestInfo|URL)=>{
      expect(String(input)).toContain("/outcome_metric_samples?");
      return new Response("[]",{status:200});
    });
    vi.stubGlobal("fetch",fetchMock);
    await expect(probeOutcomeSampleStore()).resolves.toBe(true);
    const url=new URL(String(fetchMock.mock.calls[0][0]));
    expect(url.searchParams.get("select")).toBe("id");
    expect(url.searchParams.get("order")).toBe("observed_at.asc,id.asc");
    expect(url.searchParams.get("limit")).toBe("1");
    expect(url.searchParams.get("workspace_id")).toBe("eq.health-probe");
    expect(url.searchParams.get("mission_id")).toBe("eq.health-probe");
    expect(url.searchParams.get("or")).toContain('id.gt."health-probe"');
  });
});
