import {MissionEnvelopeSchema} from "@evolution/contracts";
import {textDigest,sha256} from "./frozen-artifact";

export const P3X_MISSION_ID="lab-synthetic-html-task-filter-p3x-v1";
export const P3X_BLOB_ID="p3y-synthetic-task-board-original";
const ORIGINAL_SHA="192abea39d167d9c0f4310fc603905905de5fa44106685fc7d6ea3d2931da8dc";
const ORIGINAL_SIZE=2067;
const root="/api/evolution";

async function request(path:string,init:RequestInit={}){
  const response=await fetch(root+path,{
    cache:"no-store",credentials:"same-origin",
    signal:AbortSignal.timeout(15_000),...init,
  });
  return response;
}
async function expectJson(path:string,init:RequestInit={}){
  const response=await request(path,init);
  if(!response.ok)throw Error("受审计后端请求未通过（HTTP "+response.status+"）；请核查登录权限和原始数据，不自动重试写入。");
  return response.json() as Promise<unknown>;
}
async function verifyRemoteBlob(id:string):Promise<"missing"|"verified">{
  const response=await request("/artifacts/"+encodeURIComponent(id));
  if(response.status===404)return "missing";
  if(!response.ok)throw Error("服务器原版文件回读未确认（HTTP "+response.status+"）；停止绑定。");
  const content=await response.arrayBuffer();
  if(content.byteLength!==ORIGINAL_SIZE||await sha256(content)!==ORIGINAL_SHA)throw Error("服务器原版文件字节或 SHA-256 不符；不得覆盖或绑定。");
  return "verified";
}

/** Explicitly authorized one-off P3-X source custody. No model call, no Job,
 * no SQL shortcut; every write is through mission.write guarded API.
 * A prior successful artifact POST can be resumed without re-uploading bytes.
 */
export async function registerAndBindP3XSource(){
  // Isolated Lab only: this admin-only route returns 404 outside the Lab.
  // Reject unknown or blocked global Job state before any source mutation.
  const integrity=await expectJson("/lab-job-integrity") as {mode?:string;status?:string;issues?:unknown[]};
  if(integrity.mode!=="read-only"||integrity.status!=="clear"
    ||!Array.isArray(integrity.issues)||integrity.issues.length!==0){
    throw Error("隔离 Lab Job 完整性未核验通过，停止文件登记。");
  }
  const path="/missions/"+encodeURIComponent(P3X_MISSION_ID);
  const envelope=MissionEnvelopeSchema.parse(await expectJson(path));
  if(envelope.missionId!==P3X_MISSION_ID||envelope.payload.id!==P3X_MISSION_ID)throw Error("Mission 身份不匹配");
  const mission=envelope.payload;
  if(mission.campaign.status!=="idle"||mission.candidates.length!==0)throw Error("Mission 已运行或已有 Candidate；禁止改变冻结原版。");
  if(mission.sourceArtifacts.length!==1)throw Error("原版文件清单不符合唯一合成 Mission。");
  const source=mission.sourceArtifacts[0]!;
  if(source.id!=="source-task-board"||source.name!=="original.html"
    ||source.mimeType!=="text/html"||source.size!==ORIGINAL_SIZE
    ||source.mutationGovernance?.parentSha256!==ORIGINAL_SHA
    ||typeof source.textContent!=="string"
    ||new TextEncoder().encode(source.textContent).byteLength!==ORIGINAL_SIZE
    ||await textDigest(source.textContent)!==ORIGINAL_SHA){
    throw Error("任务内原始 HTML 未通过冻结 SHA-256、大小或身份核对，禁止写入。");
  }
  if(source.storageRef){
    if(source.storageRef!==P3X_BLOB_ID)throw Error("源文件已有其他 storageRef；停止覆盖。");
    if(await verifyRemoteBlob(source.storageRef)!=="verified")throw Error("已绑定原版的物理字节缺失。");
    return {state:"already-bound" as const,revision:envelope.revision,blobId:P3X_BLOB_ID};
  }
  const existing=await verifyRemoteBlob(P3X_BLOB_ID);
  if(existing==="missing"){
    const registered=await expectJson("/artifacts/register",{
      method:"POST",headers:{"Content-Type":"application/json"},
      body:JSON.stringify({id:P3X_BLOB_ID,missionId:P3X_MISSION_ID,kind:"source",
        mimeType:"text/html",content:source.textContent}),
    }) as {id?:string;missionId?:string;kind?:string;sha256?:string;size?:number};
    if(registered.id!==P3X_BLOB_ID||registered.missionId!==P3X_MISSION_ID
      ||registered.kind!=="source"||registered.sha256!==ORIGINAL_SHA
      ||registered.size!==ORIGINAL_SIZE)throw Error("源文件登记回执不匹配；已停止 CAS，保留证据。");
    if(await verifyRemoteBlob(P3X_BLOB_ID)!=="verified")throw Error("原始 HTML 写入后回读未确认；停止绑定。");
  }
  const payload={...mission,sourceArtifacts:[{...source,storageRef:P3X_BLOB_ID}]};
  const saved=MissionEnvelopeSchema.parse(await expectJson(path,{
    method:"PUT",headers:{"Content-Type":"application/json"},
    body:JSON.stringify({...envelope,payload}),
  }));
  if(saved.missionId!==P3X_MISSION_ID||saved.revision!==envelope.revision+1
    ||saved.payload.sourceArtifacts[0]?.storageRef!==P3X_BLOB_ID){
    throw Error("Mission CAS 保存回执异常；停止后续操作，请检查后端状态。");
  }
  const reread=MissionEnvelopeSchema.parse(await expectJson(path));
  if(reread.missionId!==P3X_MISSION_ID||reread.revision!==saved.revision
    ||reread.payload.sourceArtifacts[0]?.storageRef!==P3X_BLOB_ID
    ||await verifyRemoteBlob(P3X_BLOB_ID)!=="verified"){
    throw Error("Mission 保存后源文件保管链回读不一致；禁止执行实验。");
  }
  return {state:"bound" as const,revision:reread.revision,blobId:P3X_BLOB_ID};
}
