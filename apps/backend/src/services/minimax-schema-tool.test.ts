// @vitest-environment node
import {describe,expect,it} from "vitest";
import {jsonSchemas} from "@evolution/contracts";
import {minimaxSchemaTool,usesMinimaxSchemaTool} from "./minimax-schema-tool";
const config={mode:"openai-compatible" as const,apiKey:"fictional",baseUrl:"https://api.minimaxi.com/v1",model:"MiniMax-M2.7",timeoutMs:1000,protocol:"chat-completions" as const,responseFormat:"json-schema" as const};
describe("native schema carrier route scope",()=>{
  it.each([{}, {responseFormat:undefined}, {protocol:undefined}, {baseUrl:"https://api.minimax.io/v1/"}, {model:"MiniMax-M2.7-highspeed"}])("selects only documented native schema routes %#",change=>expect(usesMinimaxSchemaTool({...config,...change})).toBe(true));
  it.each([{protocol:"responses" as const},{responseFormat:"json-object" as const},{responseFormat:"prompt-json" as const},{model:"other"},{baseUrl:"https://api.minimaxi.com.evil.test/v1"},{baseUrl:"https://custom.example.test/v1"},{baseUrl:"http://api.minimaxi.com/v1"},{baseUrl:"https://api.minimaxi.com:8443/v1"},{baseUrl:"https://api.minimaxi.com/proxy/v1"},{baseUrl:"https://u:p@api.minimaxi.com/v1"},{baseUrl:"https://api.minimaxi.com/v1?x=1"}])("preserves other explicit transports/formats %#",change=>expect(usesMinimaxSchemaTool({...config,...change})).toBe(false));
  it("preserves the complete task parameter schema and caller object",()=>{
    const before=structuredClone(jsonSchemas.evaluate);const tool=minimaxSchemaTool(jsonSchemas.evaluate);
    expect(tool.function.parameters).toEqual(before.schema);expect(jsonSchemas.evaluate).toEqual(before);expect(tool).not.toHaveProperty("execute");
  });
  it("rejects unsafe function names before transport",()=>expect(()=>minimaxSchemaTool({name:"../action",schema:{}})).toThrow());
});
