// @vitest-environment node
import {createHash,createHmac} from "node:crypto";
import {afterEach,beforeEach,describe,expect,it,vi} from "vitest";

const vault=vi.hoisted(()=>({
  resolveVaultSecret:vi.fn(),
}));
vi.mock("./server-vault",()=>vault);

import {
  appendEvidenceLedger,
  evidenceContentHash,
  getEvidenceLedgerHealth,
  verifyEvidenceLedger,
} from "./evidence-ledger";

const KEYS=[
  "SUPABASE_URL","SUPABASE_PUBLISHABLE_KEY","EVOLUTION_WORKSPACE_ID",
  "EVOLUTION_EVIDENCE_SIGNING_KEY","EVOLUTION_EVIDENCE_SIGNING_KEY_ID",
  "EVOLUTION_EVIDENCE_VERIFY_KEYS_JSON","EVOLUTION_EVIDENCE_SIGNING_VAULT_ID",
  "EVOLUTION_EVIDENCE_VERIFY_VAULT_IDS_JSON",
] as const;
const previous=new Map<string,string|undefined>();

function configureBase(){
  process.env.SUPABASE_URL="https://supabase.test";
  process.env.SUPABASE_PUBLISHABLE_KEY="anon-test-key-1234567890";
  process.env.EVOLUTION_WORKSPACE_ID="workspace-test";
  process.env.EVOLUTION_EVIDENCE_SIGNING_KEY_ID="ledger-v2";
}

function chain(previousHash:string|undefined,contentHash:string,sequence:number,id:string){
  return createHash("sha256").update((previousHash??"GENESIS")+"|"+contentHash+"|"+sequence+"|"+id).digest("hex");
}

describe("Evidence Ledger Vault signing",()=>{
  beforeEach(()=>{
    for(const key of KEYS){previous.set(key,process.env[key]);delete process.env[key];}
    vault.resolveVaultSecret.mockReset();
    configureBase();
  });
  afterEach(()=>{
    vi.unstubAllGlobals();
    for(const key of KEYS){
      const value=previous.get(key);
      if(value===undefined)delete process.env[key];else process.env[key]=value;
    }
  });

  it("uses the Vault active signing key and reports the signing provider",async()=>{
    const signingKey="v".repeat(64);
    process.env.EVOLUTION_EVIDENCE_SIGNING_VAULT_ID="ledger-active";
    vault.resolveVaultSecret.mockImplementation(async(id:string,scope?:string)=>{
      expect(id).toBe("ledger-active");
      expect(scope).toBe("evidence:signing");
      return signingKey;
    });
    let captured:Record<string,unknown>|undefined;
    vi.stubGlobal("fetch",vi.fn(async(input:RequestInfo|URL,init?:RequestInit)=>{
      const url=String(input);
      if(url.endsWith("/rpc/evidence_ledger_health")){
        return new Response(JSON.stringify({
          tableReady:true,appendFunctionReady:true,immutableTriggerReady:true,
        }),{status:200,headers:{"Content-Type":"application/json"}});
      }
      expect(url).toContain("/rpc/append_evidence_ledger");
      captured=JSON.parse(String(init?.body)) as Record<string,unknown>;
      const id=String(captured.p_id);
      const contentHash=String(captured.p_content_hash);
      const signature=String(captured.p_signature);
      expect(signature).toBe(createHmac("sha256",signingKey).update(contentHash).digest("hex"));
      return new Response(JSON.stringify([{
        id,workspace_id:"workspace-test",mission_id:"mission-1",sequence:1,kind:"decision",source:"test",actor:"tester",
        event_id:null,job_id:null,checkpoint_id:null,model_ref:null,prompt_version:null,test_version:null,decision:"promote",
        payload:{ok:true},artifact_refs:[],content_hash:contentHash,signature,signature_key_id:"ledger-v2",
        previous_hash:null,chain_hash:chain(undefined,contentHash,1,id),created_at:"2026-09-21T06:00:00.000Z",
      }]),{status:200,headers:{"Content-Type":"application/json"}});
    }));
    const health=await getEvidenceLedgerHealth();
    expect(health).toMatchObject({
      configured:true,
      signingConfigured:true,
      signingProvider:"vault",
      signingKeyId:"ledger-v2",
    });
    const entry=await appendEvidenceLedger({
      id:"evidence-vault",missionId:"mission-1",kind:"decision",source:"test",actor:"tester",
      decision:"promote",payload:{ok:true},artifactRefs:[],
    });
    expect(entry).toMatchObject({id:"evidence-vault",signatureKeyId:"ledger-v2"});
    expect(captured?.p_signature_key_id).toBe("ledger-v2");
  });

  it("uses historical verification keys resolved from Vault after key rotation",async()=>{
    const currentKey="c".repeat(64);
    const historicalKey="h".repeat(64);
    process.env.EVOLUTION_EVIDENCE_SIGNING_VAULT_ID="ledger-current";
    process.env.EVOLUTION_EVIDENCE_VERIFY_VAULT_IDS_JSON=JSON.stringify({
      "ledger-v1":"ledger-historical",
    });
    vault.resolveVaultSecret.mockImplementation(async(id:string)=>{
      if(id==="ledger-current")return currentKey;
      if(id==="ledger-historical")return historicalKey;
      throw new Error("unknown vault id");
    });
    const material={
      id:"evidence-old",workspaceId:"workspace-test",missionId:"mission-1",kind:"event",source:"runtime",actor:"evolution-runtime",
      eventId:"evt-old",payload:{type:"Old"},artifactRefs:[],
    };
    const contentHash=evidenceContentHash(material);
    const rows=[{
      id:material.id,workspace_id:material.workspaceId,mission_id:material.missionId,sequence:1,
      kind:material.kind,source:material.source,actor:material.actor,event_id:material.eventId,
      job_id:null,checkpoint_id:null,model_ref:null,prompt_version:null,test_version:null,decision:null,
      payload:material.payload,artifact_refs:material.artifactRefs,content_hash:contentHash,
      signature:createHmac("sha256",historicalKey).update(contentHash).digest("hex"),
      signature_key_id:"ledger-v1",previous_hash:null,
      chain_hash:chain(undefined,contentHash,1,material.id),created_at:"2026-09-21T06:00:00.000Z",
    }];
    vi.stubGlobal("fetch",vi.fn(async(input:RequestInfo|URL)=>{
      const cursor=Number((new URL(String(input)).searchParams.get("sequence")??"gt.0").replace(/^gt\./,""));
      return new Response(JSON.stringify(rows.filter((row)=>row.sequence>cursor)),{
        status:200,headers:{"Content-Type":"application/json"},
      });
    }));
    const verified=await verifyEvidenceLedger("mission-1");
    expect(verified).toMatchObject({valid:true,entries:1,signaturesValid:true,chainValid:true});
  });

  it("falls back to the existing Env signing key when the preferred Vault reference is unavailable",async()=>{
    const envKey="e".repeat(64);
    process.env.EVOLUTION_EVIDENCE_SIGNING_VAULT_ID="ledger-unavailable";
    process.env.EVOLUTION_EVIDENCE_SIGNING_KEY=envKey;
    vault.resolveVaultSecret.mockRejectedValue(new Error("vault unavailable"));
    vi.stubGlobal("fetch",vi.fn(async(input:RequestInfo|URL,init?:RequestInit)=>{
      const url=String(input);
      if(url.endsWith("/rpc/evidence_ledger_health")){
        return new Response(JSON.stringify({
          tableReady:true,appendFunctionReady:true,immutableTriggerReady:true,
        }),{status:200,headers:{"Content-Type":"application/json"}});
      }
      const body=JSON.parse(String(init?.body)) as Record<string,unknown>;
      const contentHash=String(body.p_content_hash);
      expect(body.p_signature).toBe(createHmac("sha256",envKey).update(contentHash).digest("hex"));
      const id=String(body.p_id);
      return new Response(JSON.stringify([{
        id,workspace_id:"workspace-test",mission_id:"mission-1",sequence:1,kind:"event",source:"test",actor:"tester",
        event_id:null,job_id:null,checkpoint_id:null,model_ref:null,prompt_version:null,test_version:null,decision:null,
        payload:{},artifact_refs:[],content_hash:contentHash,signature:body.p_signature,signature_key_id:"ledger-v2",
        previous_hash:null,chain_hash:chain(undefined,contentHash,1,id),created_at:"2026-09-21T06:00:00.000Z",
      }]),{status:200,headers:{"Content-Type":"application/json"}});
    }));
    const health=await getEvidenceLedgerHealth();
    expect(health).toMatchObject({configured:true,signingProvider:"env"});
    await expect(appendEvidenceLedger({
      id:"evidence-env-fallback",missionId:"mission-1",kind:"event",source:"test",actor:"tester",payload:{},artifactRefs:[],
    })).resolves.toMatchObject({id:"evidence-env-fallback"});
  });
});
