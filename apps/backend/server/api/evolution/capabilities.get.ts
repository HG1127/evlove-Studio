import { defineEventHandler } from "nitro/h3";
import { EvolutionWorkflowCapabilitiesSchema } from "@evolution/contracts";
import { githubTargetConfigured, githubWebhookConfigured, serverAiConfigured, serverSupabaseConfigured, serverSupabaseSecureConfigured, targetProxyCapabilities, vercelReleaseWriteConfigured } from "../../../src/server-env";
import {getSecurityCapabilities,requireGovernedEvolutionPermission} from "../../../src/services/security-policy";

const CONTROL_ACTIONS=["adopt-defaults","approve-contract","wait-human","complete","package"] as const;
const AI_ACTIONS=["understand","compile-contract","build-eval","distill","next-queue"] as const;
const CONDITIONAL_ACTIONS:string[]=["revalidate","run-campaign","run-release","reconcile-release"];
const MIGRATION_PENDING_ACTIONS:string[]=[];

export default defineEventHandler(async(event)=>{
  await requireGovernedEvolutionPermission(event,"data.read");
  const ai=serverAiConfigured();
  const dataPlane=serverSupabaseConfigured();
  const secureDataPlane=serverSupabaseSecureConfigured();
  const releaseWrite=vercelReleaseWriteConfigured();
  const gitConfigured=githubTargetConfigured();
  const gitWebhook=githubWebhookConfigured();
  const targetProxy=targetProxyCapabilities();
  const security=getSecurityCapabilities();
  const blockedActions=[
    ...(!ai?[
      ...AI_ACTIONS.map((action)=>({action,reason:"server-ai-not-configured"})),
      {action:"run-campaign",reason:"server-ai-not-configured"},
    ]:[]),
    ...(!releaseWrite?[
      {action:"run-release",reason:"vercel-release-credential-required"},
      {action:"reconcile-release",reason:"vercel-release-credential-required"},
    ]:[]),
    ...(!dataPlane?[
      {action:"revalidate",reason:"server-data-plane-not-configured"},
      {action:"run-campaign",reason:"server-data-plane-not-configured"},
    ]:[]),
  ];
  const configBlocked=[
    ...(!ai?[{capability:"server-ai",reason:"server-ai-not-configured"}]:[]),
    ...(!releaseWrite?[{capability:"vercel-release-write",reason:"vercel-release-credential-required"}]:[]),
    ...(!dataPlane?[{capability:"server-data-plane",reason:"supabase-server-config-required"}]:[]),
    ...(dataPlane&&!secureDataPlane?[{capability:"server-data-plane-security",reason:"server-only-supabase-secret-required-for-production"}]:[]),
    ...(!security.productionSafe?[{capability:"rbac-identity",reason:"trusted-signed-actor-required-for-production"}]:[]),
    ...(!gitConfigured?[{capability:"git-target",reason:"github-token-and-repo-allowlist-required"}]:[]),
    ...(!gitWebhook?[{capability:"git-webhook",reason:"github-webhook-secret-required"}]:[]),
  ];
  const externalCapabilityBlocked=[
    {capability:"online-release-authorization",reason:"human-release-ready-approval-required"},
  ];
  const codeReady=MIGRATION_PENDING_ACTIONS.length===0;
  const offlineFullAuto=codeReady&&ai&&dataPlane;
  const releaseOrchestrationReady=true;
  const releaseReconciliationReady=releaseWrite;
  const onlinePostApprovalAuto=offlineFullAuto&&releaseWrite&&releaseOrchestrationReady&&releaseReconciliationReady;
  const onlineFullAuto=onlinePostApprovalAuto&&externalCapabilityBlocked.length===0;
  const serverNativeActions=[
    ...CONTROL_ACTIONS,
    ...(ai?AI_ACTIONS:[]),
    ...(ai?["campaign-baseline","campaign-experiment","campaign-holdout","campaign-artifact-acceptance"]:[]),
    ...(dataPlane?["campaign-schedule"]:[]),
    ...(releaseWrite?["run-release","reconcile-release"]:[]),
  ];
  return EvolutionWorkflowCapabilitiesSchema.parse({
    available:true,
    fullAuto:offlineFullAuto&&onlineFullAuto,
    durable:true,
    serverAi:ai,
    backend:{
      dataPlaneConfigured:dataPlane,
      secureDataPlaneCredential:secureDataPlane,
      httpDataPlaneCodeReady:true,
      artifactStoreConfigured:dataPlane,
      artifactRendererCodeReady:true,
      artifactRendererConfigured:dataPlane,
      sourceParseCodeReady:true,
      sourceParseConfigured:dataPlane,
      serverAiCodeReady:true,
      sandboxCodeReady:true,
      browserCodeReady:true,
      releaseCodeReady:true,
      gitTargetCodeReady:true,
      gitTargetConfigured:gitConfigured,
      gitWebhookConfigured:gitWebhook,
      targetProxyCodeReady:true,
      targetRunConfigured:targetProxy.runConfigured,
      targetReleaseConfigured:targetProxy.releaseConfigured,
      securityCodeReady:true,
      securityConfigured:security.configured,
      securityProductionSafe:security.productionSafe,
    },
    closure:{
      codeReady,
      offlineFullAuto,
      onlineFullAuto,
      releaseOrchestrationReady,
      releaseReconciliationReady,
      onlinePostApprovalAuto,
      configBlocked,
      externalCapabilityBlocked,
    },
    serverNativeActions,
    conditionalActions:[...CONDITIONAL_ACTIONS],
    blockedActions,
    migrationPendingActions:[...MIGRATION_PENDING_ACTIONS],
    pendingActions:[...new Set([
      ...blockedActions.map((item)=>item.action),
      ...MIGRATION_PENDING_ACTIONS,
    ])],
  });
});
