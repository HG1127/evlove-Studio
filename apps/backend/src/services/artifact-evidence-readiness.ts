import {createError} from "nitro/h3";
import {getEvidenceLedgerHealth} from "./evidence-ledger";

/** A Mission-bound registration must be able to finish its immutable receipt before storing new bytes. */
export async function assertServerArtifactEvidenceReady(
  missionId:string|undefined,
  inspect:typeof getEvidenceLedgerHealth=getEvidenceLedgerHealth,
){
  if(!missionId)return;
  const health=await inspect();
  if(health.configured&&health.databaseReady&&health.signingConfigured
    &&health.appendFunctionReady&&health.immutableTriggerReady)return;
  throw createError({
    statusCode:503,
    statusMessage:"文件证据登记尚未就绪，请先修复证据签名或账本连接",
    data:{
      code:"ARTIFACT_EVIDENCE_NOT_READY",missionId,
      signingConfigured:health.signingConfigured,databaseReady:health.databaseReady,
      appendFunctionReady:health.appendFunctionReady,immutableTriggerReady:health.immutableTriggerReady,
      action:"配置服务端证据签名并确认账本迁移已生效后重试。若文件此前已保存，请按原 Artifact ID 对账恢复，无需重新上传。",
    },
  });
}
