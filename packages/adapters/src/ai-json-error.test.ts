import { describe, expect, it } from "vitest";
import { parseStructuredAiOutput } from "./ai-structured-output";
import { StructuredAiJsonError, type StructuredAiJsonFailureKind } from "./ai-json-error";
const samples: Array<[string, StructuredAiJsonFailureKind]> = [
 ['Here is the result: {"private":"secret"}', "non-json-envelope"],
 ['{"private":"secret"}\n{"second":true}', "trailing-content"],
 ['{"private":"line one\nline two"}', "unescaped-control"],
 ['{"private":"line one\tline two"}', "unescaped-control"],
 ['{"private":"\\x20"}', "invalid-escape"],
 ['{"private":"\\u12QQ"}', "invalid-escape"],
 ['{"private":"unfinished', "unfinished-string"],
 ['{"private":"unfinished\\', "unfinished-string"],
 ['{"private":[1,2]', "unfinished-root"],
 ['{"private":]', "invalid-syntax"],
 ['{"private":secret}', "invalid-syntax"],
];
describe("safe structured AI JSON diagnostics", () => {
 it.each(samples)("classifies syntax without disclosing response content: %s", (output, kind) => {
  const error=(()=>{try{parseStructuredAiOutput(output);}catch(error){return error;}})();
  expect(error).toBeInstanceOf(StructuredAiJsonError);expect(error).toMatchObject({code:"AI_OUTPUT_INVALID_JSON",kind});
  const surfaced=JSON.stringify(error)+(error as Error).message+(error as Error).stack;
  expect(surfaced).not.toContain("private");expect(surfaced).not.toContain("secret");expect(surfaced).not.toContain("line one");expect(surfaced).not.toMatch(/position \d+/);
 });
 it("classifies only final text after reasoning and an outer fence",()=>{
  const fence=String.fromCharCode(96).repeat(3);
  expect(()=>parseStructuredAiOutput('<think>private thought</think>\n'+fence+'json\n{"x":"bad\nnewline"}\n'+fence)).toThrow(expect.objectContaining({kind:"unescaped-control"}));
 });
 it.each([{content:'literal "\\x20", {nested}, <think>literal</think>',count:1},{content:"\u0000\n\t\r\\\"/",count:2},{content:"\\u12QQ",count:3}])("does not repair escaped literal artifact content",value=>{
  expect(parseStructuredAiOutput(JSON.stringify(value))).toEqual(value);
 });
 it("allows valid primitive JSON for the separate task schema",()=>{expect(parseStructuredAiOutput("42")).toBe(42);expect(parseStructuredAiOutput("null")).toBe(null);});
});
