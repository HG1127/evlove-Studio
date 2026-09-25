// @vitest-environment node
import {createHash,createHmac} from "node:crypto";
import {afterEach,beforeEach,describe,expect,it,vi} from "vitest";

const artifactStore=vi.hoisted(()=>({
  put:vi.fn(),
  get:vi.fn(),
  delete:vi.fn(),
}));
vi.mock("./artifact-runtime",()=>({
  getServerArtifactStore:()=>artifactStore,
}));

import {
  archiveEvidenceLedgerExport,
  createEvidenceLedgerExport,
  evidenceContentHash,
  listEvidenceLedger,
  listEvidenceLedgerAll,
  probeEvidenceLedgerPage,
  verifyEvidenceLedgerExport,
} from "./evidence-ledger";

const KEYS=[
  "NODE_ENV","SUPABASE_URL","SUPABASE_PUBLISHABLE_KEY","SUPABASE_SECRET_KEY",
  "EVOLUTION_WORKSPACE_ID","EVOLUTION_EVIDENCE_SIGNING_KEY",
  "EVOLUTION_EVIDENCE_SIGNING_KEY_ID","EVOLUTION_EVIDENCE_VERIFY_KEYS_JSON",
  "EVOLUTION_EVIDENCE_SIGNING_VAULT_ID","EVOLUTION_EVIDENCE_VERIFY_VAULT_IDS_JSON",
] as const;
const previous=new Map<string,string|undefined>();

const SIGNING_KEY="0123456789abcdef0123456789abcdef";
const WORKSPACE="workspace-test";
const MISSION="mission-export";

function chain(previousHash:string|undefined,contentHash:string,sequence:number,id:string){
  return createHash("sha256").update((previousHash??"GENESIS")+"|"+contentHash+"|"+sequence+"|"+id).digest("hex");
}

function rows(count:number){
  const output:Array<Record<string,unknown>>=[];
  let previousHash:string|undefined;
  for(let index=0;index<count;index+=1){
    const sequence=index+1;
    const id="evidence-"+sequence;
    const material={
      id,workspaceId:WORKSPACE,missionId:MISSION,kind:"event",source:"test",actor:"tester",
      eventId:"evt-"+sequence,payload:{sequence},artifactRefs:["artifact-"+sequence],
    };
    const contentHash=evidenceContentHash(material);
    const signature=createHmac("sha256",SIGNING_KEY).update(contentHash).digest("hex");
    const currentChain=chain(previousHash,contentHash,sequence,id);
    output.push({
      id,workspace_id:WORKSPACE,mission_id:MISSION,sequence,kind:"event",source:"test",actor:"tester",
      event_id:"evt-"+sequence,job_id:null,checkpoint_id:null,model_ref:null,prompt_version:null,test_version:null,decision:null,
      payload:{sequence},artifact_refs:["artifact-"+sequence],content_hash:contentHash,signature,
      signature_key_id:"export-key-v1",previous_hash:previousHash??null,chain_hash:currentChain,
      created_at:"2026-09-21T06:"+String(sequence).padStart(2,"0")+":00.000Z",
    });
    previousHash=currentChain;
  }
  return output;
}

function installLedger(rowsInput:Array<Record<string,unknown>>,serverCap=Number.POSITIVE_INFINITY){
  const fetchMock=vi.fn(async(input:RequestInfo|URL)=>{
    const url=new URL(String(input));
    expect(url.pathname).toContain("/rest/v1/evidence_ledger");
    const cursor=Number((url.searchParams.get("sequence")??"gt.0").replace(/^gt\./,""));
    const limit=Number(url.searchParams.get("limit")??String(rowsInput.length));
    const page=rowsInput.filter((row)=>Number(row.sequence)>cursor).slice(0,Math.min(limit,serverCap));
    const selected=url.searchParams.get("select")==="id"
      ?page.map((row)=>({id:row.id}))
      :page;
    return new Response(JSON.stringify(selected),{
      status:200,
      headers:{"Content-Type":"application/json"},
    });
  });
  vi.stubGlobal("fetch",fetchMock);
  return fetchMock;
}

describe("Evidence Ledger signed export/archive",()=>{
  beforeEach(()=>{
    for(const key of KEYS){previous.set(key,process.env[key]);delete process.env[key];}
    process.env.NODE_ENV="test";
    process.env.SUPABASE_URL="https://supabase.test";
    process.env.SUPABASE_PUBLISHABLE_KEY="anon-test-key-1234567890";
    process.env.EVOLUTION_WORKSPACE_ID=WORKSPACE;
    process.env.EVOLUTION_EVIDENCE_SIGNING_KEY=SIGNING_KEY;
    process.env.EVOLUTION_EVIDENCE_SIGNING_KEY_ID="export-key-v1";
    artifactStore.put.mockReset();
    artifactStore.get.mockReset();
    artifactStore.delete.mockReset();
  });
  afterEach(()=>{
    vi.unstubAllGlobals();
    for(const key of KEYS){
      const value=previous.get(key);
      if(value===undefined)delete process.env[key];else process.env[key]=value;
    }
  });

  it("reads every page and refuses silent truncation at the export ceiling",async()=>{
    const source=rows(5);
    const fetchMock=installLedger(source);
    const all=await listEvidenceLedgerAll(MISSION,{pageSize:2,maxEntries:10});
    expect(all).toHaveLength(5);
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(fetchMock.mock.calls.map(([input])=>new URL(String(input)).searchParams.get("sequence")))
      .toEqual(["gt.0","gt.2","gt.4","gt.5"]);

    vi.unstubAllGlobals();
    installLedger(source);
    await expect(listEvidenceLedgerAll(MISSION,{pageSize:2,maxEntries:4}))
      .rejects.toThrow(/maximum supported entry count/i);
  });

  it("fills a bounded Ledger list across short pages without exporting the tail",async()=>{
    const fetchMock=installLedger(rows(5),1);
    const listed=await listEvidenceLedger(MISSION,3);
    expect(listed.map((entry)=>entry.sequence)).toEqual([1,2,3]);
    const continued=await listEvidenceLedger(MISSION,3,listed.at(-1)!.sequence);
    expect(continued.map((entry)=>entry.sequence)).toEqual([4,5]);
    expect(fetchMock).toHaveBeenCalledTimes(6);
    expect(fetchMock.mock.calls.map(([input])=>new URL(String(input)).searchParams.get("sequence")))
      .toEqual(["gt.0","gt.1","gt.2","gt.3","gt.4","gt.5"]);
  });

  it("rejects an invalid Ledger cursor before a database request",async()=>{
    const fetchMock=installLedger(rows(1));
    await expect(listEvidenceLedger(MISSION,1,-1)).rejects.toThrow(/cursor is invalid/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does not certify a valid ledger prefix when the server caps each page",async()=>{
    const fetchMock=installLedger(rows(5),1);
    const bundle=await createEvidenceLedgerExport(MISSION,{now:"2026-09-21T07:00:00.000Z"});
    expect(bundle.entryCount).toBe(5);
    expect(bundle.verification).toMatchObject({valid:true,entries:5});
    expect(fetchMock).toHaveBeenCalledTimes(6);
  });

  it("rejects a repeated sequence instead of looping or certifying duplicate evidence",async()=>{
    vi.stubGlobal("fetch",vi.fn(async()=>new Response(JSON.stringify(rows(1)),{status:200})));
    await expect(listEvidenceLedgerAll(MISSION,{pageSize:2,maxEntries:10}))
      .rejects.toThrow(/repeated a sequence/);
  });

  it("probes a bounded sequence cursor query without reading user evidence",async()=>{
    const fetchMock=vi.fn(async(input:RequestInfo|URL)=>{
      expect(String(input)).toContain("/rest/v1/evidence_ledger?");
      return new Response("[]",{status:200});
    });
    vi.stubGlobal("fetch",fetchMock);
    await expect(probeEvidenceLedgerPage()).resolves.toBe(true);
    const query=new URL(String(fetchMock.mock.calls[0][0])).searchParams;
    expect(query.get("select")).toBe("id");
    expect(query.get("workspace_id")).toBe("eq.workspace-test");
    expect(query.get("mission_id")).toBe("eq.health-probe:no-such-mission");
    expect(query.get("sequence")).toBe("gt.0");
    expect(query.get("limit")).toBe("1");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const identityQuery=new URL(String(fetchMock.mock.calls[1][0])).searchParams;
    expect(identityQuery.get("id")).toBe('eq."health-probe:no-such-event-ledger"');
    expect(identityQuery.get("limit")).toBe("1");
  });

  it("creates a signed canonical export bundle that independently verifies",async()=>{
    installLedger(rows(3));
    const bundle=await createEvidenceLedgerExport(MISSION,{now:"2026-09-21T07:00:00.000Z"});
    expect(bundle).toMatchObject({
      formatVersion:"evolution-evidence-export-v1",
      workspaceId:WORKSPACE,
      missionId:MISSION,
      entryCount:3,
      signatureKeyId:"export-key-v1",
      signingProvider:"env",
      retention:{
        mode:"immutable-artifact-archive",
        sourceLedgerAppendOnly:true,
        sourceDeletionAllowed:false,
      },
      verification:{valid:true,entries:3},
    });
    expect(bundle.bundleHash).toMatch(/^[a-f0-9]{64}$/);
    expect(bundle.signature).toBe(createHmac("sha256",SIGNING_KEY).update(bundle.bundleHash).digest("hex"));
    await expect(verifyEvidenceLedgerExport(bundle)).resolves.toMatchObject({
      valid:true,
      manifestValid:true,
      bundleHashValid:true,
      bundleSignatureValid:true,
      ledgerValid:true,
    });
  });

  it("detects any exported evidence tampering even when the original signature fields are retained",async()=>{
    installLedger(rows(2));
    const bundle=await createEvidenceLedgerExport(MISSION,{now:"2026-09-21T07:00:00.000Z"});
    const tampered=structuredClone(bundle);
    tampered.entries[0]!.payload={sequence:1,tampered:true};
    const result=await verifyEvidenceLedgerExport(tampered);
    expect(result.valid).toBe(false);
    expect(result.bundleHashValid).toBe(false);
    expect(result.ledgerValid).toBe(false);
  });

  it("archives the signed bundle into Artifact Store without deleting the source ledger",async()=>{
    installLedger(rows(2));
    artifactStore.put.mockResolvedValue(undefined);
    const archived=await archiveEvidenceLedgerExport(MISSION,{now:"2026-09-21T07:00:00.000Z"});
    expect(archived).toMatchObject({
      missionId:MISSION,
      entryCount:2,
      retentionMode:"immutable-artifact-archive",
      signatureKeyId:"export-key-v1",
      signingProvider:"env",
    });
    expect(archived.artifactId).toMatch(/^evidence-ledger-export-/);
    expect(artifactStore.put).toHaveBeenCalledTimes(1);
    expect(artifactStore.delete).not.toHaveBeenCalled();
    const blob=artifactStore.put.mock.calls[0]?.[1] as Blob;
    expect(blob.type).toBe("application/vnd.evolution.evidence-export+json");
    const persisted=JSON.parse(await blob.text()) as Record<string,unknown>;
    expect(persisted.bundleHash).toBe(archived.bundleHash);
    expect(JSON.stringify(persisted)).toContain('"sourceDeletionAllowed":false');
  });

  it("refuses to archive a source ledger that fails integrity verification",async()=>{
    const source=rows(1);
    source[0]!.payload={sequence:1,tampered:true};
    installLedger(source);
    await expect(archiveEvidenceLedgerExport(MISSION))
      .rejects.toThrow(/failed integrity verification/i);
    expect(artifactStore.put).not.toHaveBeenCalled();
    expect(artifactStore.delete).not.toHaveBeenCalled();
  });
});
