import {describe,expect,it} from "vitest";
import {parseStructuredAiOutput} from "./ai-structured-output";

const result={summary:'保留 <think>{example}</think> 和 ``` 原文',items:[{id:"A",ok:true}]};
const json=JSON.stringify(result);
describe("structured AI final output",()=>{
  it.each([
    json,
    `\ufeff  ${json}  `,
    `<think>Reason about {"invented":"wrong"} first.</think>\n${json}`,
    `<THINK>First</THINK>\n<think>Second</think>\n${json}`,
    `\`\`\`json\n${json}\n\`\`\``,
    `<think>Compare schemas.</think>\n\`\`\`JSON\n${json}\n\`\`\``,
  ])("parses the final JSON without changing literal artifact content",(output)=>{
    expect(parseStructuredAiOutput(output)).toEqual(result);
  });
  it.each([
    ["<think>{\"invented\":true}","AI_OUTPUT_INCOMPLETE"],
    ["<think>{\"invented\":true}</think>","AI_OUTPUT_MISSING_FINAL"],
    ["", "AI_OUTPUT_MISSING_FINAL"],
    ['{"summary":"truncated"',"AI_OUTPUT_INVALID_JSON"],
    ['{"summary":"one"} {"summary":"two"}',"AI_OUTPUT_INVALID_JSON"],
    ['<html>{"invented":true}</html>',"AI_OUTPUT_INVALID_JSON"],
  ])("rejects incomplete, ambiguous or nonfinal content",(output,code)=>{
    expect(()=>parseStructuredAiOutput(output)).toThrow(expect.objectContaining({code}));
  });
  it("does not leak a raw model response through JSON syntax errors",()=>{
    const output="provider-secret and private source text";
    try{parseStructuredAiOutput(output);throw new Error("unexpected success");}
    catch(error){expect((error as Error).message).not.toContain(output);}
  });
  it("reports an extra object close at an array boundary without retaining model text",()=>{
    const output='{"items":[{"rationale":"PRIVATE_MODEL_TEXT"}}]}';
    try{parseStructuredAiOutput(output);throw new Error("unexpected success");}
    catch(error){
      expect(error).toMatchObject({code:"AI_OUTPUT_INVALID_JSON",validationIssues:[expect.stringContaining("expected comma or closing square bracket")]});
      expect(JSON.stringify(error)).toContain("got closing brace");
      expect(JSON.stringify(error)).not.toMatch(/PRIVATE_MODEL_TEXT|rationale/);
    }
  });
  it("reports a missing object separator without including either private value",()=>{
    const output='{"first":"PRIVATE_FIRST" "second":"PRIVATE_SECOND"}';
    try{parseStructuredAiOutput(output);throw new Error("unexpected success");}
    catch(error){expect(error).toMatchObject({validationIssues:[expect.stringContaining("expected comma or closing brace")]});expect(JSON.stringify(error)).not.toMatch(/PRIVATE|first|second/);}
  });
  it("keeps syntax diagnostics bound to the final JSON after presentation wrappers",()=>{
    const output='<think>PRIVATE_REASONING</think>\n```json\n{"items":[{"value":"PRIVATE_VALUE"}}]}\n```';
    try{parseStructuredAiOutput(output);throw new Error("unexpected success");}
    catch(error){expect(error).toMatchObject({validationIssues:[expect.stringContaining("JSON syntax")]});expect(JSON.stringify(error)).not.toMatch(/PRIVATE|think|value/);}
  });
  it("does not accept syntax that could be repaired by removing a single brace",()=>{
    expect(()=>parseStructuredAiOutput('{"items":[{"ok":true}}]}')).toThrow(expect.objectContaining({code:"AI_OUTPUT_INVALID_JSON"}));
  });
});
