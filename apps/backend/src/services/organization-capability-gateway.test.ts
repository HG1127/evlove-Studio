// @vitest-environment node
import {afterEach,beforeEach,describe,expect,it,vi} from "vitest";
import type {Lesson} from "@evolution/contracts";

const embedManyMock=vi.fn();
const embeddingModelMock=vi.fn((model:string)=>({modelId:model}));
vi.mock("ai",()=>({
  embedMany:embedManyMock,
  gateway:{embeddingModel:embeddingModelMock},
}));

import {organizationCapabilityKey,searchOrganizationCapabilities} from "./organization-capability";

const KEYS=[
  "SUPABASE_URL","SUPABASE_PUBLISHABLE_KEY","EVOLUTION_WORKSPACE_ID",
  "VERCEL_ENV","EVOLUTION_AI_GATEWAY_ENABLED","EVOLUTION_CAPABILITY_EMBEDDING_MODEL",
] as const;
const previous=new Map<string,string|undefined>();

function lesson():Lesson{
  return {
    id:"lesson-a",title:"Stable rollout guard",summary:"Require exact production evidence",
    reusable:true,effect:"prevents unsafe promotion",limit:"production only",
    trigger:["release"],method:["compare exact deployment"],validatedOn:["production"],status:"verified-skill",
  };
}

describe("organization capability Vercel Gateway embeddings",()=>{
  beforeEach(()=>{
    for(const key of KEYS){previous.set(key,process.env[key]);delete process.env[key];}
    process.env.SUPABASE_URL="https://supabase.test";
    process.env.SUPABASE_PUBLISHABLE_KEY="anon-test-key-1234567890";
    process.env.EVOLUTION_WORKSPACE_ID="workspace-test";
    process.env.VERCEL_ENV="production";
    process.env.EVOLUTION_AI_GATEWAY_ENABLED="true";
    embedManyMock.mockReset();
    embeddingModelMock.mockClear();
  });
  afterEach(()=>{
    vi.unstubAllGlobals();
    for(const key of KEYS){
      const value=previous.get(key);
      if(value===undefined)delete process.env[key];else process.env[key]=value;
    }
  });

  it("embeds query through Vercel AI Gateway OIDC and uses pgvector RPC",async()=>{
    const vector=Array.from({length:1536},(_,index)=>index===0?1:0);
    embedManyMock.mockResolvedValue({embeddings:[vector]});
    const item=lesson();
    const row={
      id:"mission-1-lesson-a",
      workspace_id:"workspace-test",
      capability_key:organizationCapabilityKey(item),
      source_mission_id:"mission-1",
      lesson_id:item.id,
      lesson_status:item.status,
      governance_status:null,
      reusable:true,
      title:item.title,
      summary:item.summary,
      search_text:"stable rollout guard",
      payload:item,
      replication_evidence:[],
      counter_examples:[],
      archived:false,
      created_at:"2026-09-21T00:00:00.000Z",
      updated_at:"2026-09-21T00:00:00.000Z",
    };
    vi.stubGlobal("fetch",vi.fn(async(input:RequestInfo|URL,init?:RequestInit)=>{
      const url=String(input);
      if(url==="https://supabase.test/rest/v1/rpc/match_organization_capabilities"){
        const body=JSON.parse(String(init?.body)) as Record<string,unknown>;
        expect(String(body.p_query_embedding)).toMatch(/^\[1,0,0,/);
        return new Response(JSON.stringify([{id:row.id,semantic_score:0.99}]),{status:200,headers:{"Content-Type":"application/json"}});
      }
      if(url.startsWith("https://supabase.test/rest/v1/organization_capabilities?select=*")&&url.includes("id=in.")){
        const cursor=new URL(url).searchParams.getAll("id").find((value)=>value.startsWith("gt."))?.slice(3);
        return new Response(JSON.stringify(!cursor||row.id>cursor?[row]:[]),{
          status:200,headers:{"Content-Type":"application/json"},
        });
      }
      throw new Error("unexpected "+url);
    }));
    const result=await searchOrganizationCapabilities({q:"safe rollout",limit:10,reusableOnly:false});
    expect(embeddingModelMock).toHaveBeenCalledWith("openai/text-embedding-3-small");
    expect(embedManyMock).toHaveBeenCalledWith(expect.objectContaining({
      model:{modelId:"openai/text-embedding-3-small"},
      values:["safe rollout"],
      maxRetries:2,
    }));
    expect(result).toMatchObject({matchingMode:"hybrid-vector",vectorSearch:true});
    expect(result.hits[0]?.semanticScore).toBeCloseTo(0.99);
  });
});
