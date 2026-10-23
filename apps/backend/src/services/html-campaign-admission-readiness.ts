import {createHash} from "node:crypto";
import {createError} from "nitro/h3";
import {z} from "zod";
import {getServerSupabaseConfig} from "../server-env";
import {dataPlaneFetch} from "./data-plane-http";
import {supabaseRestAuthHeaders} from "./supabase-rest-auth";

const Schema=z.object({paths:z.record(z.string(),z.unknown())});
const migration="20261021130000_html_campaign_start_security_invariants.sql";
let verified:{binding:string;at:number}|undefined;
export function resetHtmlCampaignAdmissionReadiness(){verified=undefined;}

/** Metadata read only. The admission RPC still performs the authoritative atomic check when starting. */
export async function assertServerHtmlCampaignAdmissionReady(){
  let binding:string;
  let schema:z.infer<typeof Schema>;
  try{
    const config=getServerSupabaseConfig();
    const root=config.url.replace(/\/+$/,"")+"/rest/v1/";
    binding=createHash("sha256").update(root+"\0"+config.anonKey).digest("hex");
    if(verified?.binding===binding&&Date.now()-verified.at<60_000)return;
    const response=await dataPlaneFetch("html-campaign-admission-readiness",root,{
      headers:{...supabaseRestAuthHeaders(config.anonKey),Accept:"application/openapi+json"},
      signal:AbortSignal.timeout(10000),
    });
    schema=Schema.parse(await response.json());
  }catch(cause){
    throw createError({statusCode:503,statusMessage:"暂时无法核验 HTML 任务启动依赖，尚未创建执行任务",cause,
      data:{code:"HTML_CAMPAIGN_ADMISSION_UNVERIFIED",migration,
        action:"检查服务端数据库连接及 REST Schema 可读性，确认迁移状态后再按原请求键重试。"}});
  }
  if(!schema.paths["/rpc/create_evolution_html_campaign_control"]){
    throw createError({statusCode:503,statusMessage:"真实数据库尚未安装 HTML 任务并发启动迁移，尚未创建执行任务",
      data:{code:"HTML_CAMPAIGN_MIGRATION_REQUIRED",migration,
        action:"在此应用关联的 Supabase 项目应用指定迁移并核验权限后重试；当前检查未启动 Sandbox 或 Workflow。"}});
  }
  verified={binding,at:Date.now()};
}
