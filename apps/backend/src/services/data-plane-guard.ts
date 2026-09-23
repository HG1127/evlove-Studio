import {createError} from "nitro/h3";
import {serverSupabaseConfigDiagnostics} from "../server-env";

export function requireServerDataPlaneAvailable(){
  const diagnostics=serverSupabaseConfigDiagnostics();
  if(diagnostics.configValid&&diagnostics.credentialMode!=="missing")return diagnostics;

  throw createError({
    statusCode:503,
    statusMessage:"Server Data Plane 未配置或当前不可用",
    data:{
      code:"SERVER_DATA_PLANE_UNAVAILABLE",
      credentialMode:diagnostics.credentialMode,
      urlPresent:diagnostics.urlPresent,
      secretPresent:diagnostics.secretPresent,
      publishablePresent:diagnostics.publishablePresent,
      artifactBucketPresent:diagnostics.artifactBucketPresent,
      issueFields:diagnostics.issueFields,
    },
  });
}
