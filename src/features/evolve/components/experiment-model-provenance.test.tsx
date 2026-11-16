// @vitest-environment jsdom
import {act} from "react";
import {createRoot,type Root} from "react-dom/client";
import {MemoryRouter} from "react-router-dom";
import {afterEach,beforeEach,describe,expect,it,vi} from "vitest";
import {demoProject} from "../data/mock-project";

const state=vi.hoisted(()=>({
  mode:"http" as "http"|"local",
  projects:[] as unknown[],
}));
vi.mock("../runtime/production-runtime",()=>({productionRuntimeMode:()=>state.mode}));
vi.mock("../runtime/use-local-projects",()=>({useLocalProjects:()=>state.projects}));
import {ExperimentsOverview} from "./experiments-overview";

let host:HTMLDivElement,root:Root;
const vault=(role:"generation"|"judge")=>({
  configured:true,storageConfigured:true,revision:role==="generation"?4:2,message:"saved",
  connection:{
    connectionId:role,label:"Minimax",baseUrl:"https://model.provider.example/v1",
    model:role==="generation"?"MiniMax-M3":"MiniMax-M3.1-Flash",
    protocol:"chat-completions",responseFormat:"json-object",
  },
});
const reply=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status});
beforeEach(()=>{
  (globalThis as {IS_REACT_ACT_ENVIRONMENT?:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
  state.mode="http";state.projects=[];
  host=document.createElement("div");document.body.append(host);root=createRoot(host);
});
afterEach(async()=>{
  await act(async()=>root.unmount());host.remove();vi.unstubAllGlobals();
});
const render=async()=>{
  await act(async()=>{root.render(<MemoryRouter><ExperimentsOverview/></MemoryRouter>);});
};

describe("F03 experiment model provenance: saved Vault versus actual execution",()=>{
  it("reads both backend Vault roles by GET only, without inventing actual experiment model identity",async()=>{
    const fetch=vi.fn(async(url:string,init?:RequestInit)=>{
      if(init?.method&&init.method!=="GET")throw new Error("Unexpected mutation request");
      return reply(vault(url.includes("ai-judge-connection")?"judge":"generation"));
    });
    vi.stubGlobal("fetch",fetch);
    await render();
    const text=host.textContent||"";
    expect(text).toContain("生成运行：暂无实验记录");
    expect(text).toContain("评测运行：暂无实验记录");
    expect(text).toContain("后端 Vault 生成：已保存 · Minimax · MiniMax-M3（版本 4；真实调用未验证）");
    expect(text).toContain("后端 Vault 独立 Judge：已保存 · Minimax · MiniMax-M3.1-Flash（版本 2；真实调用未验证）");
    expect(text).toContain("浏览器本地 BYOK 路由与后端 Vault 是不同配置来源");
    expect(text).not.toContain("unavailable / unavailable");
    expect(text).not.toContain("synthetic-api-key");
    expect(host.querySelector('a[href="/settings"]')).not.toBeNull();
    expect(fetch.mock.calls.map(call=>call[0])).toEqual([
      "/api/evolution/ai-connection","/api/evolution/ai-judge-connection",
    ]);
    expect(fetch.mock.calls.every(call=>call[1]?.method===undefined)).toBe(true);
    expect(fetch.mock.calls.some(call=>String(call[0]).includes("ai-health")||call[1]?.method==="PUT"||call[1]?.method==="POST")).toBe(false);
  });

  it("keeps a read failure isolated instead of falsely reporting a missing Judge or missing API key",async()=>{
    const fetch=vi.fn(async(url:string)=>
      url.includes("ai-judge-connection")?reply({statusMessage:"unavailable"},503):reply(vault("generation")));
    vi.stubGlobal("fetch",fetch);
    await render();
    const text=host.textContent||"";
    expect(text).toContain("生成：已保存 · Minimax · MiniMax-M3");
    expect(text).toContain("后端 Vault 独立 Judge：后端配置读取或回执未确认");
    expect(text).not.toContain("后端没有已保存的此角色配置");
    expect(text).not.toContain("unavailable / unavailable");
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("renders genuinely unconfigured roles without implying a connectivity probe",async()=>{
    const fetch=vi.fn(async()=>reply({configured:false,storageConfigured:true,message:"not configured"}));
    vi.stubGlobal("fetch",fetch);
    await render();
    const text=host.textContent||"";
    expect(text.match(/后端没有已保存的此角色配置/g)).toHaveLength(2);
    expect(text).toContain("已保存的模型不等于已连通或已执行");
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("never reads or claims server Vault in local prototype mode",async()=>{
    state.mode="local";
    const fetch=vi.fn();
    vi.stubGlobal("fetch",fetch);
    await render();
    const text=host.textContent||"";
    expect(text).toContain("当前为浏览器本地原型");
    expect(text).toContain("生成运行：暂无实验记录");
    expect(text).not.toContain("已保存 · Minimax");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("preserves local prototype planned routing labels without treating them as executed Judge evidence",async()=>{
    state.mode="local";
    state.projects=[{
      ...demoProject,id:"prototype-experiment",name:"Local experiment",
      experimentRun:{...demoProject.experimentRun,status:"running"},
    }];
    const fetch=vi.fn();
    vi.stubGlobal("fetch",fetch);
    await render();
    const text=host.textContent||"";
    expect(text).toContain("生成运行：本地预设");
    expect(text).toContain("评测运行：本地预设");
    expect(text).toContain("非运行证据");
    expect(text).toContain("本地路由预设（不代表实际实验模型）");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("keeps real experiment execution identity separate from the current saved model",async()=>{
    state.projects=[{
      ...demoProject,id:"trusted-real-mission",name:"Example verified Mission",
      experimentRun:{...demoProject.experimentRun,status:"running"},
    }];
    const fetch=vi.fn(async(url:string)=>
      reply(vault(url.includes("ai-judge-connection")?"judge":"generation")));
    vi.stubGlobal("fetch",fetch);
    await render();
    const text=host.textContent||"";
    expect(text).toContain("生成运行：身份需以 Run / Trace 核验");
    expect(text).toContain("评测运行：身份需以 Judge / Trace 核验");
    expect(text).toContain("后端 Vault 独立 Judge：已保存 · Minimax · MiniMax-M3.1-Flash");
    expect(text).toContain("后端保存状态不代表已执行评测");
  });
});
