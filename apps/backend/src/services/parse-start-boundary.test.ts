// @vitest-environment node
import {afterEach,describe,expect,it,vi} from "vitest";
import {mockEvent} from "nitro/h3";
import route from "../../server/api/evolution/parse-start.post";

const {multipart}=vi.hoisted(()=>({multipart:vi.fn()}));
vi.mock("nitro/h3",async(importOriginal)=>({
  ...await importOriginal<typeof import("nitro/h3")>(),
  readMultipartFormData:multipart,
}));
vi.mock("./security-policy",()=>({requireGovernedEvolutionPermission:vi.fn(async()=>undefined)}));

const originalUrl=process.env.SUPABASE_URL;
const originalSecret=process.env.SUPABASE_SECRET_KEY;
const originalLegacy=process.env.SUPABASE_SERVICE_ROLE_KEY;

afterEach(()=>{
  multipart.mockReset();
  if(originalUrl===undefined)delete process.env.SUPABASE_URL;
  else process.env.SUPABASE_URL=originalUrl;
  if(originalSecret===undefined)delete process.env.SUPABASE_SECRET_KEY;
  else process.env.SUPABASE_SECRET_KEY=originalSecret;
  if(originalLegacy===undefined)delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  else process.env.SUPABASE_SERVICE_ROLE_KEY=originalLegacy;
});

describe("Source Parse multipart boundary",()=>{
  it("rejects an invalid Artifact role before creating a Job or uploading bytes",async()=>{
    process.env.SUPABASE_URL="https://example.supabase.co";
    process.env.SUPABASE_SECRET_KEY="server-secret-key-for-parse-boundary";
    const encoder=new TextEncoder();
    multipart.mockResolvedValue([
      {name:"file",filename:"source.txt",type:"text/plain",data:encoder.encode("source")},
      {name:"role",data:encoder.encode("wrong-role")},
      {name:"artifactId",data:encoder.encode("artifact-1")},
    ]);
    const event=mockEvent(new Request("http://localhost/api/evolution/parse-start",{
      method:"POST",body:"test",
    }));
    await expect(route(event)).rejects.toMatchObject({status:400});
  });

  it("rejects a publishable-only data plane before reading multipart bytes",async()=>{
    process.env.SUPABASE_URL="https://example.supabase.co";
    delete process.env.SUPABASE_SECRET_KEY;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    const event=mockEvent(new Request("http://localhost/api/evolution/parse-start",{
      method:"POST",body:"test",
    }));
    await expect(route(event)).rejects.toMatchObject({status:503});
    expect(multipart).not.toHaveBeenCalled();
  });
});
