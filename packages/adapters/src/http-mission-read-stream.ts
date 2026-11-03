import {MissionReadStreamRecordSchema,type MissionEnvelope,type MissionReadStreamRecord} from "@evolution/contracts";
import {httpApiErrorDetail} from "./http-error";
const invalid=()=>new Error("项目数据格式不完整，本次同步未完成。");
export class MissionReadStreamError extends Error{
  readonly retryable:boolean;
  constructor(failure:Extract<MissionReadStreamRecord,{type:"error"}>["failure"]){
    const detail=httpApiErrorDetail({data:failure});
    super(`项目同步 HTTP ${failure.status}${detail?": "+detail:""}`);
    this.name="MissionReadStreamError";
    this.retryable=failure.code==="SERVER_DATA_PLANE_UNAVAILABLE"&&["network-error","upstream-unavailable","rate-limited-or-timeout"].includes(failure.reason);
  }
}
export function createHttpMissionReadStream(root:string,fallback:(id:string)=>Promise<MissionEnvelope|undefined>){
  let supported:boolean|undefined;
  return async(id:string):Promise<MissionEnvelope|undefined>=>{
    if(supported===false)return fallback(id);
    const response=await fetch(`${root}/missions/${encodeURIComponent(id)}/read`,{cache:"no-store",signal:AbortSignal.timeout(180_000)});
    if(response.status===404&&supported===undefined){supported=false;return fallback(id);}
    if(!response.ok){
      const detail=httpApiErrorDetail(await response.json().catch(()=>undefined));
      throw new Error(`项目同步 HTTP ${response.status}${detail?": "+detail:""}`);
    }
    supported=true;
    if(!response.headers.get("content-type")?.includes("application/x-ndjson"))throw invalid();
    // A complete EOF is required even after a terminal frame. Transport errors
    // propagate unchanged; only schema-validated error frames permit recovery.
    const text=await response.text();let terminal:Exclude<MissionReadStreamRecord,{type:"pending"}>|undefined;
    let records=0;
    for(const line of text.split("\n")){
      if(!line.trim())continue;
      if(terminal)throw invalid();
      let record:MissionReadStreamRecord;
      try{record=MissionReadStreamRecordSchema.parse(JSON.parse(line));}catch{throw invalid();}
      if(++records===1&&record.type!=="pending")throw invalid();
      if(record.type!=="pending")terminal=record;
    }
    if(!terminal)throw invalid();
    if(terminal.type==="error"){
      if(terminal.failure.code==="MISSION_NOT_FOUND")return undefined;
      throw new MissionReadStreamError(terminal.failure);
    }
    const envelope=terminal.envelope;
    if(envelope.missionId!==id||envelope.payload.id!==id)throw invalid();
    return envelope;
  };
}
