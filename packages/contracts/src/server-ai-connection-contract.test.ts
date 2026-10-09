import {describe,expect,it} from "vitest";
import {ServerAiConnectionPutSchema,ServerAiConnectionSettingsSchema,ServerAiConnectionStatusSchema} from "./server-ai-connection-contract";

const input={connectionId:"mine",label:"任意接口",baseUrl:"https://model.example.test/v1",model:"my-model-id",apiKey:"private"};
describe("custom server model connection boundary",()=>{
  it("allows arbitrary provider model IDs and defaults to common OpenAI-compatible chat JSON",()=>{
    expect(ServerAiConnectionPutSchema.parse(input)).toMatchObject({
      model:"my-model-id",protocol:"chat-completions",responseFormat:"json-object",
    });
  });
  it.each(["","not-a-url","https://","file:///secrets","ftp://example.test","https://user:password@example.test","https://example.test/v1?key=secret","https://example.test/#fragment"])("rejects unsafe API address %s",(baseUrl)=>{
    expect(ServerAiConnectionPutSchema.safeParse({...input,baseUrl}).success).toBe(false);
  });
  it("rejects incomplete credentials and oversized settings",()=>{
    expect(ServerAiConnectionPutSchema.safeParse({...input,apiKey:" "}).success).toBe(false);
    expect(ServerAiConnectionPutSchema.safeParse({...input,model:" "}).success).toBe(false);
    expect(ServerAiConnectionPutSchema.safeParse({...input,apiKey:"x".repeat(20001)}).success).toBe(false);
  });
  it("strips API keys from both settings and query-response contracts",()=>{
    expect(ServerAiConnectionSettingsSchema.parse(input)).not.toHaveProperty("apiKey");
    const response=ServerAiConnectionStatusSchema.parse({
      configured:true,storageConfigured:true,connection:input,revision:1,message:"configured",
    });
    expect(JSON.stringify(response)).not.toContain('"apiKey"');
  });
});
