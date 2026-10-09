import {afterEach,describe,expect,it,vi} from "vitest";
import {z} from "zod";
import {callByokStructured,testByokConnection,type ResolvedByok} from "./byok";

const resolved:ResolvedByok={
  preset:{id:"custom",name:"Custom",kind:"openai",defaultBaseUrl:"",consoleUrl:"",defaultModel:"",vision:true,cors:"yes",note:""},
  config:{enabled:true,providerId:"custom",apiKey:"synthetic-only-provider-key",model:"my-model",baseUrl:"https://custom.example.test/v1/responses"},
  baseUrl:"https://custom.example.test/v1",
};
const parser=z.object({answer:z.string()});
const schema={name:"task",schema:{type:"object",properties:{answer:{type:"string"}},required:["answer"],additionalProperties:false}};
const task=(connection=resolved)=>callByokStructured({resolved:connection,system:"A synthetic task",user:"No user files",schema,parser,schemaRetries:0,maxOutputTokens:1024});
const reply=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{"Content-Type":"application/json"}});
const target=(url:string,init?:RequestInit)=>url==="/api/ai-relay"?new Headers(init?.headers).get("x-target-url"):url;

afterEach(()=>{vi.unstubAllGlobals();localStorage.clear();});

describe("custom Responses health-to-task path",()=>{
  it("executes on the same direct endpoint that passed the health probe",async()=>{
    const urls:string[]=[];
    vi.stubGlobal("fetch",vi.fn(async(url:string)=>{
      urls.push(url);
      if(url==="https://custom.example.test/v1/responses")return reply({output_text:'{"answer":"ok"}'});
      return reply({error:{message:"Route not found"}},404);
    }));
    await expect(testByokConnection(resolved)).resolves.toMatchObject({text:'{"answer":"ok"}'});
    await expect(task()).resolves.toEqual({answer:"ok"});
    expect(urls).toEqual(["https://custom.example.test/v1/responses","https://custom.example.test/v1/responses"]);
  });

  it("uses direct fetch first and preserves the request when CORS requires the local relay",async()=>{
    const requests:Array<{url:string;body:unknown;target:string|null}>=[];
    vi.stubGlobal("fetch",vi.fn(async(url:string,init?:RequestInit)=>{
      requests.push({url,body:JSON.parse(String(init?.body)),target:new Headers(init?.headers).get("x-target-url")});
      if(url.startsWith("https:"))throw new TypeError("Synthetic CORS refusal");
      return reply({output:[{content:[{type:"output_text",text:'{"answer":"ok"}'}]}]});
    }));
    await expect(task()).resolves.toEqual({answer:"ok"});
    expect(requests.map(item=>item.url)).toEqual(["https://custom.example.test/v1/responses","/api/ai-relay"]);
    expect(requests[1]?.target).toBe("https://custom.example.test/v1/responses");
    expect(requests[1]?.body).toEqual(requests[0]?.body);
  });

  it("keeps known non-CORS providers on the existing relay",async()=>{
    const fetchStub=vi.fn(async()=>reply({output_text:'{"answer":"ok"}'}));
    vi.stubGlobal("fetch",fetchStub);
    await expect(task({...resolved,preset:{...resolved.preset,id:"openai",cors:"no"}})).resolves.toEqual({answer:"ok"});
    expect(fetchStub).toHaveBeenCalledTimes(1);
    expect(fetchStub).toHaveBeenCalledWith("/api/ai-relay",expect.anything());
  });

  it("negotiates JSON on the same Responses endpoint and remembers the working format",async()=>{
    const seen:Array<{target:string|null;format:string;schemaInPrompt:boolean}>=[];
    vi.stubGlobal("fetch",vi.fn(async(url:string,init?:RequestInit)=>{
      const body=JSON.parse(String(init?.body));
      const address=target(url,init);
      seen.push({target:address,format:body.text?.format?.type??"none",schemaInPrompt:(body.input?.[0]?.content?.[0]?.text??"").includes(JSON.stringify(schema.schema))});
      if(!address?.endsWith("/responses"))return reply({error:{message:"No Chat endpoint"}},404);
      if(body.text?.format?.type==="json_schema")return reply({error:{message:"json_schema unsupported",param:"text.format"}},400);
      return reply({output_text:'{"answer":"ok"}'});
    }));
    const connection={...resolved,preset:{...resolved.preset,cors:"no" as const}};
    await expect(task(connection)).resolves.toEqual({answer:"ok"});
    await expect(task(connection)).resolves.toEqual({answer:"ok"});
    expect(seen.map(item=>item.format)).toEqual(["json_schema","json_object","json_object"]);
    expect(seen.every(item=>item.target?.endsWith("/responses")&&item.schemaInPrompt)).toBe(true);
  });

  it("supports prompt JSON when the Responses provider rejects format parameters",async()=>{
    const formats:string[]=[];
    vi.stubGlobal("fetch",vi.fn(async(url:string,init?:RequestInit)=>{
      const body=JSON.parse(String(init?.body));
      expect(target(url,init)).toBe("https://custom.example.test/v1/responses");
      formats.push(body.text?.format?.type??"none");
      if(body.text?.format)return reply({error:{message:"text.format is not supported",param:"text.format"}},400);
      expect(body.input[0].content[0].text).toContain(JSON.stringify(schema.schema));
      return reply({output_text:'{"answer":"ok"}'});
    }));
    await expect(task()).resolves.toEqual({answer:"ok"});
    expect(formats).toEqual(["json_schema","json_object","none"]);
  });

  it("keeps format memory scoped to the actual endpoint",async()=>{
    const seen:Array<{url:string|null;format:string}>=[];
    vi.stubGlobal("fetch",vi.fn(async(url:string,init?:RequestInit)=>{
      const address=target(url,init);
      const body=JSON.parse(String(init?.body));
      seen.push({url:address,format:body.text?.format?.type??"none"});
      if(address?.includes("custom.example.test")&&body.text?.format?.type==="json_schema")return reply({error:{message:"json_schema unsupported"}},400);
      return reply({output_text:'{"answer":"ok"}'});
    }));
    await expect(task()).resolves.toEqual({answer:"ok"});
    await expect(task({...resolved,baseUrl:"https://second.example.test/v1",config:{...resolved.config,baseUrl:"https://second.example.test/v1/responses"}})).resolves.toEqual({answer:"ok"});
    expect(seen.map(item=>item.format)).toEqual(["json_schema","json_object","json_schema"]);
  });

  it("retains protocol fallback only when the Responses endpoint is absent",async()=>{
    const urls:string[]=[];
    vi.stubGlobal("fetch",vi.fn(async(url:string)=>{
      urls.push(url);
      return url.endsWith("/responses")?reply({error:{message:"No endpoint"}},404):reply({choices:[{message:{content:'{"answer":"ok"}'}}]});
    }));
    await expect(task()).resolves.toEqual({answer:"ok"});
    expect(urls).toEqual(["https://custom.example.test/v1/responses","https://custom.example.test/v1/chat/completions"]);
  });

  it.each([401,403,429,500])("does not negotiate or repair JSON after HTTP %i",async(status)=>{
    const fetchStub=vi.fn(async()=>reply({error:{message:"Synthetic request failure"}},status));
    vi.stubGlobal("fetch",fetchStub);
    await expect(task()).rejects.toThrow();
    expect(fetchStub).toHaveBeenCalledTimes(1);
  });

  it("does not downgrade an unrelated invalid-input error",async()=>{
    const fetchStub=vi.fn(async()=>reply({error:{message:"Input exceeds model context",param:"input"}},400));
    vi.stubGlobal("fetch",fetchStub);
    await expect(task()).rejects.toThrow();
    expect(fetchStub).toHaveBeenCalledTimes(1);
  });

  it("still rejects model JSON that does not satisfy the task contract",async()=>{
    vi.stubGlobal("fetch",vi.fn(async()=>reply({output_text:'{"wrong":true}'})));
    await expect(task()).rejects.toThrow(/约定格式/);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});