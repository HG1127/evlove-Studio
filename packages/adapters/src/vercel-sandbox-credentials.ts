import {SandboxAuthorizationDiagnosticSchema,type SandboxAuthorizationDiagnostic} from "@evolution/contracts";

/** Passive, secret-free diagnostics for project-scoped Vercel Sandbox OIDC.
 * JWT claims here are deliberately NOT signature-validated and MUST NEVER be
 * used to grant execution; they can only deny obviously stale/mis-scoped calls.
 */
export type SandboxCredentialIssue={
  code:"VERCEL_OIDC_EXPIRED"|"VERCEL_OIDC_INVALID"|"VERCEL_OIDC_NOT_YET_VALID"
    |"VERCEL_PROJECT_SCOPE_MISMATCH"|"VERCEL_TEAM_SCOPE_MISMATCH"
    |"VERCEL_ACCESS_TOKEN_INCOMPLETE";
  message:string;
  expiresAt?:string;
};

/**
 * Alternative for a long-lived, non-Vercel host. Vercel Sandbox SDK v3.3.0
 * accepts token+projectId+teamId as explicit call parameters, ahead of OIDC.
 * Opt-in is mandatory: adding unrelated VERCEL_* env vars must not silently
 * change the authorization principal for running untrusted user code.
 */
function accessTokenConfigurationIssue(
  env:Readonly<Record<string,string|undefined>>,
):SandboxCredentialIssue|undefined{
  if(env.EVOLUTION_SANDBOX_AUTH_MODE!=="access-token")return undefined;
  const token=env.VERCEL_TOKEN?.trim();
  const projectId=env.VERCEL_PROJECT_ID?.trim();
  const teamId=(env.VERCEL_TEAM_ID??env.VERCEL_ORG_ID)?.trim();
  if(!token||!/^prj_[A-Za-z0-9]+$/.test(projectId??"")
    ||!/^team_[A-Za-z0-9]+$/.test(teamId??"")
    ||(env.VERCEL_TEAM_ID&&env.VERCEL_ORG_ID
      &&env.VERCEL_TEAM_ID!==env.VERCEL_ORG_ID)){
    return {code:"VERCEL_ACCESS_TOKEN_INCOMPLETE",
      message:"已选择 Vercel Access Token 模式，但 VERCEL_TOKEN、VERCEL_TEAM_ID（或 VERCEL_ORG_ID）和 VERCEL_PROJECT_ID 未完整且一致地配置。请由目标团队管理员授予项目访问权限。"};
  }
  return undefined;
}

/** Explicit SDK credentials stay on the Node server; never inject into a VM. */
export function getExplicitSandboxCredentials(
  env:Readonly<Record<string,string|undefined>>=process.env,
):{token:string;teamId:string;projectId:string}|undefined{
  if(env.EVOLUTION_SANDBOX_AUTH_MODE!=="access-token")return undefined;
  const issue=accessTokenConfigurationIssue(env);
  if(issue)throw new Error(issue.message);
  return {
    token:env.VERCEL_TOKEN!.trim(),
    teamId:(env.VERCEL_TEAM_ID??env.VERCEL_ORG_ID)!.trim(),
    projectId:env.VERCEL_PROJECT_ID!.trim(),
  };
}

export function sandboxCredentialIssue(
  env:Readonly<Record<string,string|undefined>>=process.env,
  nowMs=Date.now(),
):SandboxCredentialIssue|undefined{
  // An explicitly configured Service Token is independent of an expired local
  // OIDC and is passed directly to the Sandbox SDK. An incomplete alternate
  // credential must fail closed; never fall through to the wrong OIDC identity.
  if(env.EVOLUTION_SANDBOX_AUTH_MODE==="access-token"){
    return accessTokenConfigurationIssue(env);
  }
  const token=env.VERCEL_OIDC_TOKEN?.trim();
  if(!token)return undefined; // Deployment OIDC may be injected by the platform.
  const segments=token.split(".");
  if(segments.length!==3||segments.some(part=>!part)){
    return {code:"VERCEL_OIDC_INVALID",
      message:"本地 VERCEL_OIDC_TOKEN 不是有效的 JWT 结构；请使用正确团队的 Vercel CLI 重新拉取开发环境凭证。"};
  }
  let claims:Record<string,unknown>;
  try{
    const parsed=JSON.parse(Buffer.from(segments[1]!,"base64url").toString("utf8")) as unknown;
    if(!parsed||typeof parsed!=="object"||Array.isArray(parsed))throw Error("invalid payload");
    claims=parsed as Record<string,unknown>;
  }catch{
    return {code:"VERCEL_OIDC_INVALID",
      message:"本地 VERCEL_OIDC_TOKEN 不能解析；请重新授权并拉取开发环境凭证。"};
  }
  const exp=claims.exp;
  if(typeof exp!=="number"||!Number.isFinite(exp)||exp<1e9){
    return {code:"VERCEL_OIDC_INVALID",message:"OIDC 缺少有效到期时间；拒绝尝试创建云端 Sandbox。"};
  }
  const expiry=new Date(exp*1000).toISOString();
  if(exp*1000<=nowMs+120_000){
    return {code:"VERCEL_OIDC_EXPIRED",expiresAt:expiry,
      message:"VERCEL_OIDC_TOKEN 已过期或即将到期（UTC "+expiry+"）；请用可访问该项目团队的 Vercel CLI 重新执行 vercel env pull 并重启本地 Nitro。"};
  }
  const nbf=claims.nbf;
  if(typeof nbf==="number"&&Number.isFinite(nbf)&&nbf*1000>nowMs+60_000){
    return {code:"VERCEL_OIDC_NOT_YET_VALID",expiresAt:expiry,
      message:"本地 OIDC 凭证尚未生效，请核对系统时间和 Vercel 账号权限。"};
  }
  const expectedProject=env.VERCEL_PROJECT_ID?.trim();
  if(expectedProject&&typeof claims.project_id==="string"&&claims.project_id!==expectedProject){
    return {code:"VERCEL_PROJECT_SCOPE_MISMATCH",expiresAt:expiry,
      message:"OIDC 凭证所属 Project 与运行环境配置不一致；请在正确的 Vercel 项目下重新关联并拉取凭证。"};
  }
  const expectedTeam=(env.VERCEL_TEAM_ID??env.VERCEL_ORG_ID)?.trim();
  if(expectedTeam&&typeof claims.owner_id==="string"&&claims.owner_id!==expectedTeam){
    return {code:"VERCEL_TEAM_SCOPE_MISMATCH",expiresAt:expiry,
      message:"OIDC 凭证所属 Team 与运行环境不一致；请使用目标项目所属团队的账号重新授权。"};
  }
  return undefined; // Not proof of provider authorization; health probe is still required.
}

/** Read-only configuration report. Never returns an OIDC bearer token or asserts provider authorization. */
export function getVercelSandboxAuthorizationDiagnostic(
  env:Readonly<Record<string,string|undefined>>=process.env,
  nowMs=Date.now(),
):SandboxAuthorizationDiagnostic{
  const issue=sandboxCredentialIssue(env,nowMs);
  const oidcPresent=Boolean(env.VERCEL_OIDC_TOKEN?.trim());
  const serviceMode=env.EVOLUTION_SANDBOX_AUTH_MODE==="access-token";
  const state:SandboxAuthorizationDiagnostic["state"]=issue
    ? issue.code==="VERCEL_ACCESS_TOKEN_INCOMPLETE"?"access-token-incomplete"
      :issue.code==="VERCEL_OIDC_EXPIRED"?"expired"
      :issue.code==="VERCEL_OIDC_NOT_YET_VALID"?"not-yet-valid"
      :issue.code==="VERCEL_OIDC_INVALID"?"invalid"
      :"scope-mismatch"
    :serviceMode?"access-token-unverified"
      :!oidcPresent&&!env.VERCEL_ENV?"missing-local-oidc":"unverified";
  const nextAction=issue?.message
    ??(state==="access-token-unverified"
      ?"已配置 Access Token 与项目/团队 ID，但尚未通过 Vercel 服务端验证。请由具有执行权限的操作者主动执行 Sandbox Health。"
      :state==="missing-local-oidc"
      ?"请先使用有项目团队权限的 Vercel CLI 执行 vercel login、vercel link、vercel env pull，再重启 Nitro；不要在聊天中发送 Token。"
      :"该凭证尚未通过 Vercel 服务端验证。请以目标团队身份运行 Sandbox Health；若返回 403，请联系该项目团队管理员授权。");
  return SandboxAuthorizationDiagnosticSchema.parse({
    probeMode:"passive-config",
    checkedAt:new Date(nowMs).toISOString(),
    state,oidcPresent,providerVerified:false,
    ...(issue?.code?{issueCode:issue.code}:{}),
    ...(issue?.expiresAt?{expiresAt:issue.expiresAt}:{}),
    message:issue
      ?"检测到本地 Sandbox 授权配置阻断："+issue.code
      :state==="missing-local-oidc"
        ?"本地未检测到 Vercel OIDC（部署环境可能使用平台自动颁发的身份）"
        :state==="access-token-unverified"
          ?"Access Token 三项配置已完整，尚未进行 Vercel 服务端权限检查，不能标记 Sandbox 为可用"
          :"配置初检未发现明确的无效 OIDC，但尚未验证云端 Sandbox 授权与可执行性",
    nextAction,
  });
}
