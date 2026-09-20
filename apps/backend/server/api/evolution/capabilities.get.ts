import { defineEventHandler } from "nitro/h3";
import { EvolutionWorkflowCapabilitiesSchema } from "@evolution/contracts";
import { serverAiConfigured } from "../../../src/server-env";

const CONTROL_ACTIONS=["adopt-defaults","approve-contract","wait-human","complete","package"] as const;
const AI_ACTIONS=["understand","compile-contract","build-eval","distill","next-queue"] as const;
const CONDITIONAL_ACTIONS:string[]=["revalidate"];
const MIGRATION_PENDING_ACTIONS:string[]=["run-campaign"];

export default defineEventHandler(()=>{
  const ai=serverAiConfigured();
  const blockedActions=ai?[]:AI_ACTIONS.map((action)=>({action,reason:"server-ai-not-configured"}));
  const serverNativeActions=[
    ...CONTROL_ACTIONS,
    ...(ai?AI_ACTIONS:[]),
  ];
  return EvolutionWorkflowCapabilitiesSchema.parse({
    available:true,
    fullAuto:ai&&CONDITIONAL_ACTIONS.length===0&&MIGRATION_PENDING_ACTIONS.length===0,
    durable:true,
    serverAi:ai,
    serverNativeActions,
    conditionalActions:[...CONDITIONAL_ACTIONS],
    blockedActions,
    migrationPendingActions:[...MIGRATION_PENDING_ACTIONS],
    pendingActions:[
      ...blockedActions.map((item)=>item.action),
      ...CONDITIONAL_ACTIONS,
      ...MIGRATION_PENDING_ACTIONS,
    ],
  });
});
