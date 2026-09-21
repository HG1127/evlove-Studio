import {
  EvidenceLedgerHealthSchema,
  EvidenceLedgerVerifyResponseSchema,
  type EvidenceLedgerHealth,
  type EvidenceLedgerVerifyResponse,
} from "@evolution/contracts";

async function apiJson(path:string){
  const response=await fetch(path);
  const body=await response.json().catch(()=>({}));
  if(!response.ok){
    const message=String((body as {statusMessage?:string;message?:string}).statusMessage
      ??(body as {message?:string}).message
      ??`Evidence Ledger API HTTP ${response.status}`);
    throw new Error(message);
  }
  return body;
}

export async function getServerEvidenceLedgerHealth():Promise<EvidenceLedgerHealth>{
  return EvidenceLedgerHealthSchema.parse(await apiJson("/api/evolution/evidence-ledger-health"));
}

export async function verifyServerEvidenceLedger(missionId:string):Promise<EvidenceLedgerVerifyResponse>{
  return EvidenceLedgerVerifyResponseSchema.parse(
    await apiJson("/api/evolution/evidence-ledger-verify?missionId="+encodeURIComponent(missionId)),
  );
}
