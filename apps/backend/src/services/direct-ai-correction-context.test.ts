// @vitest-environment node
import {describe,expect,it} from "vitest";
import {buildDirectAiCorrectionContext,assertDirectAiCorrectionRequestBudget,DIRECT_AI_REJECTED_FINAL_MAX_BYTES,
  DIRECT_AI_CORRECTION_CONTEXT_MAX_BYTES,DIRECT_AI_CORRECTION_REQUEST_MAX_BYTES} from "./direct-ai-correction-context";
const context=(text:string)=>buildDirectAiCorrectionContext({text,kind:"invalid-syntax",apiKey:"fictional-secret-only"});
describe("private complete rejected final context",()=>{
  it("strips only outer reasoning and presentation while preserving literal text",()=>{
    const final='{"note":"中文 "quote" <think>literal</think>" invalid}';
    const parsed=JSON.parse(context('<think>private reasoning</think>\n'+ '```json\n'+final+'\n```'));
    expect(parsed).toEqual({schemaVersion:"untrusted-rejected-output-v1",failureKind:"invalid-syntax",rejectedFinalText:final});
    expect(JSON.stringify(parsed)).not.toContain("private reasoning");
  });
  it("round trips complete quotes, raw control characters and unicode as untrusted data",()=>{
    const final='{invalid "中文" \n \t " literal}';
    expect(JSON.parse(context(final)).rejectedFinalText).toBe(final);
  });
  it("admits the exact final UTF-8 limit without truncation",()=>{
    const final="x".repeat(DIRECT_AI_REJECTED_FINAL_MAX_BYTES);
    expect(JSON.parse(context(final)).rejectedFinalText).toBe(final);
  });
  it.each(["x".repeat(DIRECT_AI_REJECTED_FINAL_MAX_BYTES+1),"中".repeat(Math.floor(DIRECT_AI_REJECTED_FINAL_MAX_BYTES/3)+1)])("rejects complete final text over its UTF-8 budget",final=>{
    expect(()=>context(final)).toThrow();try{context(final);}catch(error){expect(error).toMatchObject({code:"AI_OUTPUT_CORRECTION_CONTEXT_TOO_LARGE"});expect(String(error)).not.toContain(final);}
  });
  it("counts expansion of the serialized context rather than only the final text",()=>{
    const final="\0".repeat(Math.ceil(DIRECT_AI_CORRECTION_CONTEXT_MAX_BYTES/6));
    expect(Buffer.byteLength(final)).toBeLessThan(DIRECT_AI_REJECTED_FINAL_MAX_BYTES);
    expect(Buffer.byteLength(JSON.stringify({rejectedFinalText:final}))).toBeGreaterThan(DIRECT_AI_CORRECTION_CONTEXT_MAX_BYTES);
    expect(()=>context(final)).toThrow();
  });
  it("refuses a known credential in final data without returning or redacting it",()=>{
    const marker='private rejected fictional-secret-only';
    try{context('{bad "'+marker+'"}');expect.fail("must reject");}catch(error){expect(error).toMatchObject({code:"AI_OUTPUT_CORRECTION_SECRET_PRESENT"});expect(String(error)).not.toContain(marker);expect(JSON.stringify(error)).not.toContain(marker);}
  });
  it("does not use reasoning-only output as correction material",()=>{
    expect(()=>context('<think>private reasoning</think>')).toThrow();
  });
  it("counts the full serialized request including evidence and media",()=>{
    expect(()=>assertDirectAiCorrectionRequestBudget("x".repeat(DIRECT_AI_CORRECTION_REQUEST_MAX_BYTES))).not.toThrow();
    try{assertDirectAiCorrectionRequestBudget("x".repeat(DIRECT_AI_CORRECTION_REQUEST_MAX_BYTES+1));expect.fail("must reject");}catch(error){expect(error).toMatchObject({code:"AI_OUTPUT_CORRECTION_REQUEST_TOO_LARGE"});}
  });
  it.each(['{"only":"fictional\\u002dsecret-only"}','{invalid "\\u0066ictional-secret-only"}'])("rejects Unicode-escaped credentials in valid or malformed final JSON",final=>{
    expect(final).not.toContain("fictional-secret-only");
    try{context(final);expect.fail("must reject");}catch(error){expect(error).toMatchObject({code:"AI_OUTPUT_CORRECTION_SECRET_PRESENT"});expect(JSON.stringify(error)).not.toContain(final);}
  });
  it("rejects slash-escaped credentials without changing the final data",()=>{
    expect(()=>buildDirectAiCorrectionContext({text:'{"only":"fictional\\/key"}',kind:"schema-shape",apiKey:"fictional/key"})).toThrow();
  });

  it("does not try to decode invalid uppercase JSON escapes or expose native parse excerpts",()=>{
    const final='{invalid "\\U002D \\N"}';
    expect(JSON.parse(context(final)).rejectedFinalText).toBe(final);
  });

});
