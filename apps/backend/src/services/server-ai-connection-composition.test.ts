// @vitest-environment node
import {afterEach,beforeEach,describe,expect,it,vi} from "vitest";
import {createError,mockEvent} from "nitro/h3";
import {ServerAiConnectionPutSchema} from "@evolution/contracts";
import putRoute from "../../server/api/evolution/ai-connection.put";
import getRoute from "../../server/api/evolution/ai-connection.get";
import testRoute from "../../server/api/evolution/ai-connection-test.post";
import {readServerAiConnection,saveServerAiConnection,testServerAiConnection} from "../../../../src/features/evolve/ai/server-connection-client";
import {runServerAi} from "./ai-gateway";
import {resolveServerAiConfig} from "./server-ai-connection";
import {encryptVaultValue} from "./server-vault";
import {resetServerAiRuntimeProbeCache} from "./server-ai-health";

const governance=vi.hoisted(()=>({permission:vi.fn()}));
vi.mock("./security-policy",()=>({requireGovernedEvolutionPermission:governance.permission}));
const input=ServerAiConnectionPutSchema.parse({
  connectionId:"mine",label:"用户自己的接口",baseUrl:"https://custom.example.test/v1/chat/completions",
  apiKey:"private-custom-model-key",model:"arbitrary/model-id",protocol:"chat-completions",responseFormat:"json-object",
});
const understanding={intentRestatement:"Synthetic contract response",implicitRequirements:[],assumptions:[],clarifications:[],acceptanceFocus:[],confidence:0.8};
const master="v".repeat(64);
const keys=[
  "NODE_ENV","SUPABASE_URL","SUPABASE_SECRET_KEY","SUPABASE_SERVICE_ROLE_KEY","SUPABASE_PUBLISHABLE_KEY",
  "EVOLUTION_WORKSPACE_ID","EVOLUTION_VAULT_MASTER_KEY","EVOLUTION_VAULT_KEY_ID","EVOLUTION_VAULT_DECRYPT_KEYS_JSON",
  "EVOLUTION_AI_API_KEY","OPENAI_API_KEY","EVOLUTION_AI_MODEL","OPENAI_MODEL","VERCEL","VERCEL_ENV","VERCEL_OIDC_TOKEN","EVOLUTION_AI_GATEWAY_ENABLED",
] as const;
const previous=new Map<string,string|undefined>();
let rows:Map<string,Record<string,unknown>>;
let providerCalls:Array<{url:string;init:RequestInit;body:Record<string,unknown>}>;
let databaseWrites:number;

function installBoundaries(){
  vi.stubGlobal("fetch",vi.fn(async(raw:RequestInfo|URL,init:RequestInit={})=>{
    const address=String(raw);
    if(address.startsWith("/api/evolution/")){
      const event=mockEvent(new Request("https://studio.example.test"+address,init));
      const handler=address.endsWith("ai-connection-test")?testRoute:init.method==="PUT"?putRoute:getRoute;
      try{return new Response(JSON.stringify(await handler(event)),{status:200,headers:{"Content-Type":"application/json"}});}
      catch(error){
        const detail=error as {status?:number;message?:string};
        return new Response(JSON.stringify({statusMessage:detail.message}),{status:detail.status??500});
      }
    }
    const url=new URL(address);
    if(url.hostname==="supabase.test"){
      expect(url.pathname).toBe("/rest/v1/evolution_vault_secrets");
      const id=url.searchParams.get("id")?.replace(/^eq\./,"");
      const workspace=url.searchParams.get("workspace_id")?.replace(/^eq\./,"");
      if(init.method==="POST"){
        const row=JSON.parse(String(init.body));
        databaseWrites++;
        rows.set(String(row.id),row);
        return new Response(null,{status:204});
      }
      return new Response(JSON.stringify([...rows.values()].filter(row=>(!id||row.id===id)&&(!workspace||row.workspace_id===workspace))),{status:200});
    }
    expect(url.hostname).toBe("custom.example.test");
    expect(url.pathname).toBe("/v1/chat/completions");
    const body=JSON.parse(String(init.body));
    providerCalls.push({url:address,init,body});
    return new Response(JSON.stringify({choices:[{message:{content:JSON.stringify(understanding)}}]}),{status:200});
  }));
}

beforeEach(()=>{
  for(const key of keys){previous.set(key,process.env[key]);delete process.env[key];}
  Object.assign(process.env,{
    NODE_ENV:"test",SUPABASE_URL:"https://supabase.test",SUPABASE_SECRET_KEY:"sb_secret_synthetic_server_key",
    EVOLUTION_WORKSPACE_ID:"workspace-test",EVOLUTION_VAULT_MASTER_KEY:master,EVOLUTION_VAULT_KEY_ID:"test-key",
    VERCEL:"1",EVOLUTION_AI_GATEWAY_ENABLED:"true",
  });
  rows=new Map();providerCalls=[];databaseWrites=0;
  governance.permission.mockReset().mockResolvedValue({id:"admin",role:"admin",workspaceId:"workspace-test"});
  resetServerAiRuntimeProbeCache();installBoundaries();
});
afterEach(()=>{
  resetServerAiRuntimeProbeCache();vi.unstubAllGlobals();
  for(const key of keys){const value=previous.get(key);if(value===undefined)delete process.env[key];else process.env[key]=value;}
});

describe("browser configuration → API → encrypted Vault → backend model composition",()=>{
  it("saves the selected arbitrary model, reads public settings, and uses it for a backend operation",async()=>{
    const saved=await saveServerAiConnection(input);
    expect(saved).toMatchObject({configured:true,revision:1,connection:{model:input.model,baseUrl:"https://custom.example.test/v1"}});
    expect(JSON.stringify([...rows.values()])).not.toContain(input.apiKey);
    expect(JSON.stringify(saved)).not.toContain(input.apiKey);
    expect(await readServerAiConnection()).toMatchObject({configured:true,connection:saved.connection,revision:saved.revision});
    expect(await runServerAi("understand",{command:"Synthetic only",artifacts:[]})).toEqual(understanding);
    expect(providerCalls).toHaveLength(1);
    expect(providerCalls[0]!.body.model).toBe(input.model);
    expect(providerCalls[0]!.init.headers).toMatchObject({Authorization:"Bearer "+input.apiKey});
    expect(governance.permission.mock.calls.map(call=>call[1])).toEqual(["security.admin","data.read"]);
  });

  it("probes an unsaved draft without user files or changing the persisted default",async()=>{
    await saveServerAiConnection(input);
    const health=await testServerAiConnection({...input,model:"draft-model"});
    expect(health).toMatchObject({ready:true,model:"draft-model",mode:"openai-compatible"});
    expect(databaseWrites).toBe(1);
    const messages=providerCalls[0]!.body.messages as Array<{role:string;content:string}>;
    expect(JSON.parse(messages.find(item=>item.role==="user")!.content).artifacts).toEqual([]);
    expect((await resolveServerAiConfig())?.model).toBe(input.model);
    expect((await readServerAiConnection()).connection?.model).toBe(input.model);
  });

  it("denies configuration before touching encrypted storage or a model",async()=>{
    governance.permission.mockRejectedValue(createError({statusCode:403,statusMessage:"forbidden"}));
    await expect(saveServerAiConnection(input)).rejects.toThrow("请先连接后端工作区");
    expect(databaseWrites).toBe(0);
    expect(rows.size).toBe(0);
    expect(providerCalls).toHaveLength(0);
  });

  it("rejects an oversized body before storing or probing",async()=>{
    const event=mockEvent(new Request("https://studio.example.test/api/evolution/ai-connection",{
      method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify({...input,unexpected:"x".repeat(33*1024)}),
    }));
    await expect(putRoute(event)).rejects.toMatchObject({status:413});
    expect(databaseWrites).toBe(0);
    expect(providerCalls).toHaveLength(0);
  });

  it("keeps a malformed decrypted connection out of configuration error responses",async()=>{
    await saveServerAiConnection(input);
    const row=[...rows.values()][0]!;
    const sealed=encryptVaultValue({
      value:input.apiKey,workspaceId:"workspace-test",id:String(row.id),version:1,keyId:"test-key",key:master,
    });
    rows.set(String(row.id),{...row,ciphertext:sealed.ciphertext,iv:sealed.iv,auth_tag:sealed.authTag});
    const error=await readServerAiConnection().catch((value:unknown)=>value);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).not.toContain(input.apiKey);
    expect((error as Error).message).not.toContain(input.apiKey.slice(0,8));
    expect((error as Error).message).toContain("配置无效");
    expect(providerCalls).toHaveLength(0);
  });
});
