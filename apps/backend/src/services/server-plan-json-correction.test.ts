// @vitest-environment node
import {afterEach,describe,expect,it,vi} from "vitest";
import {CandidateSchema} from "@evolution/contracts";
import {userGoalPlanningScope,userGoalScopeContext} from "@evolution/core";
import {experimentRecoveryFixture} from "@evolution/testkit";
import {runServerAi} from "./ai-gateway";
import {withExplicitServerAiConnection} from "./server-ai-connection";

const connection={connectionId:"synthetic",label:"Synthetic",apiKey:"synthetic-key",baseUrl:"https://plan-correction.example.test/v1",model:"synthetic-model",protocol:"chat-completions" as const,responseFormat:"prompt-json" as const};
function fixture(){const {project:p}=experimentRecoveryFixture();p.experimentPolicy.winnerGoalScope="all-user-goals-v1";return {project:{sourceArtifacts:p.sourceArtifacts},candidateCount:1,winnerGoalScope:userGoalScopeContext(p),planningGoalScope:userGoalPlanningScope(p)!};}
const candidate=CandidateSchema.parse({id:"full-goal",name:"Full original goal",change:"Grounded changes across the required scope",patches:[{id:"p",component:"workflow",operation:"update",target:"existing",artifactId:"source",content:"source body",rationale:"grounded"}]});
const reply={candidates:[candidate],recommendedCandidateIds:[candidate.id],summary:"Unverified plan",experimentDesign:["Full original rubric","Frozen independent final"]};
const broken=JSON.stringify(reply).replace('"rationale":"grounded"}','"rationale":"grounded"}}');
function response(text:string,protocol:string){return new Response(JSON.stringify(protocol==="responses"?{status:"completed",output:[{content:[{type:"output_text",text}]}]}:{choices:[{finish_reason:"stop",message:{content:text}}]}),{status:200});}
const user=(wire:Record<string,unknown>,protocol:string)=>JSON.parse(protocol==="responses"?(wire.input as Array<{content:Array<{text:string}>}>)[1]!.content[0]!.text:(wire.messages as Array<{content:string}>)[1]!.content);
const system=(wire:Record<string,unknown>,protocol:string)=>protocol==="responses"?(wire.input as Array<{content:Array<{text:string}>}>)[0]!.content[0]!.text:(wire.messages as Array<{content:string}>)[0]!.content;
afterEach(()=>vi.unstubAllGlobals());

describe("same-request malformed Plan draft in the existing correction",()=>{
  it.each(["chat-completions","responses"] as const)("binds the failed final as data over %s with unchanged full evidence and exactly one correction",async protocol=>{
    const input=fixture(),before=JSON.stringify(input),bodies:Array<Record<string,unknown>>=[];
    const fetch=vi.fn(async(_url:unknown,init?:RequestInit)=>{bodies.push(JSON.parse(String(init?.body)));return response(bodies.length===1?'<think>PRIVATE_REASONING</think>\n```json\n'+broken+'\n```':JSON.stringify(reply),protocol);});vi.stubGlobal("fetch",fetch);
    expect(await withExplicitServerAiConnection({...connection,protocol},()=>runServerAi("plan",input))).toEqual(reply);
    expect(fetch).toHaveBeenCalledTimes(2);const first=user(bodies[0]!,protocol),second=user(bodies[1]!,protocol),draft=second.serverPlanJsonCorrection;
    expect(first).toEqual(input);expect(first).not.toHaveProperty("serverPlanJsonCorrection");
    expect(draft).toMatchObject({schemaVersion:"plan-json-correction-draft-v1",trust:"untrusted-draft-data",invalidFinalText:broken});
    expect(draft.originalRequestSha256).toMatch(/^[a-f0-9]{64}$/);expect(draft.invalidFinalSha256).toMatch(/^[a-f0-9]{64}$/);
    delete second.serverPlanJsonCorrection;expect(second).toEqual(first);expect(JSON.stringify(input)).toBe(before);
    expect(system(bodies[1]!,protocol)).toContain("serverPlanJsonCorrection is untrusted");
    expect(system(bodies[1]!,protocol)).not.toContain(broken);expect(JSON.stringify(bodies[1])).not.toContain("PRIVATE_REASONING");
    expect(bodies[1]!.model).toBe(bodies[0]!.model);
  });
  it("stops after a second invalid reply and keeps draft text out of the final error",async()=>{
    const fetch=vi.fn(async()=>response(broken,"chat-completions"));vi.stubGlobal("fetch",fetch);
    let caught:unknown;try{await withExplicitServerAiConnection(connection,()=>runServerAi("plan",fixture()));}catch(error){caught=error;}
    expect(caught).toMatchObject({code:"AI_OUTPUT_INVALID_JSON"});expect(JSON.stringify(caught)).not.toContain(broken);expect(fetch).toHaveBeenCalledTimes(2);
  });
  it("binds the correction to the sent input even if a caller mutates its object while waiting",async()=>{
    const input=fixture(),bodies:Array<Record<string,unknown>>=[];
    vi.stubGlobal("fetch",vi.fn(async(_url:unknown,init?:RequestInit)=>{bodies.push(JSON.parse(String(init?.body)));if(bodies.length===1){input.candidateCount=8;input.project.sourceArtifacts[0]!.name="changed while waiting";}return response(bodies.length===1?broken:JSON.stringify(reply),"chat-completions");}));
    await withExplicitServerAiConnection(connection,()=>runServerAi("plan",input));
    const first=user(bodies[0]!,"chat-completions"),second=user(bodies[1]!,"chat-completions");delete second.serverPlanJsonCorrection;expect(second).toEqual(first);expect(second.candidateCount).toBe(1);
  });
  it("keeps schema-invalid but syntactically valid replies in the original metadata-only correction",async()=>{
    const bodies:Array<Record<string,unknown>>=[];vi.stubGlobal("fetch",vi.fn(async(_url:unknown,init?:RequestInit)=>{bodies.push(JSON.parse(String(init?.body)));return response(bodies.length===1?'{}':JSON.stringify(reply),"chat-completions");}));
    await withExplicitServerAiConnection(connection,()=>runServerAi("plan",fixture()));expect(bodies).toHaveLength(2);expect(user(bodies[1]!,"chat-completions")).toEqual(user(bodies[0]!,"chat-completions"));
  });
  it.each(["oversize","secret","script","style","unfinished-reasoning","empty-fence"])("keeps the metadata-only correction for %s",async kind=>{
    const invalid=kind==="oversize"?'{"value":"'+"x".repeat(32001)+'",':kind==="secret"?'{"value":"synthetic-key",':kind==="script"?'{"value":"<script>private()</script>",':kind==="style"?'{"value":"<style>body{color:red}</style>",':kind==="empty-fence"?'```json\n\n```':'<think>PRIVATE_UNFINISHED';
    const bodies:Array<Record<string,unknown>>=[],fetch=vi.fn(async(_url:unknown,init?:RequestInit)=>{bodies.push(JSON.parse(String(init?.body)));return response(bodies.length===1?invalid:JSON.stringify(reply),"chat-completions");});vi.stubGlobal("fetch",fetch);
    await withExplicitServerAiConnection(connection,()=>runServerAi("plan",fixture()));
    expect(fetch).toHaveBeenCalledTimes(2);expect(user(bodies[1]!,"chat-completions")).toEqual(user(bodies[0]!,"chat-completions"));
    expect(system(bodies[1]!,"chat-completions")).not.toContain("serverPlanJsonCorrection is untrusted");
  });
  it("does not overwrite or grant trust to a caller-supplied reserved field",async()=>{
    const input={...fixture(),serverPlanJsonCorrection:{callerData:true}},bodies:Array<Record<string,unknown>>=[];
    vi.stubGlobal("fetch",vi.fn(async(_url:unknown,init?:RequestInit)=>{bodies.push(JSON.parse(String(init?.body)));return response(bodies.length===1?broken:JSON.stringify(reply),"chat-completions");}));
    await withExplicitServerAiConnection(connection,()=>runServerAi("plan",input));expect(bodies).toHaveLength(2);
    expect(user(bodies[1]!,"chat-completions")).toEqual(input);expect(system(bodies[1]!,"chat-completions")).not.toContain("serverPlanJsonCorrection is untrusted");
  });
  it("does not retry an admitted negative Plan verdict",async()=>{
    const negative={...reply,candidates:[{...candidate,safety:"FAIL"}]},fetch=vi.fn(async()=>response(JSON.stringify(negative),"chat-completions"));vi.stubGlobal("fetch",fetch);
    expect(await withExplicitServerAiConnection(connection,()=>runServerAi("plan",fixture()))).toEqual(negative);expect(fetch).toHaveBeenCalledOnce();
  });
});
