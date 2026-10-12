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
});
