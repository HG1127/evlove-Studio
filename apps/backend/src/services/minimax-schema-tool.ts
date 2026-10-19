import {z} from "zod";
import type {ServerAiConfig} from "../server-env";
import {minimaxChatFinalOptions} from "./minimax-chat-final-channel";
type Direct=Pick<Extract<ServerAiConfig,{mode:"openai-compatible"}>,"mode"|"baseUrl"|"model"|"protocol"|"responseFormat">;
export const MINIMAX_SCHEMA_TOOL_VERSION="minimax-schema-result-v1";
const ResultSchema=z.object({name:z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/),schema:z.record(z.string(),z.unknown())});
export function usesMinimaxSchemaTool(config:Direct):boolean{
  return config.protocol!=="responses"&&(!config.responseFormat||config.responseFormat==="json-schema")&&minimaxChatFinalOptions(config).reasoning_split===true;
}
export function minimaxSchemaTool(schema:{name:string;schema:Record<string,unknown>}){
  const checked=ResultSchema.parse(schema);
  return{type:"function" as const,function:{name:checked.name,
    description:"Return the complete task result matching these parameters. This is an output-only result carrier; it performs no action.",parameters:checked.schema}};
}
export function minimaxSchemaToolInstruction(name:string):string{
  return "\nReturn the complete task result as the arguments of the single provided function "+JSON.stringify(name)+". This function only carries output; it performs no action. Do not call any other function or return multiple results. Preserve all original task rules, evidence and safety decisions. Arguments must be one complete JSON object matching the parameter schema.";
}
