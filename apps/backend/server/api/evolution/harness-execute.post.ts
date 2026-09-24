import {defineEventHandler} from "nitro/h3";
import {requireGovernedEvolutionPermission} from "../../../src/services/security-policy";
import startDurableMissionWorkflow from "./start.post";

// The legacy execution URL starts the same durable Workflow as /start.
export default defineEventHandler(async(event)=>{
  await requireGovernedEvolutionPermission(event,"mission.execute");
  return startDurableMissionWorkflow(event);
});
