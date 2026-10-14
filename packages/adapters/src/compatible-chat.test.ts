import {describe,expect,it} from "vitest";
import {readCompatibleChatOutput} from "./compatible-chat";
describe("compatible Chat envelope decoder",()=>{
 it.each([undefined,null,"stop","provider_eos"])("preserves compatible final text with finish reason %s",finish_reason=>{
  expect(readCompatibleChatOutput({choices:[{finish_reason,message:{content:"  final  "}}]})).toBe("  final  ");
 });
 it("filters non-text parts and keeps omitted-type legacy text",()=>{
  expect(readCompatibleChatOutput({choices:[{message:{content:[{type:"image",text:"ignored"},{text:"one"},{type:"output_text",text:"two"}]}}]})).toBe("onetwo");
 });
 it.each([{choices:"bad"},{choices:[{message:{content:123}}]},{choices:[{message:{content:"valid"}}],usage:"bad"},{error:"bad"},{output_text:"valid",output:"bad"}])("rejects malformed consumed fields",body=>expect(()=>readCompatibleChatOutput(body,{allowResponsesShape:true})).toThrow());
 it.each([{choices:[{message:{content:"final",tool_calls:[{id:"tool"}]}}]},{choices:[{message:{content:"final",function_call:{name:"tool"}}}]},{choices:[{message:{content:"final"}}],status:"failed"}])("rejects nonfinal tool or failed replies",body=>expect(()=>readCompatibleChatOutput(body)).toThrow());
 it("keeps Responses-shape compatibility opt-in and validates completion",()=>{
  const body={status:"completed",output_text:"final"};expect(()=>readCompatibleChatOutput(body)).toThrow();
  expect(readCompatibleChatOutput(body,{allowResponsesShape:true})).toBe("final");
  expect(()=>readCompatibleChatOutput({...body,status:"incomplete"},{allowResponsesShape:true})).toThrow();
 });
 it("does not choose a later alternative over a failed first choice",()=>{
  expect(()=>readCompatibleChatOutput({choices:[{finish_reason:"length",message:{content:"partial"}},{finish_reason:"stop",message:{content:"final"}}]})).toThrow(/length/);
 });
});

it.each(["tool_calls","function_call"])("never echoes unknown provider finish metadata with %s",field=>{
 const finish_reason='private-source fictional\\u002dkey';
 const error=(()=>{try{readCompatibleChatOutput({choices:[{finish_reason,message:{content:"final",[field]:field==="tool_calls"?[{id:"private"}]:{name:"private"}}}]});}catch(error){return error;}})();
 expect(error).toBeInstanceOf(Error);expect((error as Error).message).not.toContain("private");expect((error as Error).message).not.toContain("fictional");
});
describe("bounded native output budget diagnostics",()=>{
 it.each([0,24000,1_000_000_000])("preserves actual safe completion token count %s",completion_tokens=>{
  const error=(()=>{try{readCompatibleChatOutput({choices:[{finish_reason:"length",message:{content:""}}],usage:{completion_tokens}});}catch(error){return error;}})();
  expect(error).toMatchObject({code:"AI_OUTPUT_INCOMPLETE"});expect((error as Error).message).toContain("tokens="+completion_tokens);
 });
 it("uses a safe output_tokens fallback without inventing absent usage",()=>{
  expect(()=>readCompatibleChatOutput({choices:[{finish_reason:"length",message:{content:""}}],usage:{output_tokens:24000}})).toThrow(/finish_reason=length.*24000/);
  const error=(()=>{try{readCompatibleChatOutput({choices:[{finish_reason:"length",message:{content:""}}]});}catch(error){return error;}})();
  expect((error as Error).message).not.toContain("tokens=");
 });
 it.each([1_000_000_001,Number.MAX_SAFE_INTEGER+1,"private-source fictional\\u002dkey"])("rejects or omits invalid public token count %s",completion_tokens=>{
  const error=(()=>{try{readCompatibleChatOutput({choices:[{finish_reason:"length",message:{content:""}}],usage:{completion_tokens}});}catch(error){return error;}})();
  expect(error).toBeInstanceOf(Error);expect((error as Error).message).not.toContain(String(completion_tokens));expect((error as Error).message).not.toContain("tokens=");
 });
});