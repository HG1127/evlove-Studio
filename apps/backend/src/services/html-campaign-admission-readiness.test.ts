// @vitest-environment node
import {afterEach,beforeEach,describe,expect,it,vi} from "vitest";
import {assertServerHtmlCampaignAdmissionReady,resetHtmlCampaignAdmissionReadiness} from "./html-campaign-admission-readiness";

const previous=new Map<string,string|undefined>();
const keys=["SUPABASE_URL","SUPABASE_SECRET_KEY"];
beforeEach(()=>{
  for(const key of keys)previous.set(key,process.env[key]);
  process.env.SUPABASE_URL="https://schema.test";
  process.env.SUPABASE_SECRET_KEY="sb_secret_test_schema_probe_only";
  resetHtmlCampaignAdmissionReadiness();
});
afterEach(()=>{
  vi.unstubAllGlobals();
  for(const key of keys){const value=previous.get(key);if(value===undefined)delete process.env[key];else process.env[key]=value;}
});
const schema=(present:boolean)=>new Response(JSON.stringify({paths:present?{"/rpc/create_evolution_html_campaign_control":{post:{}}}:{}}),{
  status:200,headers:{"Content-Type":"application/openapi+json"},
});

describe("actual HTML admission dependency metadata",()=>{
  it("fails with the exact missing migration before any write, and allows recovery without a negative cache",async()=>{
    const fetcher=vi.fn().mockResolvedValueOnce(schema(false)).mockResolvedValueOnce(schema(true));
    vi.stubGlobal("fetch",fetcher);
    await expect(assertServerHtmlCampaignAdmissionReady()).rejects.toMatchObject({status:503,data:{
      code:"HTML_CAMPAIGN_MIGRATION_REQUIRED",migration:"20261021130000_html_campaign_start_security_invariants.sql",
    }});
    await expect(assertServerHtmlCampaignAdmissionReady()).resolves.toBeUndefined();
    expect(fetcher).toHaveBeenCalledTimes(2);
    for(const [url,init] of fetcher.mock.calls){
      expect(url).toBe("https://schema.test/rest/v1/");
      expect(init.method).toBeUndefined();
      expect(init.body).toBeUndefined();
      expect(init.headers.apikey).toBe(process.env.SUPABASE_SECRET_KEY);
      expect(init.headers.Authorization).toBeUndefined();
    }
  });
  it("caches only a verified positive result for the same endpoint and credential",async()=>{
    const fetcher=vi.fn(async()=>schema(true));vi.stubGlobal("fetch",fetcher);
    await assertServerHtmlCampaignAdmissionReady();await assertServerHtmlCampaignAdmissionReady();
    expect(fetcher).toHaveBeenCalledOnce();
    process.env.SUPABASE_URL="https://another-project.test";
    await assertServerHtmlCampaignAdmissionReady();
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it("leaves malformed metadata unverified instead of inferring that the admission function exists",async()=>{
    vi.stubGlobal("fetch",vi.fn(async()=>new Response(JSON.stringify({message:"not schema"}),{status:200})));
    await expect(assertServerHtmlCampaignAdmissionReady()).rejects.toMatchObject({status:503,data:{code:"HTML_CAMPAIGN_ADMISSION_UNVERIFIED"}});
  });
});
