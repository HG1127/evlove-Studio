import { defineEventHandler } from "nitro/h3";
import { EvolutionWorkflowCapabilitiesSchema } from "@evolution/contracts";
import { serverAiConfigured } from "../../../src/server-env";

const CONTROL_ACTIONS=["adopt-defaults","approve-contract","wait-human","complete","package"] as const;
const AI_ACTIONS=["understand","compile-contract","build-eval","distill","next-queue"] as const;
const PENDING_ACTIONS:string[]=["run-campaign","revalidate"];

export default defineEventHandler(()=>{
  const ai=serverAiConfigured();
  const serverNativeActions=[
    ...CONTROL_ACTIONS,
    ...(ai?AI_ACTIONS:[]),
  ];
  return EvolutionWorkflowCapabilitiesSchema.parse({
    available:true,
    fullAuto:ai&&PENDING_ACTIONS.length===0,
    durable:true,
    serverAi:ai,
    serverNativeActions,
    pendingActions:ai?[...PENDING_ACTIONS]:[...AI_ACTIONS,...PENDING_ACTIONS],
  });
});
