import {describe,expect,it} from "vitest";
import {observeAiProviderCompletion} from "./ai-provider-completion";

describe("content-free provider completion observations",()=>{
  it.each(["stop","length","content_filter","tool_calls","function_call"])("retains the actual first chat choice reason %s without interpreting task validity",reason=>{
    const raw={choices:[{finish_reason:reason,message:{content:"PRIVATE_FINAL",reasoning_content:"PRIVATE_REASONING"}}],status:"completed",headers:{authorization:"PRIVATE_KEY"}};
    expect(observeAiProviderCompletion(raw,"chat-completions")).toEqual({finishReason:reason});
  });
  it("retains Responses status and bounded incomplete cause without output or private error text",()=>{
    const observed=observeAiProviderCompletion({status:"incomplete",incomplete_details:{reason:"max_output_tokens",private:"PRIVATE_DETAIL"},output:[{text:"PRIVATE_TEXT"}],error:{message:"PRIVATE_ERROR"}},"responses");
    expect(observed).toEqual({responseStatus:"incomplete",incompleteReason:"max_output_tokens"});
    expect(JSON.stringify(observed)).not.toMatch(/PRIVATE|"output"|"message"/);
  });
  it("retains version-matched SDK finish reasons without raw vendor metadata",()=>{
    expect(observeAiProviderCompletion({finishReason:"content-filter",rawFinishReason:"PRIVATE_VENDOR_REASON",output:"PRIVATE_OUTPUT"},"ai-sdk")).toEqual({finishReason:"content-filter"});
  });
  it("maps unrecognized strings to other rather than persisting arbitrary provider text",()=>{
    expect(observeAiProviderCompletion({choices:[{finish_reason:"PRIVATE_SECRET_OR_TEXT"}]},"chat-completions")).toEqual({finishReason:"other"});
    expect(observeAiProviderCompletion({status:"PRIVATE_STATUS",incomplete_details:{reason:"PRIVATE_REASON"}},"responses")).toEqual({responseStatus:"other",incompleteReason:"other"});
  });
  it.each([undefined,null,{},[],{choices:[]},{choices:[{finish_reason:null}]},{choices:[{finish_reason:{private:"secret"}}]}])("keeps absent or malformed metadata %j unavailable",raw=>{
    expect(observeAiProviderCompletion(raw,"chat-completions")).toBeNull();
  });
  it("does not borrow completion markers from another protocol or a later choice",()=>{
    expect(observeAiProviderCompletion({status:"completed",finishReason:"stop",choices:[{}, {finish_reason:"length"}]},"chat-completions")).toBeNull();
    expect(observeAiProviderCompletion({choices:[{finish_reason:"stop"}]},"responses")).toBeNull();
    expect(observeAiProviderCompletion({choices:[{finish_reason:"stop"}],status:"completed"},"ai-sdk")).toBeNull();
  });
});
