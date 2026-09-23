import {ProductionBuildInfoSchema,type ProductionBuildInfo} from "@evolution/contracts";

function envValue(...values:Array<string|undefined>){
  for(const value of values){
    const normalized=value?.trim();
    if(normalized)return normalized;
  }
  return undefined;
}

export function getProductionBuildInfo(env:NodeJS.ProcessEnv=process.env):ProductionBuildInfo{
  const vercelEnvironment=envValue(env.VERCEL_ENV);
  return ProductionBuildInfoSchema.parse({
    commitSha:envValue(env.VERCEL_GIT_COMMIT_SHA),
    commitRef:envValue(env.VERCEL_GIT_COMMIT_REF),
    vercelEnvironment:vercelEnvironment==="production"||vercelEnvironment==="preview"||vercelEnvironment==="development"
      ?vercelEnvironment
      :undefined,
    deploymentHost:envValue(env.VERCEL_URL),
    checkedAt:new Date().toISOString(),
  });
}
