// @vitest-environment node
import {afterEach,describe,expect,it,vi} from "vitest";
import {mockEvent} from "nitro/h3";
import route from "../../server/api/evolution/parse-capabilities.get";

vi.mock("./security-policy",()=>({requireGovernedEvolutionPermission:vi.fn(async()=>undefined)}));

const previous={
  url:process.env.SUPABASE_URL,
  secret:process.env.SUPABASE_SECRET_KEY,
  legacy:process.env.SUPABASE_SERVICE_ROLE_KEY,
  publishable:process.env.SUPABASE_PUBLISHABLE_KEY,
};

afterEach(()=>{
  for(const [name,value] of Object.entries({
    SUPABASE_URL:previous.url,SUPABASE_SECRET_KEY:previous.secret,
    SUPABASE_SERVICE_ROLE_KEY:previous.legacy,SUPABASE_PUBLISHABLE_KEY:previous.publishable,
  })){
    if(value===undefined)delete process.env[name];
    else process.env[name]=value;
  }
});

describe("Source Parse capability truth",()=>{
  it("does not claim a durable server parser from a publishable key alone",async()=>{
    process.env.SUPABASE_URL="https://example.supabase.co";
    process.env.SUPABASE_PUBLISHABLE_KEY="sb_publishable_0123456789abcdefghijklmnop";
    delete process.env.SUPABASE_SECRET_KEY;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    const response=await route(mockEvent(new Request("http://localhost/api/evolution/parse-capabilities")));
    expect(response).toMatchObject({available:false,artifactStore:false,reason:"server-data-plane-not-configured"});
  });

  it("enables server Parse with a server-only credential",async()=>{
    process.env.SUPABASE_URL="https://example.supabase.co";
    process.env.SUPABASE_SECRET_KEY="sb_secret_0123456789abcdefghijklmnop";
    const response=await route(mockEvent(new Request("http://localhost/api/evolution/parse-capabilities")));
    expect(response).toMatchObject({available:true,artifactStore:true});
  });
});
