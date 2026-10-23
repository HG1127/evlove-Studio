// @vitest-environment node
import {afterEach,describe,expect,it,vi} from "vitest";
import {runServerAi} from "./ai-gateway";
import {withExplicitServerAiConnection} from "./server-ai-connection";
const settings={connectionId:"synthetic",label:"Synthetic",baseUrl:"https://model.example.test/v1",apiKey:"fictional-key",model:"fixture-model",responseFormat:"json-object" as const};
const report={accuracy:80,evidence:100,riskCoverage:80,completeness:80,safety:"PASS",notes:[],failures:[],
  cases:[{testCaseId:"V1",accuracy:80,evidence:100,completeness:80,reason:"observed"}],
  criteria:[{criterionId:"C1",score:80,pass:false,evidence:["measured deficit"],gaps:["observed"],testCaseIds:["V1"]}]};
function reply(protocol:string,text:string){return new Response(JSON.stringify(protocol==="responses"?{status:"completed",output_text:text}:{choices:[{finish_reason:"stop",message:{content:text}}]}),{status:200});}
type WireMessage={role:string;content:string|Array<{type:string;text?:string;image_url?:string|{url:string}}>} ;
type WireRequest={input?:WireMessage[];messages?:WireMessage[];text?:unknown;response_format?:unknown};
function rows(body:WireRequest,protocol:string):WireMessage[]{
  const messages=protocol==="responses"?body.input:body.messages;
  if(!messages)throw new Error("Synthetic request messages missing");
  return messages;
}
function contentText(message:WireMessage):string{
  if(typeof message.content==="string")return message.content;
  const value=message.content[0]?.text;
  if(typeof value!=="string")throw new Error("Synthetic request text missing");
  return value;
}
afterEach(()=>{vi.unstubAllGlobals();vi.restoreAllMocks();});
describe("one private final response context on direct correction",()=>{
  for(const protocol of ["responses","chat-completions"] as const){
    it.each(["json-schema","json-object","prompt-json"] as const)(protocol+" %s appends exactly one quarantined user message with complete final data",async responseFormat=>{
      const original={artifactSha256:"a".repeat(64),runs:[{testCaseId:"V1",output:"synthetic measured evidence"}]};
      const initial=JSON.stringify(original),final='{ "note":"中文 "quote" <think>literal</think>\nnext line" }';
      const requests:WireRequest[]=[],timeout=vi.spyOn(AbortSignal,"timeout"),signals:unknown[]=[];
      vi.stubGlobal("fetch",vi.fn(async(_url:unknown,init?:RequestInit)=>{
        requests.push(JSON.parse(String(init?.body)));signals.push(init?.signal);
        if(requests.length===1){original.runs[0]!.output="mutated caller";return reply(protocol,'<think>private reasoning</think>\n```json\n'+final+'\n```');}
        return reply(protocol,JSON.stringify(report));
      }));
      const actual=await withExplicitServerAiConnection({...settings,protocol,responseFormat},()=>runServerAi("evaluate",original));
      expect(actual).toEqual(report);expect(requests).toHaveLength(2);expect(timeout).toHaveBeenCalledOnce();expect(signals[1]).toBe(signals[0]);
      const first=rows(requests[0]!,protocol),second=rows(requests[1]!,protocol);
      expect(first).toHaveLength(2);expect(second).toHaveLength(3);expect(second.map((m:{role:string})=>m.role)).toEqual(["system","user","user"]);
      const user=contentText;
      expect(user(second[1])).toBe(initial);expect(user(first[1])).toBe(initial);
      expect(JSON.parse(user(second[2]))).toEqual({schemaVersion:"untrusted-rejected-output-v1",failureKind:"unescaped-control",rejectedFinalText:final});
      const system=user(second[0]);expect(system).toContain("untrusted syntax/shape material");expect(system).not.toContain(final);expect(JSON.stringify(second)).not.toContain("private reasoning");
      expect(protocol==="responses"?requests[1]!.text:requests[1]!.response_format).toEqual(protocol==="responses"?requests[0]!.text:requests[0]!.response_format);
    });
    it(protocol+" captures locally correctable shape only and validates the second response",async()=>{
      const calls:WireRequest[]=[],rejected=JSON.stringify({only:"private missing shape"});
      vi.stubGlobal("fetch",vi.fn(async(_url:unknown,init?:RequestInit)=>{const b=JSON.parse(String(init?.body));calls.push(b);return reply(protocol,calls.length===1?rejected:JSON.stringify(report));}));
      expect(await withExplicitServerAiConnection({...settings,protocol},()=>runServerAi("evaluate",{}))).toEqual(report);
      const wire=contentText(rows(calls[1]!,protocol)[2]!);
      expect(JSON.parse(wire)).toEqual({schemaVersion:"untrusted-rejected-output-v1",failureKind:"schema-shape",rejectedFinalText:rejected});
    });
  }
  it("refuses secret-bearing final context before another provider request",async()=>{
    const fetch=vi.fn(async()=>reply("chat-completions",'{bad "private '+settings.apiKey+'"}'));vi.stubGlobal("fetch",fetch);
    const error=await withExplicitServerAiConnection({...settings,protocol:"chat-completions"},()=>runServerAi("evaluate",{})).catch(error=>error);
    expect(error).toMatchObject({code:"AI_OUTPUT_CORRECTION_SECRET_PRESENT"});expect(String(error)).not.toContain(settings.apiKey);expect(JSON.stringify(error)).not.toContain("private");expect(fetch).toHaveBeenCalledOnce();
  });
  it.each(["中".repeat(22000),"\0".repeat(22000)])("rejects complete final or escaped wrapper over budget without truncating",async text=>{
    const fetch=vi.fn(async()=>reply("chat-completions",'{bad "'+text+'"}'));vi.stubGlobal("fetch",fetch);
    const error=await withExplicitServerAiConnection({...settings,protocol:"chat-completions"},()=>runServerAi("evaluate",{})).catch(error=>error);
    expect(error).toMatchObject({code:"AI_OUTPUT_CORRECTION_CONTEXT_TOO_LARGE"});expect(fetch).toHaveBeenCalledOnce();expect(String(error)).not.toContain(text);
  });
  it("does not expose private context when the second response fails",async()=>{
    const fetch=vi.fn(async()=>reply("chat-completions",'{invalid private marker}'));vi.stubGlobal("fetch",fetch);
    const error=await withExplicitServerAiConnection({...settings,protocol:"chat-completions"},()=>runServerAi("evaluate",{})).catch(error=>error);
    expect(error).toMatchObject({code:"AI_OUTPUT_INVALID_JSON"});expect(fetch).toHaveBeenCalledTimes(2);expect(String(error)).not.toContain("private marker");expect(JSON.stringify(error)).not.toContain("private marker");
  });
  it("isolates simultaneous call contexts",async()=>{
    const contexts:Array<{id:string;context:{rejectedFinalText:string}}>=[],fetch=vi.fn(async(_url:unknown,init?:RequestInit)=>{
      const b=JSON.parse(String(init?.body)) as WireRequest,messages=rows(b,"chat-completions"),id=JSON.parse(contentText(messages[1]!)).id as string;
      await Promise.resolve();if(messages.length===2)return reply("chat-completions",'{invalid private '+id+'}');
      contexts.push({id,context:JSON.parse(contentText(messages[2]!))});return reply("chat-completions",JSON.stringify(report));
    });vi.stubGlobal("fetch",fetch);
    await Promise.all(["A","B"].map(id=>withExplicitServerAiConnection({...settings,protocol:"chat-completions"},()=>runServerAi("evaluate",{id}))));
    expect(fetch).toHaveBeenCalledTimes(4);expect(contexts).toHaveLength(2);for(const row of contexts)expect(row.context.rejectedFinalText).toBe('{invalid private '+row.id+'}');
  });
  for(const protocol of ["responses","chat-completions"] as const){
    it(protocol+" keeps the original media and payload identical on shape correction",async()=>{
      const media={imageDataUrls:["data:image/jpeg;base64,aGVsbG8="]},calls:WireRequest[]=[];
      const result={scores:{usability:80,aesthetics:80,responsiveness:80,interaction:80},summary:"synthetic",findings:[]};
      vi.stubGlobal("fetch",vi.fn(async(_url:unknown,init?:RequestInit)=>{calls.push(JSON.parse(String(init?.body)));if(calls.length===1){media.imageDataUrls[0]="mutated invalid media";return reply(protocol,'{"wrong":"private failed visual wrapper"}');}return reply(protocol,JSON.stringify(result));}));
      expect(await withExplicitServerAiConnection({...settings,protocol},()=>runServerAi("visual-judge",{syntheticOnly:true},media))).toEqual(result);
      expect(rows(calls[1]!,protocol)[1]).toEqual(rows(calls[0]!,protocol)[1]);expect(rows(calls[1]!,protocol)).toHaveLength(3);
      expect(JSON.stringify(rows(calls[1]!,protocol)[1])).toContain("data:image/jpeg;base64,aGVsbG8=");expect(JSON.stringify(calls[1])).not.toContain("mutated invalid media");
    });
  }
  it("rejects the complete corrected native request over budget before sending it",async()=>{
    const fetch=vi.fn(async()=>reply("chat-completions",'{invalid private response}'));vi.stubGlobal("fetch",fetch);
    const error=await withExplicitServerAiConnection({...settings,protocol:"chat-completions"},()=>runServerAi("evaluate",{evidence:"x".repeat(32*1024*1024)})).catch(error=>error);
    expect(error).toMatchObject({code:"AI_OUTPUT_CORRECTION_REQUEST_TOO_LARGE"});expect(fetch).toHaveBeenCalledOnce();expect(String(error)).not.toContain("private response");
  });

  it.each(['{"only":"fictional\\u002dkey"}','{invalid "\\u0066ictional-key"}'])("never sends a known escaped credential on shape or syntax correction",async final=>{
    const fetch=vi.fn(async()=>reply("chat-completions",final));vi.stubGlobal("fetch",fetch);
    const error=await withExplicitServerAiConnection({...settings,protocol:"chat-completions"},()=>runServerAi("evaluate",{})).catch(error=>error);
    expect(error).toMatchObject({code:"AI_OUTPUT_CORRECTION_SECRET_PRESENT"});expect(fetch).toHaveBeenCalledOnce();expect(String(error)).not.toContain(settings.apiKey);expect(JSON.stringify(error)).not.toContain(final);
  });

});
