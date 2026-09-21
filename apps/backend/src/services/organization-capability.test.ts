// @vitest-environment node
import {afterEach,beforeEach,describe,expect,it,vi} from "vitest";
import type {EvolveProject,Lesson} from "@evolution/contracts";
import {
  getOrganizationCapabilityHealth,
  organizationCapabilityKey,
  searchOrganizationCapabilities,
  syncMissionCapabilities,
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

function dbRow(input:{missionId:string;lesson:Lesson;createdAt?:string;updatedAt?:string}){
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
    expect(calls[0]?.method).toBe("PATCH");
    const upsert=calls.find((call)=>call.method==="POST")?.body as Array<Record<string,unknown>>;
    expect(upsert).toHaveLength(2);
    expect((upsert[0]?.payload as Lesson).provenance?.artifactHashes).toEqual(["hash-1"]);
    expect(upsert[1]?.counter_examples).toEqual(expect.arrayContaining([expect.objectContaining({reason:"production regression"})]));
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
    vi.stubGlobal("fetch",vi.fn(async()=>new Response(JSON.stringify(rows),{status:200,headers:{"Content-Type":"application/json"}})));
    const result=await searchOrganizationCapabilities({q:"rollout guard",limit:10,reusableOnly:true});
    expect(result.vectorSearch).toBe(false);
    expect(result.hits).toHaveLength(1);
    expect(result.hits[0]?.replicationEvidence.map((item)=>item.missionId).sort()).toEqual(["mission-1","mission-2"]);
    expect(result.hits[0]?.score).toBeGreaterThan(0);
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
      {...dbRow({missionId:"mission-1",lesson:first}),embedding:[1,0],embedding_model:"text-embedding-test"},
      {...dbRow({missionId:"mission-2",lesson:second}),embedding:[0,1],embedding_model:"text-embedding-test"},
    ];
    const fetchMock=vi.fn(async(input:RequestInfo|URL,init?:RequestInit)=>{
      const url=String(input);
      if(url.startsWith("https://supabase.test/rest/v1/organization_capabilities")){
        return new Response(JSON.stringify(rows),{status:200,headers:{"Content-Type":"application/json"}});
      }
      if(url==="https://embed.test/v1/embeddings"){
        expect((init?.headers as Record<string,string>).Authorization).toBe("Bearer embed-test-key");
        return new Response(JSON.stringify({data:[{index:0,embedding:[1,0]}]}),{status:200,headers:{"Content-Type":"application/json"}});
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
        return new Response(JSON.stringify(rows),{status:200,headers:{"Content-Type":"application/json"}});
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
