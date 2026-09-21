import {defineEventHandler} from "nitro/h3";
import {checkSupabaseBackendHealth} from "@evolution/adapters";
import {EvolutionBackendHealthSchema} from "@evolution/contracts";
import {
  getServerSupabaseConfig,
  serverAiConfigured,
  serverSupabaseConfigured,
  vercelReleaseWriteConfigured,
} from "../../../src/server-env";

export default defineEventHandler(async()=>{
  const configured=serverSupabaseConfigured();
  let dataPlane={
    configured,
    database:false,
    storage:false,
    tables:{missions:false,jobs:false,events:false,artifacts:false},
    message:"Server Supabase Data Plane 未配置",
  };
  if(configured){
    try{
      const health=await checkSupabaseBackendHealth(getServerSupabaseConfig());
      dataPlane={
        configured:true,
        database:health.database,
        storage:health.storage,
        tables:health.tables,
        message:health.message,
      };
    }catch(error){
      dataPlane={
        configured:true,
        database:false,
        storage:false,
        tables:{missions:false,jobs:false,events:false,artifacts:false},
        message:`Server Data Plane 健康检查失败：${error instanceof Error?error.message:String(error)}`,
      };
    }
  }
  return EvolutionBackendHealthSchema.parse({
    checkedAt:new Date().toISOString(),
    dataPlane,
    httpDataPlane:{codeReady:true},
    sourceParse:{codeReady:true,configured,durable:true},
    serverAi:{codeReady:true,configured:serverAiConfigured()},
    sandbox:{codeReady:true},
    browser:{codeReady:true},
    release:{codeReady:true,writeConfigured:vercelReleaseWriteConfigured()},
  });
});
