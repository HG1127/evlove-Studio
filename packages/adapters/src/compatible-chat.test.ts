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
