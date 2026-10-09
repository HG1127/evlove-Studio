import {afterEach,describe,expect,it} from "vitest";
import {
  isPlausibleModelId,listProviderConnections,listTestedModelChoices,noteModelLatency,noteModelTested,
  pruneConnectionToTested,resolveOperationConnection,resolveOperationConnections,resolveProjectOperationConnections,
  saveAiRoutingPolicy,saveProviderConnections,type ProviderConnection,
} from "./registry";

const connection=(model="x"):ProviderConnection=>({
  id:"synthetic-short-model",providerId:"custom",label:"Synthetic custom provider",enabled:true,
  apiKey:"fictional-key",baseUrl:"https://provider.example.test/v1",defaultModel:model,models:[model],
  createdAt:"now",updatedAt:"now",
});
afterEach(()=>localStorage.clear());

describe("user supplied opaque model IDs",()=>{
  it.each(["x","llm","g","GPT","本地","provider/llm","o3"])("accepts an explicitly chosen %s ID without a provider-name guess",model=>{
    expect(isPlausibleModelId(model)).toBe(true);
    saveProviderConnections([connection(model)]);
    const stored=listProviderConnections()[0]!;
    expect(stored.defaultModel).toBe(model);
    expect(stored.models).toEqual([model]);
    expect(resolveOperationConnection("plan")?.model).toBe(model);
    expect(resolveOperationConnections("plan")[0]?.resolved.config.model).toBe(model);
  });
  it("canonicalizes committed whitespace without changing case or model identity",()=>{
    saveProviderConnections([{...connection("  llm  "),models:["  llm  ","llm","x"],testedModels:["  x  "]}]);
    saveAiRoutingPolicy({mode:"single",operationRoutes:{plan:{connectionId:"synthetic-short-model",model:"  GPT  ",fallbackConnectionIds:[]}},requireIndependentEvaluator:false,fallbackToDemo:false});
    const stored=listProviderConnections()[0]!;
    expect(stored.defaultModel).toBe("llm");expect(stored.models).toEqual(["llm","x"]);
    expect(stored.testedModels).toEqual(["x"]);expect(resolveOperationConnection("plan")?.model).toBe("GPT");
  });
  it("retains the exact selected short route before same-connection fallbacks",()=>{
    saveProviderConnections([connection("long-default-model")]);
    saveAiRoutingPolicy({mode:"single",operationRoutes:{plan:{connectionId:"synthetic-short-model",model:"x",fallbackConnectionIds:[]}},requireIndependentEvaluator:false,fallbackToDemo:false});
    expect(resolveOperationConnection("plan")?.model).toBe("x");
    expect(resolveOperationConnections("plan").map(item=>item.model)).toEqual(["x","long-default-model"]);
  });
  it("records a successfully tested short ID and makes it selectable as tested",()=>{
    const original=connection();saveProviderConnections([original]);
    noteModelTested(original,"x","synthetic success",17);
    const stored=listProviderConnections()[0]!;
    expect(stored.testedModels).toEqual(["x"]);
    expect(stored.lastTestStatus).toBe("ok");
    expect(stored.modelLatency?.x).toBe(17);
    expect(listTestedModelChoices().map(item=>item.model)).toEqual(["x"]);
  });
  it("preserves verified short IDs when pruning and recording actual task latency",()=>{
    const original=connection("llm");saveProviderConnections([original]);
    pruneConnectionToTested(original,["llm","x"],{llm:10,x:20});
    noteModelLatency(original.id,"llm",30);
    const stored=listProviderConnections()[0]!;
    expect(stored.modelsExact).toBe(true);
    expect(stored.models).toEqual(["llm","x"]);
    expect(stored.testedModels).toEqual(["llm","x"]);
    expect(stored.modelLatency?.llm).toBe(20);
  });
  it("keeps short per-Mission node selections ahead of fallback routes",()=>{
    saveProviderConnections([connection()]);
    const profile={mode:"project" as const,builder:{connectionId:"synthetic-short-model",model:"llm",label:"Builder"}};
    expect(resolveProjectOperationConnections("build-candidate",profile)[0]?.model).toBe("llm");
  });
});