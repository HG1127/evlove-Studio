import {describe,expect,it} from "vitest";
import {readCompatibleSchemaToolOutput} from "./compatible-schema-tool";
const name="synthetic_result";
function body(args='{"literal":"quoted \\" and \\n"}'){
  return{choices:[{finish_reason:"tool_calls",message:{role:"assistant",content:null as unknown,reasoning_content:"private reasoning",tool_calls:[{id:"call_1",type:"function",function:{name,arguments:args}}]}}]};
}
describe("output-only schema function boundary",()=>{
  it("returns the exact argument text without parsing, executing or consulting reasoning",()=>{
    const text='{"literal":"<think>source</think> \\" \\n"}';
    expect(readCompatibleSchemaToolOutput(body(text),name)).toEqual({text,carrier:"schema-tool"});
  });
  it("allows an ordinary complete JSON text from the same single response",()=>{
    expect(readCompatibleSchemaToolOutput({choices:[{finish_reason:"stop",message:{content:"{}",tool_calls:[]}}]},name)).toEqual({text:"{}",carrier:"text"});
  });
  it.each(["failed","cancelled","incomplete","queued","in_progress","unexpected"])("rejects nonfinal status %s",status=>{
    expect(()=>readCompatibleSchemaToolOutput({...body(),status},name)).toThrow();
  });
  it.each(["stop","length","content_filter","function_call",undefined,null,"provider_eos"])("rejects a schema call with finish %s",finish=>{
    const b=body();Object.assign(b.choices[0]!,{finish_reason:finish});expect(()=>readCompatibleSchemaToolOutput(b,name)).toThrow();
  });
  it.each([
    (b:ReturnType<typeof body>)=>{b.choices.push(structuredClone(b.choices[0]!));},
    (b:ReturnType<typeof body>)=>{b.choices[0]!.message.tool_calls.push(structuredClone(b.choices[0]!.message.tool_calls[0]!));},
    (b:ReturnType<typeof body>)=>{b.choices[0]!.message.tool_calls[0]!.function.name="arbitrary_action";},
    (b:ReturnType<typeof body>)=>{b.choices[0]!.message.tool_calls[0]!.type="custom";},
    (b:ReturnType<typeof body>)=>{b.choices[0]!.message.tool_calls[0]!.id="";},
    (b:ReturnType<typeof body>)=>{Object.assign(b.choices[0]!.message,{refusal:"private refusal"});},
    (b:ReturnType<typeof body>)=>{Object.assign(b.choices[0]!.message,{function_call:{name}});},
    (b:ReturnType<typeof body>)=>{Object.assign(b.choices[0]!,{text:"second result"});},
    (b:ReturnType<typeof body>)=>{b.choices[0]!.message.content="second result";},
    (b:ReturnType<typeof body>)=>{b.choices[0]!.message.content=[{type:"refusal",refusal:"private refusal"}];},
    (b:ReturnType<typeof body>)=>{b.choices[0]!.message.content=[{type:"image",text:""}];},
    (b:ReturnType<typeof body>)=>{Object.assign(b,{output_text:"other result"});},
    (b:ReturnType<typeof body>)=>{Object.assign(b,{output:[{type:"function_call"}]});},
    (b:ReturnType<typeof body>)=>{Object.assign(b,{error:{message:"private echoed source"}});},
    (b:ReturnType<typeof body>)=>{Object.assign(b,{message:"private echoed source"});},
    (b:ReturnType<typeof body>)=>{b.choices[0]!.message.role="tool";},
  ])("rejects ambiguous, refused, wrong or nonfinal result %# without private excerpts",change=>{
    const b=body();change(b);expect(()=>readCompatibleSchemaToolOutput(b,name)).toThrow();
    let message="";try{readCompatibleSchemaToolOutput(b,name);}catch(error){message=String(error);}
    expect(message).not.toContain("private");expect(message).not.toContain("second result");
  });
  it.each([null,{}, {choices:"invalid"}, {choices:[]}])("rejects invalid envelope %#",b=>expect(()=>readCompatibleSchemaToolOutput(b,name)).toThrow());
  it.each(["", "other", "../arbitrary", "a".repeat(65)])("requires the exact expected safe name %s",expected=>expect(()=>readCompatibleSchemaToolOutput(body(),expected)).toThrow());
  it("bounds exact UTF8 argument bytes rather than JS string length",()=>{
    expect(()=>readCompatibleSchemaToolOutput(body("中".repeat(700_000)),name)).toThrow();
    expect(readCompatibleSchemaToolOutput(body("a".repeat(2*1024*1024)),name).text.length).toBe(2*1024*1024);
  });
  it("permits whitespace final content alongside the sole result",()=>{
    const b=body("{}");b.choices[0]!.message.content=[{type:"text",text:" \n"}];expect(readCompatibleSchemaToolOutput(b,name).text).toBe("{}");
  });
});

it.each([
  {finish_reason:"stop",text:"{}",message:{content:"{}"}},
  {finish_reason:"stop",message:{content:[{type:"text",text:"{}"},{type:"image",text:""}]}},
  {finish_reason:"stop",message:{content:"{}",tool_calls:[{function:{name:"wrong",arguments:"{}"}}]}},
])("does not choose a text alternative from ambiguous or opaque content %#",choice=>expect(()=>readCompatibleSchemaToolOutput({choices:[choice]},name)).toThrow());
it.each(["",{},null,1])("requires a bounded argument string %#",argumentsValue=>{
  const b=body();Object.assign(b.choices[0]!.message.tool_calls[0]!.function,{arguments:argumentsValue});expect(()=>readCompatibleSchemaToolOutput(b,name)).toThrow();
});
