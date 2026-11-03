import {MissionCatalogSnapshotSchema} from "@evolution/contracts";
import {httpApiErrorDetail} from "./http-error";
export async function readHttpMissionCatalog(apiUrl:string,signal?:AbortSignal){
 const response=await fetch(apiUrl.replace(/\/+$/,"")+"/mission-catalog",{cache:"no-store",signal});
 if(response.status===404)return undefined;
 if(!response.ok){const detail=httpApiErrorDetail(await response.json().catch(()=>undefined));throw new Error(`项目目录同步 HTTP ${response.status}${detail?": "+detail:""}`);}
 try{return MissionCatalogSnapshotSchema.parse(await response.json());}catch{throw new Error("项目目录数据未通过完整性校验。");}
}
