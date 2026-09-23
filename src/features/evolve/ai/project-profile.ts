import type {ProjectAiProfile,ProjectModelRoute} from "../schemas";
import {listTestedModelChoices} from "./providers/registry";

export function defaultProjectAiProfile():ProjectAiProfile{
  const choices=listTestedModelChoices();
  if(!choices.length)return {mode:"global"};
  const primary=choices[0]!;
  const route:ProjectModelRoute={
    connectionId:primary.connectionId,
    model:primary.model,
    label:primary.label,
  };
  return {mode:"project",primary:route,judge:route,builder:route,copilot:route};
}
