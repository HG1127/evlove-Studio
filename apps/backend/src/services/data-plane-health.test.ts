// @vitest-environment node
import {afterEach,beforeEach,describe,expect,it} from "vitest";
import {getDataPlaneHealth} from "./data-plane-health";

const keys=["NODE_ENV","SUPABASE_URL","SUPABASE_SERVICE_ROLE_KEY","SUPABASE_SECRET_KEY","SUPABASE_PUBLISHABLE_KEY"] as const;
const previous=new Map<string,string|undefined>();

beforeEach(()=>{
  for(const key of keys){previous.set(key,process.env[key]);delete process.env[key];}
});

afterEach(()=>{
  for(const key of keys){
    const value=previous.get(key);
    if(value===undefined)delete process.env[key];
    else process.env[key]=value;
  }
});

describe("data plane health",()=>{
  it("reports unavailable without server credentials",async()=>{
    process.env.NODE_ENV="production";
    process.env.SUPABASE_URL="https://example.supabase.co";
    const health=await getDataPlaneHealth();
    expect(health).toMatchObject({
      status:"unavailable",
      database:false,
      storage:false,
      config:{configured:false,secureCredential:false,credentialMode:"missing"},
    });
  });
});
