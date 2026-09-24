// @vitest-environment node
import {createHash} from "node:crypto";
import {afterEach,beforeEach,describe,expect,it,vi} from "vitest";
import type {EvolveProject,Lesson} from "@evolution/contracts";
import {
  capabilityRecordReadableByActor,
  getOrganizationCapabilityHealth,
  organizationCapabilityKey,
  probeOrganizationCapabilitySearchPage,
  searchOrganizationCapabilities,
  syncMissionCapabilities,
  updateOrganizationCapabilityAccess,
} from "./organization-capability";

const KEYS=[
  "SUPABASE_URL","SUPABASE_PUBLISHABLE_KEY","VITE_SUPABASE_URL","VITE_SUPABASE_ANON_KEY","EVOLUTION_WORKSPACE_ID",
  "EVOLUTION_CAPABILITY_EMBEDDING_API_KEY","EVOLUTION_CAPABILITY_EMBEDDING_MODEL","EVOLUTION_CAPABILITY_EMBEDDING_BASE_URL",
] as const;
const previous=new Map<string,string|undefined>();

function lesson(overrides:Partial<Lesson>={}):Lesson{
  return {
    id:"lesson-1",title:"Stable rollout guard",summary:"Require exact production evidence",
    reusable:true,effect:"prevents unsafe promotion",limit:"production only",
    trigger:["release","drift"],method:["compare exact deployment"],validatedOn:["production"],
    status:"verified-skill",
    provenance:{missionId:"mission-1",candidateId:"C1",deploymentId:"dpl-1",validationRunId:"val-1",artifactSnapshotIds:["snap-1"],artifactHashes:["hash-1"],releaseEvidenceMode:"live",releaseObservedAt:"2026-09-21T00:00:00.000Z",derivedAt:"2026-09-21T00:01:00.000Z",supersedesLessonIds:[]},
    governance:{status:"active",reason:"stable",candidateId:"C1",deploymentId:"dpl-1",outcomeTrend:"stable-healthy",observedAt:"2026-09-21T00:00:00.000Z",updatedAt:"2026-09-21T00:01:00.000Z",history:[]},
    ...overrides,
  };
}

function project(lessons:Lesson[]):EvolveProject{
  return {id:"mission-1",lessons} as unknown as EvolveProject;
}

function registryRecordId(workspaceId:string,missionId:string,lessonId:string){
  return createHash("sha256").update(workspaceId+"\u0000"+missionId+"\u0000"+lessonId).digest("hex");
}

function dbRow(input:{
  missionId:string;
  lesson:Lesson;
  createdAt?:string;
  updatedAt?:string;
  visibility?:"workspace"|"private"|"restricted";
  ownerActorId?:string;
  allowedRoles?:Array<"viewer"|"operator"|"approver"|"admin"|"service">;
}){
  return {
    id:input.missionId+"-"+input.lesson.id,
    workspace_id:"workspace-test",
    capability_key:organizationCapabilityKey(input.lesson),
    source_mission_id:input.missionId,
    lesson_id:input.lesson.id,
    lesson_status:input.lesson.status,
    governance_status:input.lesson.governance?.status??null,
    reusable:input.lesson.reusable,
    title:input.lesson.title,
    summary:input.lesson.summary,
    search_text:[input.lesson.title,input.lesson.summary,...input.lesson.trigger,...input.lesson.method].join(" ").toLowerCase(),
    payload:{...input.lesson,provenance:input.lesson.provenance?{...input.lesson.provenance,missionId:input.missionId}:undefined},
    visibility:input.visibility??"workspace",
    owner_actor_id:input.ownerActorId??null,
    allowed_roles:input.allowedRoles??[],
    replication_evidence:[{
      missionId:input.missionId,lessonId:input.lesson.id,candidateId:input.lesson.provenance?.candidateId,
      governanceStatus:input.lesson.governance?.status,observedAt:input.lesson.governance?.observedAt??"2026-09-21T00:00:00.000Z",
      validatedOn:input.lesson.validatedOn,
    }],
    counter_examples:[],
    archived:false,
    created_at:input.createdAt??"2026-09-21T00:00:00.000Z",
    updated_at:input.updatedAt??"2026-09-21T00:01:00.000Z",
  };
}

function capabilityPage(input:RequestInfo|URL,rows:Array<ReturnType<typeof dbRow>>,serverCap=Number.POSITIVE_INFINITY){
  const query=new URL(String(input)).searchParams;
  const cursor=query.getAll("id").find((value)=>value.startsWith("gt."))?.slice(3);
  const limit=Number(query.get("limit")??500);
  const page=rows.filter((row)=>!cursor||row.id>cursor)
    .sort((a,b)=>a.id.localeCompare(b.id))
    .slice(0,Math.min(limit,serverCap));
  return new Response(JSON.stringify(page),{status:200,headers:{"Content-Type":"application/json"}});
}

describe("organization capability service",()=>{
  beforeEach(()=>{
    for(const key of KEYS){previous.set(key,process.env[key]);delete process.env[key];}
  });
  afterEach(()=>{
    vi.unstubAllGlobals();
    for(const key of KEYS){const value=previous.get(key);if(value===undefined)delete process.env[key];else process.env[key]=value;}
  });

  it("stays explicitly config-blocked without a workspace/data plane",async()=>{
    const fetchMock=vi.fn();
    vi.stubGlobal("fetch",fetchMock);
    const health=await getOrganizationCapabilityHealth();
    expect(health).toMatchObject({codeReady:true,configured:false,databaseReady:false,vectorSearch:false});
    const sync=await syncMissionCapabilities(project([lesson()]));
    expect(sync).toMatchObject({configured:false,synced:0});
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("archives the previous mission projection then upserts traceable learning assets",async()=>{
    process.env.SUPABASE_URL="https://supabase.test";
    process.env.SUPABASE_PUBLISHABLE_KEY="anon-test-key-1234567890";
    process.env.EVOLUTION_WORKSPACE_ID="workspace-test";
    const calls:Array<{url:string;method:string;body?:unknown}>=[];
    vi.stubGlobal("fetch",vi.fn(async(input:RequestInfo|URL,init?:RequestInit)=>{
      const body=init?.body?JSON.parse(String(init.body)):undefined;
      calls.push({url:String(input),method:init?.method??"GET",body});
      return new Response(null,{status:204});
    }));
    const anti=lesson({
      id:"lesson-bad",title:"Unsafe rollout",status:"anti-pattern",reusable:false,
      governance:{status:"revoked",reason:"production regression",updatedAt:"2026-09-21T00:02:00.000Z",history:[]},
    });
    const result=await syncMissionCapabilities(project([lesson(),anti]));
    expect(result).toMatchObject({configured:true,synced:2,workspaceId:"workspace-test"});
    expect(calls.some((call)=>call.method==="GET")).toBe(true);
    expect(calls.some((call)=>call.method==="PATCH")).toBe(true);
    const upsert=calls.find((call)=>call.method==="POST")?.body as Array<Record<string,unknown>>;
    expect(upsert).toHaveLength(2);
    expect((upsert[0]?.payload as Lesson).provenance?.artifactHashes).toEqual(["hash-1"]);
    expect(upsert[1]?.counter_examples).toEqual(expect.arrayContaining([expect.objectContaining({reason:"production regression"})]));
  });

  it("preserves an existing access policy when Mission learning is re-synced",async()=>{
    process.env.SUPABASE_URL="https://supabase.test";
    process.env.SUPABASE_PUBLISHABLE_KEY="anon-test-key-1234567890";
    process.env.EVOLUTION_WORKSPACE_ID="workspace-test";
    const item=lesson();
    const expectedId=registryRecordId("workspace-test","mission-1",item.id);
    let upsert:Array<Record<string,unknown>>=[];
    vi.stubGlobal("fetch",vi.fn(async(input:RequestInfo|URL,init?:RequestInit)=>{
      const method=init?.method??"GET";
      const url=String(input);
      if(method==="GET"&&url.includes("select=id,visibility,owner_actor_id,allowed_roles")){
        return new Response(JSON.stringify([{
          id:expectedId,
          visibility:"restricted",
          owner_actor_id:"operator-owner",
          allowed_roles:["viewer"],
        }]),{status:200,headers:{"Content-Type":"application/json"}});
      }
      if(method==="POST"){
        upsert=JSON.parse(String(init?.body)) as Array<Record<string,unknown>>;
        return new Response(null,{status:204});
      }
      return new Response(null,{status:204});
    }));
    await syncMissionCapabilities(project([item]));
    expect(upsert).toHaveLength(1);
    expect(upsert[0]).toMatchObject({
      id:expectedId,
      visibility:"restricted",
      owner_actor_id:"operator-owner",
      allowed_roles:["viewer"],
    });
  });

  it("groups cross-mission replications by deterministic capability fingerprint",async()=>{
    process.env.SUPABASE_URL="https://supabase.test";
    process.env.SUPABASE_PUBLISHABLE_KEY="anon-test-key-1234567890";
    process.env.EVOLUTION_WORKSPACE_ID="workspace-test";
    const first=lesson();
    const second=lesson({id:"lesson-2"});
    const rows=[
      dbRow({missionId:"mission-1",lesson:first,updatedAt:"2026-09-21T00:02:00.000Z"}),
      dbRow({missionId:"mission-2",lesson:second,updatedAt:"2026-09-21T00:03:00.000Z"}),
    ];
    vi.stubGlobal("fetch",vi.fn(async(input:RequestInfo|URL)=>capabilityPage(input,rows)));
    const result=await searchOrganizationCapabilities({q:"rollout guard",limit:10,reusableOnly:true});
    expect(result.vectorSearch).toBe(false);
    expect(result.hits).toHaveLength(1);
    expect(result.hits[0]?.replicationEvidence.map((item)=>item.missionId).sort()).toEqual(["mission-1","mission-2"]);
    expect(result.hits[0]?.score).toBeGreaterThan(0);
  });

  it("finds a relevant older capability across short server-capped pages",async()=>{
    process.env.SUPABASE_URL="https://supabase.test";
    process.env.SUPABASE_PUBLISHABLE_KEY="anon-test-key-1234567890";
    process.env.EVOLUTION_WORKSPACE_ID="workspace-test";
    const rows=[
      dbRow({missionId:"mission-a",lesson:lesson({id:"a",title:"Parser note"})}),
      dbRow({missionId:"mission-b",lesson:lesson({id:"b",title:"Cost note"})}),
      dbRow({missionId:"mission-c",lesson:lesson({id:"c",title:"Unique mitigation"})}),
    ];
    const fetchMock=vi.fn(async(input:RequestInfo|URL)=>capabilityPage(input,rows,1));
    vi.stubGlobal("fetch",fetchMock);
    const result=await searchOrganizationCapabilities({q:"unique mitigation",limit:10,reusableOnly:false});
    expect(result.totalRows).toBe(3);
    expect(result.hits[0]?.representative.lesson.id).toBe("c");
    expect(fetchMock.mock.calls.map(([input])=>new URL(String(input)).searchParams.getAll("id")))
      .toEqual([[],["gt.mission-a-a"],["gt.mission-b-b"],["gt.mission-c-c"]]);
  });

  it("rejects a replayed search page instead of silently ranking a partial registry",async()=>{
    process.env.SUPABASE_URL="https://supabase.test";
    process.env.SUPABASE_PUBLISHABLE_KEY="anon-test-key-1234567890";
    process.env.EVOLUTION_WORKSPACE_ID="workspace-test";
    const row=dbRow({missionId:"mission-a",lesson:lesson({id:"a"})});
    vi.stubGlobal("fetch",vi.fn(async()=>new Response(JSON.stringify([row]),{status:200})));
    await expect(searchOrganizationCapabilities({q:"rollout",limit:10,reusableOnly:false}))
      .rejects.toThrow(/repeated or regressed an id/);
  });

  it("probes the bounded Capability Registry cursor and combined id filters read-only",async()=>{
    process.env.SUPABASE_URL="https://supabase.test";
    process.env.SUPABASE_PUBLISHABLE_KEY="anon-test-key-1234567890";
    process.env.EVOLUTION_WORKSPACE_ID="workspace-test";
    const fetchMock=vi.fn(async(input:RequestInfo|URL)=>{
      expect(String(input)).toContain("/organization_capabilities?");
      return new Response("[]",{status:200});
    });
    vi.stubGlobal("fetch",fetchMock);
    await expect(probeOrganizationCapabilitySearchPage()).resolves.toBe(true);
    const query=new URL(String(fetchMock.mock.calls[0][0])).searchParams;
    expect(query.get("select")).toBe("id");
    expect(query.get("workspace_id")).toBe("eq.workspace-test");
    expect(query.getAll("id")).toEqual([
      "in.(health-probe-no-such-capability)","gt.health-probe-no-such-capability",
    ]);
    expect(query.get("order")).toBe("id.asc");
    expect(query.get("limit")).toBe("1");
  });

  it("enforces workspace/private/restricted access semantics deterministically",()=>{
    expect(capabilityRecordReadableByActor(
      {visibility:"workspace",allowedRoles:[]},
      {id:"viewer-1",role:"viewer"},
    )).toBe(true);
    expect(capabilityRecordReadableByActor(
      {visibility:"private",ownerActorId:"operator-1",allowedRoles:[]},
      {id:"operator-1",role:"operator"},
    )).toBe(true);
    expect(capabilityRecordReadableByActor(
      {visibility:"private",ownerActorId:"operator-1",allowedRoles:[]},
      {id:"viewer-1",role:"viewer"},
    )).toBe(false);
    expect(capabilityRecordReadableByActor(
      {visibility:"restricted",ownerActorId:"operator-1",allowedRoles:["viewer"]},
      {id:"viewer-1",role:"viewer"},
    )).toBe(true);
    expect(capabilityRecordReadableByActor(
      {visibility:"restricted",ownerActorId:"operator-1",allowedRoles:["viewer"]},
      {id:"approver-1",role:"approver"},
    )).toBe(false);
    expect(capabilityRecordReadableByActor(
      {visibility:"private",ownerActorId:"operator-1",allowedRoles:[]},
      {id:"admin-1",role:"admin"},
    )).toBe(true);
  });

  it("applies actor visibility again after lexical retrieval so hidden records cannot leak",async()=>{
    process.env.SUPABASE_URL="https://supabase.test";
    process.env.SUPABASE_PUBLISHABLE_KEY="anon-test-key-1234567890";
    process.env.EVOLUTION_WORKSPACE_ID="workspace-test";
    const shared=lesson({id:"lesson-shared",title:"Shared rollout guard"});
    const privateLesson=lesson({id:"lesson-private",title:"Private rollout guard"});
    const restricted=lesson({id:"lesson-restricted",title:"Restricted rollout guard"});
    const rows=[
      dbRow({missionId:"mission-1",lesson:shared,visibility:"workspace"}),
      dbRow({missionId:"mission-2",lesson:privateLesson,visibility:"private",ownerActorId:"operator-owner"}),
      dbRow({missionId:"mission-3",lesson:restricted,visibility:"restricted",ownerActorId:"operator-owner",allowedRoles:["operator"]}),
    ];
    vi.stubGlobal("fetch",vi.fn(async(input:RequestInfo|URL)=>{
      const url=String(input);
      expect(url).toContain("organization_capabilities?select=*");
      return capabilityPage(input,rows);
    }));
    const viewer=await searchOrganizationCapabilities(
      {q:"rollout guard",limit:10,reusableOnly:false},
      {id:"viewer-1",role:"viewer"},
    );
    expect(viewer.hits.map((hit)=>hit.representative.lesson.id)).toEqual(["lesson-shared"]);
    const operator=await searchOrganizationCapabilities(
      {q:"rollout guard",limit:10,reusableOnly:false},
      {id:"operator-2",role:"operator"},
    );
    expect(operator.hits.map((hit)=>hit.representative.lesson.id).sort()).toEqual(["lesson-restricted","lesson-shared"]);
  });

  it("prevents non-owners from changing an existing capability access policy",async()=>{
    process.env.SUPABASE_URL="https://supabase.test";
    process.env.SUPABASE_PUBLISHABLE_KEY="anon-test-key-1234567890";
    process.env.EVOLUTION_WORKSPACE_ID="workspace-test";
    const row=dbRow({
      missionId:"mission-1",
      lesson:lesson(),
      visibility:"private",
      ownerActorId:"operator-owner",
    });
    const fetchMock=vi.fn(async(_input:RequestInfo|URL,init?:RequestInit)=>{
      expect(init?.method??"GET").toBe("GET");
      return new Response(JSON.stringify([row]),{status:200,headers:{"Content-Type":"application/json"}});
    });
    vi.stubGlobal("fetch",fetchMock);
    await expect(updateOrganizationCapabilityAccess(
      {id:row.id,visibility:"workspace",allowedRoles:[]},
      {id:"operator-other",role:"operator"},
    )).rejects.toThrow(/only be changed/i);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("lets the first writer claim ownership and share a capability with selected roles",async()=>{
    process.env.SUPABASE_URL="https://supabase.test";
    process.env.SUPABASE_PUBLISHABLE_KEY="anon-test-key-1234567890";
    process.env.EVOLUTION_WORKSPACE_ID="workspace-test";
    const initial=dbRow({missionId:"mission-1",lesson:lesson(),visibility:"workspace"});
    const fetchMock=vi.fn(async(_input:RequestInfo|URL,init?:RequestInit)=>{
      if((init?.method??"GET")==="GET"){
        return new Response(JSON.stringify([initial]),{status:200,headers:{"Content-Type":"application/json"}});
      }
      expect(init?.method).toBe("PATCH");
      const body=JSON.parse(String(init?.body)) as Record<string,unknown>;
      expect(body).toMatchObject({
        visibility:"restricted",
        owner_actor_id:"operator-owner",
        allowed_roles:["viewer","operator"],
      });
      return new Response(JSON.stringify([{
        ...initial,
        visibility:body.visibility,
        owner_actor_id:body.owner_actor_id,
        allowed_roles:body.allowed_roles,
        updated_at:body.updated_at,
      }]),{status:200,headers:{"Content-Type":"application/json"}});
    });
    vi.stubGlobal("fetch",fetchMock);
    const result=await updateOrganizationCapabilityAccess(
      {id:initial.id,visibility:"restricted",allowedRoles:["viewer","operator","viewer"]},
      {id:"operator-owner",role:"operator"},
    );
    expect(result.record).toMatchObject({
      visibility:"restricted",
      ownerActorId:"operator-owner",
      allowedRoles:["viewer","operator"],
    });
  });

  it("uses real server embeddings for hybrid ranking when configured",async()=>{
    process.env.SUPABASE_URL="https://supabase.test";
    process.env.SUPABASE_PUBLISHABLE_KEY="anon-test-key-1234567890";
    process.env.EVOLUTION_WORKSPACE_ID="workspace-test";
    process.env.EVOLUTION_CAPABILITY_EMBEDDING_API_KEY="embed-test-key";
    process.env.EVOLUTION_CAPABILITY_EMBEDDING_MODEL="text-embedding-test";
    process.env.EVOLUTION_CAPABILITY_EMBEDDING_BASE_URL="https://embed.test/v1";
    const first=lesson({id:"lesson-a",title:"Stable rollout guard"});
    const second=lesson({id:"lesson-b",title:"Unrelated parser note",trigger:["parser"],method:["parse"]});
    const rows=[
      {...dbRow({missionId:"mission-1",lesson:first}),embedding_model:"text-embedding-test"},
      {...dbRow({missionId:"mission-2",lesson:second}),embedding_model:"text-embedding-test"},
    ];
    const vector=Array.from({length:1536},(_,index)=>index===0?1:0);
    const fetchMock=vi.fn(async(input:RequestInfo|URL,init?:RequestInit)=>{
      const url=String(input);
      if(url==="https://embed.test/v1/embeddings"){
        expect((init?.headers as Record<string,string>).Authorization).toBe("Bearer embed-test-key");
        return new Response(JSON.stringify({data:[{index:0,embedding:vector}]}),{status:200,headers:{"Content-Type":"application/json"}});
      }
      if(url==="https://supabase.test/rest/v1/rpc/match_organization_capabilities"){
        const body=JSON.parse(String(init?.body)) as Record<string,unknown>;
        expect(String(body.p_query_embedding)).toMatch(/^\[1,0,0,/);
        expect(body.p_match_count).toBe(100);
        return new Response(JSON.stringify([
          {id:"mission-1-lesson-a",semantic_score:1},
          {id:"mission-2-lesson-b",semantic_score:0.1},
        ]),{status:200,headers:{"Content-Type":"application/json"}});
      }
      if(url.startsWith("https://supabase.test/rest/v1/organization_capabilities?select=*")&&url.includes("id=in.")){
        return capabilityPage(input,rows,1);
      }
      throw new Error("unexpected URL "+url);
    });
    vi.stubGlobal("fetch",fetchMock);
    const result=await searchOrganizationCapabilities({q:"safe deployment",limit:10,reusableOnly:false});
    expect(result.matchingMode).toBe("hybrid-vector");
    expect(result.vectorSearch).toBe(true);
    expect(result.hits[0]?.representative.lesson.id).toBe("lesson-a");
    expect(result.hits[0]?.semanticScore).toBeCloseTo(1);
  });

  it("falls back to lexical when embedding dimensions cannot use the pgvector index",async()=>{
    process.env.SUPABASE_URL="https://supabase.test";
    process.env.SUPABASE_PUBLISHABLE_KEY="anon-test-key-1234567890";
    process.env.EVOLUTION_WORKSPACE_ID="workspace-test";
    process.env.EVOLUTION_CAPABILITY_EMBEDDING_API_KEY="embed-test-key";
    process.env.EVOLUTION_CAPABILITY_EMBEDDING_MODEL="text-embedding-test";
    process.env.EVOLUTION_CAPABILITY_EMBEDDING_BASE_URL="https://embed.test/v1";
    const rows=[dbRow({missionId:"mission-1",lesson:lesson()})];
    const fetchMock=vi.fn(async(input:RequestInfo|URL)=>{
      const url=String(input);
      if(url==="https://embed.test/v1/embeddings"){
        return new Response(JSON.stringify({data:[{index:0,embedding:[1,0]}]}),{status:200,headers:{"Content-Type":"application/json"}});
      }
      if(url.startsWith("https://supabase.test/rest/v1/organization_capabilities?select=*")){
        return capabilityPage(input,rows);
      }
      throw new Error("unexpected "+url);
    });
    vi.stubGlobal("fetch",fetchMock);
    const result=await searchOrganizationCapabilities({q:"rollout guard",limit:10,reusableOnly:false});
    expect(result.vectorSearch).toBe(false);
    expect(result.matchingMode).toBe("lexical-fuzzy");
    expect(fetchMock.mock.calls.some(([input])=>String(input).includes("/rpc/match_organization_capabilities"))).toBe(false);
  });

  it("falls back to lexical ranking when the configured embedding provider fails",async()=>{
    process.env.SUPABASE_URL="https://supabase.test";
    process.env.SUPABASE_PUBLISHABLE_KEY="anon-test-key-1234567890";
    process.env.EVOLUTION_WORKSPACE_ID="workspace-test";
    process.env.EVOLUTION_CAPABILITY_EMBEDDING_API_KEY="embed-test-key";
    process.env.EVOLUTION_CAPABILITY_EMBEDDING_MODEL="text-embedding-test";
    process.env.EVOLUTION_CAPABILITY_EMBEDDING_BASE_URL="https://embed.test/v1";
    const rows=[dbRow({missionId:"mission-1",lesson:lesson()})];
    vi.stubGlobal("fetch",vi.fn(async(input:RequestInfo|URL)=>{
      const url=String(input);
      if(url.startsWith("https://supabase.test/rest/v1/organization_capabilities")){
        return capabilityPage(input,rows);
      }
      if(url==="https://embed.test/v1/embeddings")return new Response("down",{status:503});
      throw new Error("unexpected "+url);
    }));
    const result=await searchOrganizationCapabilities({q:"rollout guard",limit:10,reusableOnly:false});
    expect(result.matchingMode).toBe("lexical-fuzzy");
    expect(result.vectorSearch).toBe(false);
    expect(result.hits).toHaveLength(1);
  });
});
