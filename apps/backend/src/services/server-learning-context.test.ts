// @vitest-environment node
import {readFileSync} from "node:fs";
import {parse} from "@babel/parser";
import {afterEach,describe,expect,it,vi} from "vitest";
import {learningContextFixture} from "@evolution/testkit";
import {buildServerLessonDistillationPayload} from "./server-learning-context";
import {runServerAi} from "./ai-gateway";
import {withExplicitServerAiConnection} from "./server-ai-connection";
const {blobs}=vi.hoisted(()=>({blobs:new Map<string,Blob>()}));
vi.mock("./artifact-runtime",()=>({getServerArtifactStore:()=>({get:async(id:string)=>blobs.get(id)})}));
afterEach(()=>{vi.unstubAllGlobals();blobs.clear();});
describe("learning composition and provider egress",()=>{
  it("verifies physical bytes and sends useful body evidence through the actual router without forbidden nested data",async()=>{
    const x=learningContextFixture();for(const [id,b]of x.blobs)blobs.set(id,b);
    const payload=await buildServerLessonDistillationPayload(x.p),requests:unknown[]=[];
    const result={title:"source-bound lesson",summary:"synthetic only",reusable:false,effect:"not independently established",limit:"synthetic fixture",trigger:[],method:[],validatedOn:[],status:"lesson"};
    vi.stubGlobal("fetch",vi.fn(async(_url,init)=>{requests.push(JSON.parse(String(init.body)));return new Response(JSON.stringify({choices:[{finish_reason:"stop",message:{content:JSON.stringify(result)}}]}),{status:200});}));
    const out=await withExplicitServerAiConnection({connectionId:"learning-test",label:"Test",apiKey:"synthetic-key",baseUrl:"https://learning.example.test/v1",model:"synthetic-model",protocol:"chat-completions",responseFormat:"json-object"},()=>runServerAi("distill",payload));
    expect(out).toEqual(result);expect(requests).toHaveLength(1);const wire=JSON.stringify(requests);
    expect(wire).toContain("Current complete body");expect(wire).toContain(payload.candidateArtifacts[0]!.sha256!);
    expect(wire).not.toMatch(/PRIVATE_.*SENTINEL|artifactSnapshots|independentFinal/);
    const fetch=vi.mocked(globalThis.fetch);fetch.mockClear();
    expect(()=>runServerAi("distill",{...payload,winner:x.current,validation:x.p.validationRun})).toThrow();expect(fetch).not.toHaveBeenCalled();
  });
  it("fails physical readback without transmitting a legacy raw-payload fallback",async()=>{
    const x=learningContextFixture(),fetch=vi.fn();vi.stubGlobal("fetch",fetch);
    await expect(buildServerLessonDistillationPayload(x.p)).rejects.toThrow("readback");expect(fetch).not.toHaveBeenCalled();
  });
  it("wires the real Workflow distill operation to the verified payload builder",()=>{
    const source=readFileSync(new URL("../../../../workflows/evolution-mission/steps.ts",import.meta.url),"utf8"),ast=parse(source,{sourceType:"module",plugins:["typescript"]});
    const calls:Array<{callee:{name?:string};arguments:Array<{value?:string;type:string;name?:string}>}>=[];
    const visit=(node:unknown)=>{if(!node||typeof node!=="object")return;const n=node as {type?:string;callee?:{name?:string};arguments?:Array<{value?:string;type:string;name?:string}>};if(n.type==="CallExpression"&&n.callee?.name==="runServerAi"&&n.arguments?.[0]?.value==="distill")calls.push(n as typeof calls[number]);for(const value of Object.values(node))if(Array.isArray(value))value.forEach(visit);else if(typeof value==="object")visit(value);};
    visit(ast);expect(calls).toHaveLength(1);expect(calls[0]!.arguments[1]).toMatchObject({type:"Identifier",name:"learningPayload"});
    expect(source).toContain("const learningPayload=await buildServerLessonDistillationPayload(mission,Date.parse(now))");
  });
});
