import {createError} from "nitro/h3";
import type {EvolveProject,SandboxBrowserHealth,SandboxHealth} from "@evolution/contracts";
import {hasAmbiguousAutoProxyHtmlTarget} from "@evolution/core";
import {checkVercelSandboxBrowserHealth,checkVercelSandboxHealth,sandboxCredentialWindowIssue,type SandboxCredentialWindowIssue} from "@evolution/adapters/sandbox";
import {serverHtmlArtifactTargetEnabled} from "./server-html-artifact-execution";
import {assertServerHtmlCampaignAdmissionReady} from "./html-campaign-admission-readiness";
import {assertServerArtifactEvidenceReady} from "./artifact-evidence-readiness";

type HtmlProbePorts={
  credentials:(windowMs:number)=>SandboxCredentialWindowIssue|undefined;
  admission:()=>Promise<void>;
  evidence:(missionId:string)=>Promise<void>;
  sandbox:()=>Promise<SandboxHealth>;
  browser:()=>Promise<SandboxBrowserHealth>;
};

const defaultPorts:HtmlProbePorts={
  credentials:sandboxCredentialWindowIssue,
  admission:assertServerHtmlCampaignAdmissionReady,
  evidence:assertServerArtifactEvidenceReady,
  sandbox:checkVercelSandboxHealth,
  browser:checkVercelSandboxBrowserHealth,
};

/**
 * Before writing a Campaign Job for a standalone HTML Mission, verify that
 * the real isolated server-side Browser Runtime can execute. Code-ready alone,
 * stored screenshots and local Playwright smoke tests cannot authorize an
 * HTML Experiment/Hidden acceptance.
 *
 * This active, potentially metered preflight is only executed when an operator
 * explicitly starts/schedules a Workflow; it is never called by public
 * readiness, render, or ordinary mission reads.
 */
export async function assertServerHtmlBrowserExecutionReady(
  project:EvolveProject,
  ports:HtmlProbePorts=defaultPorts,
):Promise<void>{
  if(hasAmbiguousAutoProxyHtmlTarget(project)){
    throw createError({
      statusCode:422,
      statusMessage:"上传 HTML 文件的 Target 被旧版自动 Runner 探测错误切换为 HTTP Proxy；请恢复 Artifact Target 后重试",
      data:{code:"HTML_ARTIFACT_TARGET_BINDING_REQUIRED",
        action:"在项目高级设置中选择“恢复 HTML 文件 Target”，然后重试真实 Sandbox Browser 执行。原始文件及进化记录不会被删除。"},
    });
  }
  if(!serverHtmlArtifactTargetEnabled(project))return;

  const maxWallMinutes=project.campaign?.stopCriteria?.maxWallMinutes;
  const windowMs=maxWallMinutes===undefined?0:maxWallMinutes*60_000;
  const assertCredentialWindow=()=>{
    const credentialIssue=ports.credentials(windowMs);
    if(credentialIssue){
      throw createError({statusCode:503,
        statusMessage:"HTML Sandbox 凭据不能覆盖当前任务，进化任务尚未启动",
        data:{code:"HTML_SANDBOX_NOT_READY",credentialIssue:credentialIssue.code,
          ...(credentialIssue.expiresAt?{expiresAt:credentialIssue.expiresAt}:{}),
          action:credentialIssue.message},
      });
    }
  };
  assertCredentialWindow();

  // Fail before allocating billable resources when the durable database or evidence chain cannot finish the run.
  await ports.admission();
  await ports.evidence(project.id);

  let sandbox:SandboxHealth;
  try{
    sandbox=await ports.sandbox();
  }catch{
    throw createError({
      statusCode:503,
      statusMessage:"HTML Sandbox 运行环境检测未完成，进化任务尚未启动",
      data:{code:"HTML_SANDBOX_NOT_READY",
        action:"重新检查 Vercel Sandbox 授权和 Sandbox Health；不要把代码就绪当成运行通过。"},
    });
  }
  if(!sandbox.ready||!sandbox.policy.codeReady){
    const expired=sandbox.message.startsWith("VERCEL_OIDC_EXPIRED");
    const mismatched=/^VERCEL_(?:PROJECT|TEAM)_SCOPE_MISMATCH/.test(sandbox.message);
    throw createError({
      statusCode:503,
      statusMessage:expired
        ?"HTML Sandbox OIDC 凭证已过期，进化任务未启动"
        :mismatched
          ?"HTML Sandbox OIDC 的项目或团队范围不匹配，进化任务未启动"
          :"HTML Sandbox 尚未实际就绪，进化任务尚未启动",
      data:{code:"HTML_SANDBOX_NOT_READY",
        action:expired
          ?"请用有项目团队权限的 Vercel 账号重新拉取 OIDC 并重启 Nitro；不要覆盖 .env.local 中其他配置，也不要提交令牌。"
          :mismatched
            ?"请先确认当前 Vercel CLI 使用正确的 Project/Team 关联，并由团队管理员授予必要权限；不要将令牌替换为别的项目。"
            :"为此 Vercel 项目完成 Sandbox 授权（本地使用 Vercel CLI 登录及环境同步，部署使用受授权的 OIDC），随后重新执行 Sandbox Health。"},
    });
  }

  let browser:SandboxBrowserHealth;
  try{
    browser=await ports.browser();
  }catch{
    throw createError({
      statusCode:503,
      statusMessage:"HTML Browser Runtime 检测未完成，进化任务尚未启动",
      data:{code:"HTML_BROWSER_NOT_READY",
        action:"检查 Vercel Sandbox Chromium Runtime Snapshot 和 Browser Health，然后重新尝试。"},
    });
  }
  if(!browser.ready||!browser.previewHealthy||!browser.browserStepsVerified||browser.browserStepsExecuted<1){
    throw createError({
      statusCode:503,
      statusMessage:"HTML Browser Runtime 缺少可执行浏览器断言，进化任务尚未启动",
      data:{code:"HTML_BROWSER_NOT_READY",
        action:"在进化闭环完整性中心完成 Browser Health 的真实 Chromium Steps 检测；不得以截图或本地演示代替。"},
    });
  }
  // Admission and actual VM probes can be slow; check again immediately before Job creation.
  assertCredentialWindow();
}
