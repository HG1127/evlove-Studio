import type {ConnectorLifecycleOperation,EvolutionPermission} from "@evolution/contracts";

export function connectorOperationPermission(operation:ConnectorLifecycleOperation):EvolutionPermission{
  switch(operation){
    case "read":
    case "snapshot":
    case "observe":
      return "data.read";
    case "validate":
      return "target.execute";
    case "mutate":
      return "target.write";
    case "deploy":
    case "rollback":
      return "release.execute";
  }
}
