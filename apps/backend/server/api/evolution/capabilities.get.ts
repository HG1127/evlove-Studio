import { defineEventHandler } from "nitro/h3";
import { EvolutionWorkflowCapabilitiesSchema } from "@evolution/contracts";
import { serverAiConfigured, vercelReleaseWriteConfigured } from "../../../src/server-env";

const CONTROL_ACTIONS=["adopt-defaults","approve-contract","wait-human","complete","package"] as const;
const AI_ACTIONS=["understand","compile-contract","build-eval","distill","next-queue"] as const;
const CONDITIONAL_ACTIONS:string[]=["revalidate","run-campaign","run-release","reconcile-release"];
const MIGRATION_PENDING_ACTIONS:string[]=[];

export default defineEventHandler(()=>{
  const ai=serverAiConfigured();
  const releaseWrite=vercelReleaseWriteConfigured();
  const blockedActions=[
    ...(!ai?[
      ...AI_ACTIONS.map((action)=>({action,reason:"server-ai-not-configured"})),
      {action:"run-campaign",reason:"server-ai-not-configured"},
    ]:[]),
    ...(!releaseWrite?[
      {action:"run-release",reason:"vercel-release-credential-required"},
      {action:"reconcile-release",reason:"vercel-release-credential-required"},
    ]:[]),
  ];
  const configBlocked=[
    ...(!ai?[{capability:"server-ai",reason:"server-ai-not-configured"}]:[]),
    ...(!releaseWrite?[{capability:"vercel-release-write",reason:"vercel-release-credential-required"}]:[]),
  ];
  const externalCapabilityBlocked=[
    {capability:"online-release-authorization",reason:"human-release-ready-approval-required"},
    {capability:"preview-deployment-binding",reason:"explicit-preview-deployment-binding-required"},
  ];
  const codeReady=MIGRATION_PENDING_ACTIONS.length===0;
  const offlineFullAuto=codeReady&&ai;
  const releaseOrchestrationReady=true;
  const releaseReconciliationReady=releaseWrite;
  const onlinePostApprovalAuto=offlineFullAuto&&releaseWrite&&releaseOrchestrationReady&&releaseReconciliationReady;
  const onlineFullAuto=onlinePostApprovalAuto&&externalCapabilityBlocked.length===0;
  const serverNativeActions=[
    ...CONTROL_ACTIONS,
    ...(ai?AI_ACTIONS:[]),
    ...(ai?["campaign-baseline","campaign-experiment","campaign-holdout","campaign-artifact-acceptance"]:[]),
    ...(releaseWrite?["run-release","reconcile-release"]:[]),
  ];
  return EvolutionWorkflowCapabilitiesSchema.parse({
    available:true,
    fullAuto:offlineFullAuto&&onlineFullAuto,
    durable:true,
    serverAi:ai,
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
      ...CONDITIONAL_ACTIONS,
      ...MIGRATION_PENDING_ACTIONS,
    ])],
  });
});
