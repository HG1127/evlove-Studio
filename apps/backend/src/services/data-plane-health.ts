import {checkSupabaseBackendHealth} from "@evolution/adapters";
import {
  getServerSupabaseConfig,
  serverSupabaseConfigDiagnostics,
  serverSupabaseConfigured,
  serverSupabaseCredentialMode,
  serverSupabaseSecureConfigured,
} from "../server-env";

export type DataPlaneHealth={
  checkedAt:string;
  status:"ready"|"degraded"|"unavailable";
  config:{
    configured:boolean;
    secureCredential:boolean;
    credentialMode:"secret"|"publishable"|"missing";
  };
  database:boolean;
  storage:boolean;
  artifactCleanup:boolean;
  tables:{missions:boolean;jobs:boolean;events:boolean;artifacts:boolean};
  blockers:string[];
  message:string;
};

export async function getDataPlaneHealth():Promise<DataPlaneHealth>{
  const diagnostics=serverSupabaseConfigDiagnostics();
  const configured=serverSupabaseConfigured();
  const secureCredential=serverSupabaseSecureConfigured();
  const credentialMode=serverSupabaseCredentialMode();
  const checkedAt=new Date().toISOString();

  if(!configured){
    return {
      checkedAt,
      status:"unavailable",
      config:{configured:false,secureCredential,credentialMode},
      database:false,
      storage:false,
      artifactCleanup:false,
      tables:{missions:false,jobs:false,events:false,artifacts:false},
      blockers:diagnostics.issueFields.length?diagnostics.issueFields:["Supabase server credential missing"],
      message:"Server Data Plane 未配置。",
    };
  }

  try{
    const health=await checkSupabaseBackendHealth(getServerSupabaseConfig());
    const blockers:string[]=[];
    if(!secureCredential)blockers.push("Server secret credential missing");
    if(!health.database)blockers.push("Database tables not ready");
    if(!health.storage)blockers.push("Artifact storage not ready");
    if(!health.artifactCleanup)blockers.push("Artifact blob cleanup migration not ready");
    return {
      checkedAt,
      status:blockers.length?"degraded":"ready",
      config:{configured:true,secureCredential,credentialMode},
      database:health.database,
      storage:health.storage,
      artifactCleanup:health.artifactCleanup,
      tables:health.tables,
      blockers,
      message:health.message,
    };
  }catch(error){
    return {
      checkedAt,
      status:"unavailable",
      config:{configured:true,secureCredential,credentialMode},
      database:false,
      storage:false,
      artifactCleanup:false,
      tables:{missions:false,jobs:false,events:false,artifacts:false},
      blockers:["Supabase runtime health check failed"],
      message:error instanceof Error?error.message:"Supabase health check failed",
    };
  }
}
