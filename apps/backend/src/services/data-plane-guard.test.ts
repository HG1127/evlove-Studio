// @vitest-environment node
import {afterEach,beforeEach,describe,expect,it} from "vitest";
import {requireServerDataPlaneAvailable} from "./data-plane-guard";

const KEYS=[
  "NODE_ENV","SUPABASE_URL","VITE_SUPABASE_URL",
  "SUPABASE_SECRET_KEY","SUPABASE_SERVICE_ROLE_KEY",
  "SUPABASE_PUBLISHABLE_KEY","VITE_SUPABASE_ANON_KEY",
  "SUPABASE_ARTIFACT_BUCKET","VITE_SUPABASE_ARTIFACT_BUCKET",
  "EVOLUTION_ALLOW_PUBLISHABLE_DATA_PLANE",
] as const;
const previous=new Map<string,string|undefined>();

beforeEach(()=>{
  for(const key of KEYS){
    previous.set(key,process.env[key]);
    delete process.env[key];
  }
});
afterEach(()=>{
  for(const key of KEYS){
    const value=previous.get(key);
    if(value===undefined)delete process.env[key];
    else process.env[key]=value;
  }
});

describe("Server Data Plane guard",()=>{
  it("returns an explicit 503 without exposing credentials when Production server secret is missing",()=>{
    process.env.NODE_ENV="production";
    process.env.SUPABASE_URL="https://example.supabase.co";
    process.env.SUPABASE_PUBLISHABLE_KEY="publishable-key-should-not-leak-123";

    let caught:unknown;
    try{requireServerDataPlaneAvailable();}catch(error){caught=error;}

    const error=caught as {statusCode?:number;statusMessage?:string;data?:Record<string,unknown>};
    expect(error.statusCode).toBe(503);
    expect(error.statusMessage).toContain("Server Data Plane");
    expect(error.data).toMatchObject({
      code:"SERVER_DATA_PLANE_UNAVAILABLE",
      credentialMode:"missing",
      urlPresent:true,
      secretPresent:false,
      publishablePresent:true,
    });
    expect(JSON.stringify(error.data)).not.toContain("publishable-key-should-not-leak-123");
  });

  it("allows a valid server-only Supabase configuration",()=>{
    process.env.NODE_ENV="production";
    process.env.SUPABASE_URL="https://example.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY="service-role-key-12345678901234567890";
    const diagnostics=requireServerDataPlaneAvailable();
    expect(diagnostics).toMatchObject({
      configValid:true,
      credentialMode:"secret",
      urlPresent:true,
      secretPresent:true,
    });
  });
});
