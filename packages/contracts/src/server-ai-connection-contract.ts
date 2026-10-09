import {z} from "zod";

export const ServerAiBaseUrlSchema=z.string().trim().min(1).max(2048).url().superRefine((value,ctx)=>{
  let url:URL;
  try{url=new URL(value);}catch{return;}
  if(!["http:","https:"].includes(url.protocol)||url.username||url.password||url.search||url.hash){
    ctx.addIssue({code:"custom",message:"Base URL 必须是 HTTP(S) API 地址，不能包含账号、密码、查询参数或片段。"});
  }
});

export const ServerAiConnectionSettingsSchema=z.object({
  connectionId:z.string().trim().min(1).max(120),
  label:z.string().trim().min(1).max(120),
  baseUrl:ServerAiBaseUrlSchema,
  model:z.string().trim().min(1).max(200),
  protocol:z.enum(["chat-completions","responses"]).default("chat-completions"),
  responseFormat:z.enum(["json-schema","json-object","prompt-json"]).default("json-object"),
});
export type ServerAiConnectionSettings=z.infer<typeof ServerAiConnectionSettingsSchema>;

export const ServerAiConnectionPutSchema=ServerAiConnectionSettingsSchema.extend({
  apiKey:z.string().trim().min(1).max(20000),
});
export type ServerAiConnectionPut=z.infer<typeof ServerAiConnectionPutSchema>;

export const ServerAiStoredConnectionSchema=ServerAiConnectionPutSchema.extend({
  version:z.literal("server-ai-connection-v1"),
});

export const ServerAiConnectionStatusSchema=z.object({
  storageConfigured:z.boolean(),
  configured:z.boolean(),
  connection:ServerAiConnectionSettingsSchema.optional(),
  revision:z.number().int().positive().optional(),
  message:z.string(),
});
export type ServerAiConnectionStatus=z.infer<typeof ServerAiConnectionStatusSchema>;
