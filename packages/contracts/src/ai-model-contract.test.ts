import {describe,expect,it} from "vitest";
import {AiModelIdSchema} from "./ai-model-contract";
import {ServerAiConnectionSettingsSchema} from "./server-ai-connection-contract";

describe("opaque model ID boundary",()=>{
  it.each(["x","llm","GPT","本地","provider/llm","o3","x".repeat(200)])("retains exact committed model %s",model=>{
    expect(AiModelIdSchema.parse(model)).toBe(model);
    expect(ServerAiConnectionSettingsSchema.parse({connectionId:"synthetic",label:"Synthetic",baseUrl:"https://provider.example.test/v1",model}).model).toBe(model);
  });
  it("normalizes surrounding whitespace consistently with backend settings",()=>{
    expect(AiModelIdSchema.parse("  llm  ")).toBe("llm");
  });
  it.each(["","   ","x".repeat(201),null,123])("rejects an absent or oversized ID",model=>{
    expect(AiModelIdSchema.safeParse(model).success).toBe(false);
  });
});