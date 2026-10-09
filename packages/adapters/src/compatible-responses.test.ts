import {describe,expect,it,vi} from "vitest";
import {callCompatibleResponses,readCompatibleResponsesOutput,type CompatibleResponsesOptions} from "./compatible-responses";

const key="synthetic-provider-secret";
const reply=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status});
const makeArgs=(request:CompatibleResponsesOptions["request"],over:Partial<CompatibleResponsesOptions>={}):CompatibleResponsesOptions=>({
  baseUrl:"https://provider.example.test/v1",apiKey:key,model:"my-model",system:"synthetic system",user:"synthetic input",
  schema:{name:"task",schema:{type:"object",required:["answer"]}},signal:new AbortController().signal,maxOutputTokens:1200,
  request,errorMessage:(status,body)=>((body as {error?:{message?:string}})?.error?.message??`HTTP ${status}`),...over,
});

describe("compatible Responses adapter",()=>{
  it("joins all output text parts before the task parser receives them",async()=>{
    const request=vi.fn(async()=>reply({status:"completed",output:[{content:[{type:"output_text",text:'{"answer":'},{type:"refusal",refusal:"ignored"}]},{content:[{type:"output_text",text:'"ok"}'}]}]}));
    await expect(callCompatibleResponses(makeArgs(request))).resolves.toMatchObject({text:'{"answer":"ok"}',format:"json-schema"});
  });

  it.each(["failed","incomplete","queued","in_progress","cancelled"])("rejects %s status even when output appears parseable",async status=>{
    const request=vi.fn(async()=>reply({status,output_text:'{"answer":"ok"}'}));
    await expect(callCompatibleResponses(makeArgs(request))).rejects.toThrow(/未完成/);
    expect(request).toHaveBeenCalledTimes(1);
  });

  it.each([{output_text:12},{output:[{content:[{type:"output_text",text:{unexpected:true}}]}]}])("rejects malformed external envelopes",async body=>{
    await expect(callCompatibleResponses(makeArgs(async()=>reply(body)))).rejects.toThrow(/格式无效/);
  });

  it("redacts an echoed provider key from HTTP errors",async()=>{
    await expect(callCompatibleResponses(makeArgs(async()=>reply({error:{message:'Rejected key '+key}},401))))
      .rejects.toThrow('Rejected key [redacted]');
  });

  it("redacts an echoed provider key from error bodies returned with 200",async()=>{
    await expect(callCompatibleResponses(makeArgs(async()=>reply({error:{message:'Rejected key '+key},output_text:'{"answer":"ok"}'}))))
      .rejects.toThrow('Rejected key [redacted]');
  });

  it("keeps budget, images, cache hint and signal stable across format negotiation",async()=>{
    const formats:string[]=[];
    const controller=new AbortController();
    const request=vi.fn(async(url:string,init:RequestInit)=>{
      expect(url).toBe("https://provider.example.test/v1/responses");
      expect(init.signal).toBe(controller.signal);
      const body=JSON.parse(String(init.body));
      expect(body.max_output_tokens).toBe(1200);
      expect(body.prompt_cache_key).toBe("synthetic-cache");
      expect(body.store).toBe(false);
      expect(body.input[1].content[1].image_url).toBe("data:image/png;base64,AA==");
      expect(body.text.verbosity).toBeUndefined();
      formats.push(body.text.format.type);
      return formats.length===1?reply({error:{message:"json_schema unsupported"}},400):reply({output_text:'{"answer":"ok"}'});
    });
    await expect(callCompatibleResponses(makeArgs(request,{signal:controller.signal,imageDataUrls:["data:image/png;base64,AA=="],promptCacheKey:"synthetic-cache"})))
      .resolves.toMatchObject({format:"json-object"});
    expect(formats).toEqual(["json_schema","json_object"]);
  });

  it("does not start another format request after cancellation",async()=>{
    const controller=new AbortController();
    const request=vi.fn(async()=>{
      controller.abort();
      return reply({error:{message:"json_schema unsupported"}},400);
    });
    await expect(callCompatibleResponses(makeArgs(request,{signal:controller.signal}))).rejects.toMatchObject({name:"AbortError"});
    expect(request).toHaveBeenCalledTimes(1);
  });
});

describe("shared Responses envelope decoding",()=>{
  it("preserves browser compatibility while the backend keeps completed-only status",()=>{
    const response={status:"provider-success",output_text:' {"answer":"ok"} '};
    expect(readCompatibleResponsesOutput(response)).toBe(response.output_text);
    expect(()=>readCompatibleResponsesOutput(response,{requireCompletedStatus:true})).toThrow(/未完成/);
  });
  it("checks the envelope before trusting an aggregate text field",()=>{
    expect(()=>readCompatibleResponsesOutput({output_text:'{"answer":"ok"}',output:"invalid"})).toThrow(/格式无效/);
  });
});
