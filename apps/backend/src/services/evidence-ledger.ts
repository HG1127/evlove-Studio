import {createHash,createHmac,randomUUID,timingSafeEqual} from "node:crypto";
import {
  EvidenceLedgerAppendRequestSchema,
  EvidenceLedgerEntrySchema,
  EvidenceLedgerHealthSchema,
  EvidenceLedgerVerifyResponseSchema,
  type EvidenceLedgerAppendRequest,
  type EvidenceLedgerEntry,
  type EvolutionEvent,
} from "@evolution/contracts";
import {
  evidenceLedgerConfigured,
  getEvidenceLedgerSigningConfig,
  getEvidenceLedgerSigningKeyId,
  getEvidenceLedgerSigningVaultId,
  getEvidenceLedgerVerifyVaultIds,
  getEvolutionWorkspaceId,
  getServerSupabaseConfig,
} from "../server-env";
import {resolveVaultSecret} from "./server-vault";

type JsonRecord=Record<string,unknown>;
type ResolvedSigningConfig={
  key:string;
  keyId:string;
  verificationKeys:Record<string,string>;
  provider:"env"|"vault";
};

async function resolveEvidenceSigningConfig():Promise<ResolvedSigningConfig|undefined>{
  const env=getEvidenceLedgerSigningConfig();
  const verificationKeys:Record<string,string>={...(env?.verificationKeys??{})};
  const vaultVerificationIds=getEvidenceLedgerVerifyVaultIds();
  await Promise.all(Object.entries(vaultVerificationIds).map(async([keyId,vaultId])=>{
    try{
      const key=await resolveVaultSecret(vaultId,"evidence:signing");
      if(key.length>=32)verificationKeys[keyId]=key;
    }catch{
      // A missing historical Vault key only affects verification of entries signed by that key.
    }
  }));
  const activeVaultId=getEvidenceLedgerSigningVaultId();
  if(activeVaultId){
    try{
      const key=await resolveVaultSecret(activeVaultId,"evidence:signing");
      if(key.length>=32){
        const keyId=getEvidenceLedgerSigningKeyId();
        return {key,keyId,verificationKeys:{...verificationKeys,[keyId]:key},provider:"vault"};
      }
    }catch{
      // Migration-safe fallback: keep the existing environment signing key usable while Vault is repaired.
    }
  }
  return env?{...env,verificationKeys:{...verificationKeys,...env.verificationKeys},provider:"env"}:undefined;
}

function canonicalValue(value:unknown):unknown{
  if(Array.isArray(value))return value.map(canonicalValue);
  if(value&&typeof value==="object"){
    return Object.fromEntries(
      Object.entries(value as Record<string,unknown>)
        .filter(([,item])=>item!==undefined)
        .sort(([a],[b])=>a.localeCompare(b))
        .map(([key,item])=>[key,canonicalValue(item)]),
    );
  }
  return value;
}

export function canonicalEvidenceJson(value:unknown){
  return JSON.stringify(canonicalValue(value));
}

function sha256(value:string){
  return createHash("sha256").update(value).digest("hex");
}

function signatureFor(contentHash:string,key:string){
  return createHmac("sha256",key).update(contentHash).digest("hex");
}

function chainHash(previousHash:string|undefined,contentHash:string,sequence:number,id:string){
  return sha256((previousHash??"GENESIS")+"|"+contentHash+"|"+sequence+"|"+id);
}

function contentMaterial(args:{
  id:string;
  workspaceId:string;
  missionId:string;
  kind:string;
  source:string;
  actor:string;
  eventId?:string;
  jobId?:string;
  checkpointId?:string;
  modelRef?:string;
  promptVersion?:string;
  testVersion?:string;
  decision?:string;
  payload:Record<string,unknown>;
  artifactRefs:string[];
}){
  return {
    id:args.id,
    workspaceId:args.workspaceId,
    missionId:args.missionId,
    kind:args.kind,
    source:args.source,
    actor:args.actor,
    eventId:args.eventId,
    jobId:args.jobId,
    checkpointId:args.checkpointId,
    modelRef:args.modelRef,
    promptVersion:args.promptVersion,
    testVersion:args.testVersion,
    decision:args.decision,
    payload:args.payload,
    artifactRefs:args.artifactRefs,
  };
}

export function evidenceContentHash(args:Parameters<typeof contentMaterial>[0]){
  return sha256(canonicalEvidenceJson(contentMaterial(args)));
}

function rowEntry(row:JsonRecord):EvidenceLedgerEntry{
  return EvidenceLedgerEntrySchema.parse({
    id:row.id,
    workspaceId:row.workspace_id,
    missionId:row.mission_id,
    sequence:Number(row.sequence),
    kind:row.kind,
    source:row.source,
    actor:row.actor,
    eventId:row.event_id??undefined,
    jobId:row.job_id??undefined,
    checkpointId:row.checkpoint_id??undefined,
    modelRef:row.model_ref??undefined,
    promptVersion:row.prompt_version??undefined,
    testVersion:row.test_version??undefined,
    decision:row.decision??undefined,
    payload:row.payload??{},
    artifactRefs:row.artifact_refs??[],
    contentHash:row.content_hash,
    signature:row.signature??undefined,
    signatureKeyId:row.signature_key_id??undefined,
    previousHash:row.previous_hash??undefined,
    chainHash:row.chain_hash,
    createdAt:row.created_at,
  });
}

function restClient(){
  const config=getServerSupabaseConfig();
  const root=config.url.replace(/\/+$/,"")+"/rest/v1";
  const headers={
    apikey:config.anonKey,
    Authorization:"Bearer "+config.anonKey,
    "Content-Type":"application/json",
  };
  async function request(path:string,init:RequestInit={}){
    const response=await fetch(root+"/"+path,{...init,headers:{...headers,...(init.headers??{})}});
    if(!response.ok){
      const detail=await response.text().catch(()=>"");
      throw new Error("Evidence Ledger Supabase HTTP "+response.status+": "+detail.slice(0,500));
    }
    if(response.status===204)return undefined;
    const text=await response.text();
    return text?JSON.parse(text):undefined;
  }
  return {request};
}

export async function getEvidenceLedgerHealth(){
  const checkedAt=new Date().toISOString();
  const workspaceId=getEvolutionWorkspaceId();
  const signing=await resolveEvidenceSigningConfig();
  if(!workspaceId||!signing||!evidenceLedgerConfigured()){
    return EvidenceLedgerHealthSchema.parse({
      codeReady:true,
      configured:false,
      databaseReady:false,
      signingConfigured:Boolean(signing),
      appendFunctionReady:false,
      immutableTriggerReady:false,
      hashChain:true,
      workspaceId,
      signingKeyId:signing?.keyId,
      signingProvider:signing?.provider,
      verificationKeyCount:Object.keys(signing?.verificationKeys??{}).length,
      rotationReady:Object.keys(signing?.verificationKeys??{}).length>1,
      checkedAt,
      message:"Evidence Ledger 代码已就绪；等待 Supabase + Workspace + Env/Vault server-only signing key。",
    });
  }
  try{
    const {request}=restClient();
    const raw=await request("rpc/evidence_ledger_health",{method:"POST",body:"{}"}) as {
      tableReady?:boolean;appendFunctionReady?:boolean;immutableTriggerReady?:boolean;
    };
    const databaseReady=Boolean(raw?.tableReady);
    const appendFunctionReady=Boolean(raw?.appendFunctionReady);
    const immutableTriggerReady=Boolean(raw?.immutableTriggerReady);
    const configured=databaseReady&&appendFunctionReady&&immutableTriggerReady;
    return EvidenceLedgerHealthSchema.parse({
      codeReady:true,
      configured,
      databaseReady,
      signingConfigured:true,
      appendFunctionReady,
      immutableTriggerReady,
      hashChain:true,
      workspaceId,
      signingKeyId:signing.keyId,
      signingProvider:signing.provider,
      verificationKeyCount:Object.keys(signing.verificationKeys).length,
      rotationReady:Object.keys(signing.verificationKeys).length>1,
      checkedAt,
      message:configured
        ?"Immutable Evidence Ledger 已连接：append-only trigger + serialized hash chain + "+signing.provider+" HMAC signing 均就绪。"
        :"Evidence Ledger migration 尚未完整生效。",
    });
  }catch(error){
    return EvidenceLedgerHealthSchema.parse({
      codeReady:true,configured:false,databaseReady:false,signingConfigured:true,
      appendFunctionReady:false,immutableTriggerReady:false,hashChain:true,workspaceId,signingKeyId:signing.keyId,
      signingProvider:signing.provider,
      verificationKeyCount:Object.keys(signing.verificationKeys).length,
      rotationReady:Object.keys(signing.verificationKeys).length>1,checkedAt,
      message:error instanceof Error?error.message:String(error),
    });
  }
}

export async function appendEvidenceLedger(raw:EvidenceLedgerAppendRequest){
  const input=EvidenceLedgerAppendRequestSchema.parse(raw);
  const workspaceId=getEvolutionWorkspaceId();
  const signing=await resolveEvidenceSigningConfig();
  if(!workspaceId||!signing||!evidenceLedgerConfigured()){
    throw new Error("Immutable Evidence Ledger 未配置：需要 Supabase、EVOLUTION_WORKSPACE_ID 与 Env/Vault server-only signing key。");
  }
  const id=input.id??"evidence-"+randomUUID();
  const material={
    id,workspaceId,missionId:input.missionId,kind:input.kind,source:input.source,actor:input.actor,
    eventId:input.eventId,jobId:input.jobId,checkpointId:input.checkpointId,
    modelRef:input.modelRef,promptVersion:input.promptVersion,testVersion:input.testVersion,decision:input.decision,
    payload:input.payload,artifactRefs:input.artifactRefs,
  };
  const contentHash=evidenceContentHash(material);
  const signature=signatureFor(contentHash,signing.key);
  const {request}=restClient();
  const rows=await request("rpc/append_evidence_ledger",{
    method:"POST",
    body:JSON.stringify({
      p_id:id,
      p_workspace_id:workspaceId,
      p_mission_id:input.missionId,
      p_kind:input.kind,
      p_source:input.source,
      p_actor:input.actor,
      p_event_id:input.eventId??null,
      p_job_id:input.jobId??null,
      p_checkpoint_id:input.checkpointId??null,
      p_model_ref:input.modelRef??null,
      p_prompt_version:input.promptVersion??null,
      p_test_version:input.testVersion??null,
      p_decision:input.decision??null,
      p_payload:input.payload,
      p_artifact_refs:input.artifactRefs,
      p_content_hash:contentHash,
      p_signature:signature,
      p_signature_key_id:signing.keyId,
    }),
  }) as JsonRecord[];
  if(!rows?.[0])throw new Error("Evidence Ledger append returned no row");
  return rowEntry(rows[0]);
}

export async function listEvidenceLedger(missionId:string,limit=500){
  const workspaceId=getEvolutionWorkspaceId();
  if(!workspaceId||!evidenceLedgerConfigured())return[];
  const bounded=Math.max(1,Math.min(limit,2000));
  const {request}=restClient();
  const rows=await request(
    "evidence_ledger?select=*&workspace_id=eq."+encodeURIComponent(workspaceId)
    +"&mission_id=eq."+encodeURIComponent(missionId)
    +"&order=sequence.asc&limit="+bounded,
  ) as JsonRecord[];
  return (rows??[]).map(rowEntry);
}

function safeSignatureEqual(a:string,b:string){
  if(a.length!==b.length)return false;
  return timingSafeEqual(Buffer.from(a,"hex"),Buffer.from(b,"hex"));
}

export async function verifyEvidenceLedger(missionId:string){
  const checkedAt=new Date().toISOString();
  const signing=await resolveEvidenceSigningConfig();
  const rows=await listEvidenceLedger(missionId,2000);
  let previousHash: string|undefined;
  let contentHashesValid=true;
  let signaturesValid=Boolean(signing);
  let chainValid=true;
  let firstBrokenEntryId:string|undefined;

  for(const entry of rows){
    const expectedContent=evidenceContentHash({
      id:entry.id,workspaceId:entry.workspaceId,missionId:entry.missionId,kind:entry.kind,source:entry.source,actor:entry.actor,
      eventId:entry.eventId,jobId:entry.jobId,checkpointId:entry.checkpointId,modelRef:entry.modelRef,
      promptVersion:entry.promptVersion,testVersion:entry.testVersion,decision:entry.decision,payload:entry.payload,artifactRefs:entry.artifactRefs,
    });
    const contentOk=expectedContent===entry.contentHash;
    const verificationKey=signing
      ?entry.signatureKeyId
        ?signing.verificationKeys[entry.signatureKeyId]
        :signing.key
      :undefined;
    const signatureOk=Boolean(
      verificationKey
      &&entry.signature
      &&safeSignatureEqual(signatureFor(entry.contentHash,verificationKey),entry.signature)
    );
    const chainOk=entry.previousHash===previousHash
      &&entry.chainHash===chainHash(previousHash,entry.contentHash,entry.sequence,entry.id);
    if(!contentOk)contentHashesValid=false;
    if(!signatureOk)signaturesValid=false;
    if(!chainOk)chainValid=false;
    if(!firstBrokenEntryId&&(!contentOk||!signatureOk||!chainOk))firstBrokenEntryId=entry.id;
    previousHash=entry.chainHash;
  }
  const valid=contentHashesValid&&signaturesValid&&chainValid;
  return EvidenceLedgerVerifyResponseSchema.parse({
    missionId,valid,entries:rows.length,contentHashesValid,signaturesValid,chainValid,firstBrokenEntryId,checkedAt,
    message:valid
      ?`Evidence Ledger ${rows.length} 条记录的 content hash、HMAC signature 与 chain 均通过验证。`
      :`Evidence Ledger 校验失败${firstBrokenEntryId?`，首个异常记录 ${firstBrokenEntryId}`:""}。`,
  });
}

function artifactRefsFromEvent(event:EvolutionEvent){
  const refs=new Set<string>();
  for(const [key,value] of Object.entries(event.payload)){
    if(typeof value!=="string")continue;
    if(/(?:artifact|snapshot|hash|candidate|deployment).*id$|(?:artifact|snapshot|hash)/i.test(key))refs.add(value);
  }
  return [...refs];
}

export async function mirrorEvolutionEventToEvidenceLedger(event:EvolutionEvent){
  if(!evidenceLedgerConfigured()||!event.missionId)return undefined;
  return appendEvidenceLedger({
    id:"event-ledger-"+event.id,
    missionId:event.missionId,
    kind:"event",
    source:event.source,
    actor:"evolution-runtime",
    eventId:event.id,
    jobId:event.jobId,
    checkpointId:event.checkpointId,
    decision:event.type,
    payload:{type:event.type,causationId:event.causationId,correlationId:event.correlationId,...event.payload},
    artifactRefs:artifactRefsFromEvent(event),
  });
}
