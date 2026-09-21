// @vitest-environment node
import {afterEach,beforeEach,describe,expect,it,vi} from "vitest";

const directory=vi.hoisted(()=>({
  requireActiveOrganizationMember:vi.fn(),
}));
vi.mock("./organization-member-directory",()=>directory);

import {requireGovernedEvolutionPermission} from "./security-policy";

const KEYS=[
  "NODE_ENV","EVOLUTION_ALLOW_INSECURE_INTERNAL_AUTH","EVOLUTION_IDENTITY_HMAC_SECRET",
  "EVOLUTION_WORKSPACE_ID",
] as const;
const previous=new Map<string,string|undefined>();

function internalEvent(){
  return {context:{}} as never;
}

describe("governed Evolution permission",()=>{
  beforeEach(()=>{
    for(const key of KEYS){previous.set(key,process.env[key]);delete process.env[key];}
    directory.requireActiveOrganizationMember.mockReset();
    process.env.NODE_ENV="development";
    process.env.EVOLUTION_WORKSPACE_ID="workspace-test";
  });
  afterEach(()=>{
    for(const key of KEYS){
      const value=previous.get(key);
      if(value===undefined)delete process.env[key];else process.env[key]=value;
    }
  });

  it("keeps internal-dev usable without a production member directory",async()=>{
    const event=internalEvent();
    const actor=await requireGovernedEvolutionPermission(event,"mission.write");
    expect(actor).toMatchObject({id:"internal-dev",role:"admin",source:"internal-dev"});
    expect(directory.requireActiveOrganizationMember).not.toHaveBeenCalled();
  });

  it("never consults member directory for data.read",async()=>{
    const event=internalEvent();
    await requireGovernedEvolutionPermission(event,"data.read");
    expect(directory.requireActiveOrganizationMember).not.toHaveBeenCalled();
  });
});
