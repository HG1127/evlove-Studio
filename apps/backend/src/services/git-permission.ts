import type {EvolutionPermission,GitTargetActionRequest} from "@evolution/contracts";

export function gitActionPermission(action:GitTargetActionRequest["action"]):EvolutionPermission{
  switch(action){
    case "snapshot":
    case "validate":
    case "observe":
      return "data.read";
    case "mutate":
    case "open-pr":
      return "target.write";
    case "merge":
    case "rollback":
      return "release.execute";
  }
}
