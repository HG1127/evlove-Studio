import {defineEventHandler} from "nitro/h3";
import {requireGovernedEvolutionPermission} from "../../../src/services/security-policy";
import reconcileArtifact from "./artifacts/reconcile.post";

// Legacy Evidence registration is restricted to exact stored Artifact recovery.
export default defineEventHandler(async(event)=>{
  await requireGovernedEvolutionPermission(event,"mission.write");
  return reconcileArtifact(event);
});
