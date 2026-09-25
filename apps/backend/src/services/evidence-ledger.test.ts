// @vitest-environment node
import {createHash,createHmac} from "node:crypto";
import {afterEach,beforeEach,describe,expect,it,vi} from "vitest";
import {createEvolutionEvent} from "@evolution/contracts";
import {
  appendEvidenceLedger,
  canonicalEvidenceJson,
  evidenceContentHash,
  EventEvidenceIdentityConflictError,
  getEvidenceLedgerHealth,
  mirrorEvolutionEventToEvidenceLedger,
  verifyEvidenceLedger,
} from "./evidence-ledger";

const KEYS=[
  "SUPABASE_URL","SUPABASE_PUBLISHABLE_KEY","VITE_SUPABASE_URL","VITE_SUPABASE_ANON_KEY",
  "EVOLUTION_WORKSPACE_ID","EVOLUTION_EVIDENCE_SIGNING_KEY","EVOLUTION_EVIDENCE_SIGNING_KEY_ID","EVOLUTION_EVIDENCE_VERIFY_KEYS_JSON",
  "EVOLUTION_EVIDENCE_SIGNING_VAULT_ID","EVOLUTION_EVIDENCE_VERIFY_VAULT_IDS_JSON",
] as const;
const previous=new Map<string,string|undefined>();

function configure(){
  process.env.SUPABASE_URL="https://supabase.test";
  process.env.SUPABASE_PUBLISHABLE_KEY="anon-test-key-1234567890";
  process.env.EVOLUTION_WORKSPACE_ID="workspace-test";
  process.env.EVOLUTION_EVIDENCE_SIGNING_KEY="0123456789abcdef0123456789abcdef";
  process.env.EVOLUTION_EVIDENCE_SIGNING_KEY_ID="test-key-v1";
}

function chain(previousHash:string|undefined,contentHash:string,sequence:number,id:string){
  return createHash("sha256").update((previousHash??"GENESIS")+"|"+contentHash+"|"+sequence+"|"+id).digest("hex");
}

function stubLedgerRows(rows:Array<{sequence:number}>){
  vi.stubGlobal("fetch",vi.fn(async(input:RequestInfo|URL)=>{
    const cursor=Number((new URL(String(input)).searchParams.get("sequence")??"gt.0").replace(/^gt\./,""));
    return new Response(JSON.stringify(rows.filter((row)=>row.sequence>cursor)),{
      status:200,headers:{"Content-Type":"application/json"},
    });
  }));
}

describe("immutable evidence ledger",()=>{
  beforeEach(()=>{
    for(const key of KEYS){previous.set(key,process.env[key]);delete process.env[key];}
  });
  afterEach(()=>{
    vi.unstubAllGlobals();
    for(const key of KEYS){const value=previous.get(key);if(value===undefined)delete process.env[key];else process.env[key]=value;}
  });

  it("canonicalizes object keys deterministically and stays config-blocked without secrets",async()=>{
    expect(canonicalEvidenceJson({b:2,a:{d:4,c:3}})).toBe('{"a":{"c":3,"d":4},"b":2}');
    const fetchMock=vi.fn();
    vi.stubGlobal("fetch",fetchMock);
    const health=await getEvidenceLedgerHealth();
    expect(health).toMatchObject({codeReady:true,configured:false,signingConfigured:false,hashChain:true});
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("signs canonical content and appends through the database append RPC",async()=>{
    configure();
    let captured:Record<string,unknown>|undefined;
    vi.stubGlobal("fetch",vi.fn(async(input:RequestInfo|URL,init?:RequestInit)=>{
      expect(String(input)).toContain("/rpc/append_evidence_ledger");
      captured=JSON.parse(String(init?.body)) as Record<string,unknown>;
      const id=String(captured.p_id);
      const contentHash=String(captured.p_content_hash);
      const signature=String(captured.p_signature);
      expect(signature).toBe(createHmac("sha256",process.env.EVOLUTION_EVIDENCE_SIGNING_KEY!).update(contentHash).digest("hex"));
      const row={
        id,workspace_id:"workspace-test",mission_id:"mission-1",sequence:1,kind:"decision",source:"test",actor:"tester",
        event_id:null,job_id:null,checkpoint_id:null,model_ref:null,prompt_version:"p1",test_version:"t1",decision:"promote",
        payload:{score:99},artifact_refs:["hash-1"],content_hash:contentHash,signature,signature_key_id:"test-key-v1",
        previous_hash:null,chain_hash:chain(undefined,contentHash,1,id),created_at:"2026-09-21T01:00:00.000Z",
      };
      return new Response(JSON.stringify([row]),{status:200,headers:{"Content-Type":"application/json"}});
    }));
    const entry=await appendEvidenceLedger({
      id:"evidence-1",missionId:"mission-1",kind:"decision",source:"test",actor:"tester",
      promptVersion:"p1",testVersion:"t1",decision:"promote",payload:{score:99},artifactRefs:["hash-1"],
    });
    expect(entry).toMatchObject({id:"evidence-1",sequence:1,previousHash:undefined,signatureKeyId:"test-key-v1"});
    expect(String(captured?.p_content_hash)).toHaveLength(64);
  });

  it("rejects a database append receipt with a forged signature",async()=>{
    configure();
    vi.stubGlobal("fetch",vi.fn(async(_input:RequestInfo|URL,init?:RequestInit)=>{
      const body=JSON.parse(String(init?.body)) as Record<string,unknown>;
      return new Response(JSON.stringify([{
        id:body.p_id,workspace_id:"workspace-test",mission_id:"mission-1",sequence:1,
        kind:"decision",source:"test",actor:"tester",payload:{},artifact_refs:[],
        content_hash:body.p_content_hash,signature:"b".repeat(64),signature_key_id:"test-key-v1",
        chain_hash:"c".repeat(64),created_at:"2026-09-25T00:00:00.000Z",
      }]),{status:200});
    }));
    await expect(appendEvidenceLedger({
      id:"forged-1",missionId:"mission-1",kind:"decision",source:"test",actor:"tester",
      payload:{},artifactRefs:[],
    })).rejects.toThrow("invalid signature");
  });

  it("accepts a previously committed matching Event mirror after a lost append response",async()=>{
    configure();
    const event=createEvolutionEvent({
      id:"evt-retry",missionId:"mission-1",type:"ArtifactRegistered",source:"test",
      payload:{artifactId:"hash-a"},at:"2026-09-25T00:00:00.000Z",
    });
    const material={
      id:"event-ledger-evt-retry",workspaceId:"workspace-test",missionId:"mission-1",
      kind:"event",source:"test",actor:"evolution-runtime",eventId:"evt-retry",
      decision:"ArtifactRegistered",payload:{type:"ArtifactRegistered",artifactId:"hash-a"},
      artifactRefs:["hash-a"],
    };
    const contentHash=evidenceContentHash(material);
    const existing={
      id:material.id,workspace_id:material.workspaceId,mission_id:material.missionId,
      sequence:1,kind:material.kind,source:material.source,actor:material.actor,
      event_id:material.eventId,job_id:null,checkpoint_id:null,model_ref:null,
      prompt_version:null,test_version:null,decision:material.decision,
      payload:material.payload,artifact_refs:material.artifactRefs,content_hash:contentHash,
      signature:createHmac("sha256",process.env.EVOLUTION_EVIDENCE_SIGNING_KEY!).update(contentHash).digest("hex"),
      signature_key_id:"test-key-v1",previous_hash:null,
      chain_hash:chain(undefined,contentHash,1,material.id),created_at:event.at,
    };
    const paths:string[]=[];
    vi.stubGlobal("fetch",vi.fn(async(input:RequestInfo|URL)=>{
      const url=new URL(String(input));
      paths.push(url.pathname+url.search);
      if(url.pathname.endsWith("/rpc/append_evidence_ledger"))return new Response("duplicate",{status:409});
      return new Response(JSON.stringify([existing]),{status:200});
    }));
    expect(await mirrorEvolutionEventToEvidenceLedger(event)).toMatchObject({
      id:material.id,contentHash,signatureKeyId:"test-key-v1",
    });
    expect(paths).toHaveLength(2);
    expect(paths[1]).toContain("id=eq.%22event-ledger-evt-retry%22");
  });

  it("refuses an Event mirror ID occupied by different Evidence",async()=>{
    configure();
    const event=createEvolutionEvent({
      id:"evt-conflict",missionId:"mission-1",type:"MissionUpdated",source:"test",payload:{},
    });
    vi.stubGlobal("fetch",vi.fn(async(input:RequestInfo|URL)=>{
      if(String(input).includes("/rpc/append_evidence_ledger"))return new Response("duplicate",{status:409});
      return new Response(JSON.stringify([{
        id:"event-ledger-evt-conflict",workspace_id:"workspace-test",mission_id:"mission-1",
        sequence:1,kind:"event",source:"test",actor:"evolution-runtime",
        event_id:"evt-conflict",payload:{},artifact_refs:[],content_hash:"a".repeat(64),
        signature:"b".repeat(64),signature_key_id:"test-key-v1",chain_hash:"c".repeat(64),
        created_at:event.at,
      }]),{status:200});
    }));
    await expect(mirrorEvolutionEventToEvidenceLedger(event))
      .rejects.toThrow("different content");
  });

  it("refuses a matching Event mirror whose stored signature is invalid",async()=>{
    configure();
    const event=createEvolutionEvent({
      id:"evt-unsigned",missionId:"mission-1",type:"MissionUpdated",source:"test",payload:{},
    });
    const material={
      id:"event-ledger-evt-unsigned",workspaceId:"workspace-test",missionId:"mission-1",
      kind:"event",source:"test",actor:"evolution-runtime",eventId:event.id,
      decision:event.type,payload:{type:event.type},artifactRefs:[],
    };
    vi.stubGlobal("fetch",vi.fn(async(input:RequestInfo|URL)=>{
      if(String(input).includes("/rpc/append_evidence_ledger"))return new Response("duplicate",{status:409});
      return new Response(JSON.stringify([{
        id:material.id,workspace_id:material.workspaceId,mission_id:material.missionId,
        sequence:1,kind:material.kind,source:material.source,actor:material.actor,
        event_id:material.eventId,decision:material.decision,payload:material.payload,
        artifact_refs:material.artifactRefs,content_hash:evidenceContentHash(material),
        signature:"b".repeat(64),signature_key_id:"test-key-v1",
        chain_hash:"c".repeat(64),created_at:event.at,
      }]),{status:200});
    }));
    await expect(mirrorEvolutionEventToEvidenceLedger(event))
      .rejects.toBeInstanceOf(EventEvidenceIdentityConflictError);
  });

  it("verifies content hash, HMAC signature and the serialized per-mission chain",async()=>{
    configure();
    const base={
      id:"evidence-1",workspaceId:"workspace-test",missionId:"mission-1",kind:"event",source:"runtime",actor:"evolution-runtime",
      eventId:"evt-1",payload:{type:"ActionCompleted"},artifactRefs:["hash-1"],
    };
    const contentHash=evidenceContentHash(base);
    const signature=createHmac("sha256",process.env.EVOLUTION_EVIDENCE_SIGNING_KEY!).update(contentHash).digest("hex");
    const chainHash=chain(undefined,contentHash,1,base.id);
    const rows=[{
      id:base.id,workspace_id:base.workspaceId,mission_id:base.missionId,sequence:1,kind:base.kind,source:base.source,actor:base.actor,
      event_id:base.eventId,job_id:null,checkpoint_id:null,model_ref:null,prompt_version:null,test_version:null,decision:null,
      payload:base.payload,artifact_refs:base.artifactRefs,content_hash:contentHash,signature,signature_key_id:"test-key-v1",
      previous_hash:null,chain_hash:chainHash,created_at:"2026-09-21T01:00:00.000Z",
    }];
    stubLedgerRows(rows);
    const result=await verifyEvidenceLedger("mission-1");
    expect(result).toMatchObject({valid:true,entries:1,contentHashesValid:true,signaturesValid:true,chainValid:true});
  });

  it("verifies historical signatures after active signing-key rotation",async()=>{
    configure();
    const oldKey="abcdef0123456789abcdef0123456789";
    process.env.EVOLUTION_EVIDENCE_SIGNING_KEY="fedcba9876543210fedcba9876543210";
    process.env.EVOLUTION_EVIDENCE_SIGNING_KEY_ID="test-key-v2";
    process.env.EVOLUTION_EVIDENCE_VERIFY_KEYS_JSON=JSON.stringify({"test-key-v1":oldKey});
    const first={
      id:"evidence-old",workspaceId:"workspace-test",missionId:"mission-1",kind:"event",source:"runtime",actor:"evolution-runtime",
      eventId:"evt-old",payload:{type:"Old"},artifactRefs:[],
    };
    const firstHash=evidenceContentHash(first);
    const firstChain=chain(undefined,firstHash,1,first.id);
    const second={
      id:"evidence-new",workspaceId:"workspace-test",missionId:"mission-1",kind:"event",source:"runtime",actor:"evolution-runtime",
      eventId:"evt-new",payload:{type:"New"},artifactRefs:[],
    };
    const secondHash=evidenceContentHash(second);
    const activeKey=process.env.EVOLUTION_EVIDENCE_SIGNING_KEY!;
    const rows=[
      {
        id:first.id,workspace_id:first.workspaceId,mission_id:first.missionId,sequence:1,kind:first.kind,source:first.source,actor:first.actor,
        event_id:first.eventId,job_id:null,checkpoint_id:null,model_ref:null,prompt_version:null,test_version:null,decision:null,
        payload:first.payload,artifact_refs:first.artifactRefs,content_hash:firstHash,
        signature:createHmac("sha256",oldKey).update(firstHash).digest("hex"),signature_key_id:"test-key-v1",
        previous_hash:null,chain_hash:firstChain,created_at:"2026-09-21T01:00:00.000Z",
      },
      {
        id:second.id,workspace_id:second.workspaceId,mission_id:second.missionId,sequence:2,kind:second.kind,source:second.source,actor:second.actor,
        event_id:second.eventId,job_id:null,checkpoint_id:null,model_ref:null,prompt_version:null,test_version:null,decision:null,
        payload:second.payload,artifact_refs:second.artifactRefs,content_hash:secondHash,
        signature:createHmac("sha256",activeKey).update(secondHash).digest("hex"),signature_key_id:"test-key-v2",
        previous_hash:firstChain,chain_hash:chain(firstChain,secondHash,2,second.id),created_at:"2026-09-21T01:01:00.000Z",
      },
    ];
    stubLedgerRows(rows);
    const result=await verifyEvidenceLedger("mission-1");
    expect(result).toMatchObject({valid:true,entries:2,signaturesValid:true,chainValid:true});
  });

  it("detects tampering even when the stored chain hash itself was not changed",async()=>{
    configure();
    const base={
      id:"evidence-1",workspaceId:"workspace-test",missionId:"mission-1",kind:"event",source:"runtime",actor:"evolution-runtime",
      eventId:"evt-1",payload:{type:"ActionCompleted"},artifactRefs:[],
    };
    const contentHash=evidenceContentHash(base);
    const signature=createHmac("sha256",process.env.EVOLUTION_EVIDENCE_SIGNING_KEY!).update(contentHash).digest("hex");
    const rows=[{
      id:base.id,workspace_id:base.workspaceId,mission_id:base.missionId,sequence:1,kind:base.kind,source:base.source,actor:base.actor,
      event_id:base.eventId,job_id:null,checkpoint_id:null,model_ref:null,prompt_version:null,test_version:null,decision:null,
      payload:{type:"ActionCompleted",tampered:true},artifact_refs:[],content_hash:contentHash,signature,signature_key_id:"test-key-v1",
      previous_hash:null,chain_hash:chain(undefined,contentHash,1,base.id),created_at:"2026-09-21T01:00:00.000Z",
    }];
    stubLedgerRows(rows);
    const result=await verifyEvidenceLedger("mission-1");
    expect(result).toMatchObject({valid:false,contentHashesValid:false,firstBrokenEntryId:"evidence-1"});
  });
});
