import { defineEventHandler } from "nitro/h3";
import { EvolutionWorkflowCapabilitiesSchema } from "@evolution/contracts";
import { serverAiConfigured } from "../../../src/server-env";

const CONTROL_ACTIONS=["adopt-defaults","approve-contract","wait-human","complete","package"] as const;
const AI_ACTIONS=["understand","compile-contract","build-eval","distill","next-queue"] as const;
const CONDITIONAL_ACTIONS:string[]=["revalidate","run-campaign"];
const MIGRATION_PENDING_ACTIONS:string[]=[];

export default defineEventHandler(()=>{
  const ai=serverAiConfigured();
  const blockedActions=ai?[]:[
    ...AI_ACTIONS.map((action)=>({action,reason:"server-ai-not-configured"})),
    {action:"run-campaign",reason:"server-ai-not-configured"},
  ];
  const serverNativeActions=[
    ...CONTROL_ACTIONS,
    ...(ai?AI_ACTIONS:[]),
    ...(ai?["campaign-baseline","campaign-experiment","campaign-holdout","campaign-artifact-acceptance"]:[]),
  ];
  return EvolutionWorkflowCapabilitiesSchema.parse({
    available:true,
    fullAuto:false,
    durable:true,
    serverAi:ai,
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
