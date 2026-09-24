import {describe,expect,it} from "vitest";
import {supabaseRestAuthHeaders} from "./supabase-rest-auth";

describe("Supabase REST auth headers",()=>{
  it("sends new secret and publishable keys only in apikey",()=>{
    for(const key of ["sb_secret_full-test-key", "sb_publishable_full-test-key"]){
      expect(supabaseRestAuthHeaders(key)).toEqual({apikey:key});
    }
  });

  it("preserves bearer auth for legacy JWT API keys",()=>{
    const key="eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIn0.signature";
    expect(supabaseRestAuthHeaders(key)).toEqual({apikey:key,Authorization:`Bearer ${key}`});
  });
});
