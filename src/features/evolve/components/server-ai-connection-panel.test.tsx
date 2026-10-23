// @vitest-environment jsdom
import {act} from "react";
import {createRoot} from "react-dom/client";
import {afterEach,beforeEach,describe,expect,it,vi} from "vitest";
const client=vi.hoisted(()=>({read:vi.fn(),save:vi.fn(),test:vi.fn()}));
vi.mock("../ai/server-connection-client",()=>({
  readServerAiConnection:client.read,saveServerAiConnection:client.save,testServerAiConnection:client.test,
}));
import {ServerAiConnectionPanel} from "./server-ai-connection-panel";
const selected={
  id:"user-defined",providerId:"custom",label:"自定义接口",enabled:true,
  apiKey:"private",baseUrl:"https://my.example.test/v1",defaultModel:"anything-user-chooses",
  models:[],createdAt:"now",updatedAt:"now",
};
let host:HTMLDivElement,root:ReturnType<typeof createRoot>;
beforeEach(()=>{
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT",true);
  host=document.createElement("div");document.body.append(host);root=createRoot(host);
  client.read.mockReset().mockResolvedValue({configured:false,storageConfigured:true,message:"none"});
  client.save.mockReset().mockResolvedValue({
    configured:true,storageConfigured:true,message:"已保存",connection:{
      connectionId:selected.id,label:selected.label,baseUrl:selected.baseUrl,model:selected.defaultModel,
      protocol:"chat-completions",responseFormat:"json-object",
    },
  });
  client.test.mockReset().mockResolvedValue({ready:true,message:"ready"});
});
afterEach(async()=>{await act(async()=>root.unmount());host.remove();vi.unstubAllGlobals();});
const button=(label:string)=>[...host.querySelectorAll("button")].find((item)=>item.textContent===label)!;
async function render(connection=selected){
  await act(async()=>root.render(<ServerAiConnectionPanel selected={connection}/>));
}
describe("custom model for backend tasks",()=>{
  it("saves the selected arbitrary URL/model and never renders its key",async()=>{
    await render();
    await act(async()=>button("保存为后端默认模型").click());
    expect(client.save).toHaveBeenCalledWith(expect.objectContaining({
      apiKey:"private",baseUrl:selected.baseUrl,model:"anything-user-chooses",
    }));
    expect(host.textContent).not.toContain("private");
    expect(host.textContent).toContain("当前后端默认：");
  });
  it("restores the saved protocol and JSON mode for the selected backend connection",async()=>{
    client.read.mockResolvedValue({
      configured:true,storageConfigured:true,message:"saved",connection:{
        connectionId:selected.id,label:selected.label,baseUrl:selected.baseUrl,model:selected.defaultModel,
        protocol:"responses",responseFormat:"prompt-json",
      },
    });
    await render();
    await act(async()=>button("测试后端调用").click());
    expect(client.test).toHaveBeenCalledWith(expect.objectContaining({protocol:"responses",responseFormat:"prompt-json"}));
  });
  it("tests a draft without saving it or claiming task acceptance",async()=>{
    await render();
    await act(async()=>button("测试后端调用").click());
    expect(host.textContent).toContain("后端真实模型调用通过");
    expect(client.save).not.toHaveBeenCalled();
  });
  it("restores saving after the backend encryption configuration becomes available",async()=>{
    client.read.mockResolvedValueOnce({configured:false,storageConfigured:false,message:"加密保存尚未启用"});
    await render();
    expect(button("保存为后端默认模型").disabled).toBe(true);
    expect(button("测试后端调用").disabled).toBe(false);
    client.read.mockResolvedValueOnce({configured:false,storageConfigured:true,message:"ready"});
    await act(async()=>button("重新检查保存状态").click());
    expect(button("保存为后端默认模型").disabled).toBe(false);
    expect(host.textContent).toContain("保存服务已就绪");
  });
  it("does not imply saving is available after a successful probe when storage is unconfigured",async()=>{
    client.read.mockResolvedValueOnce({configured:false,storageConfigured:false,message:"加密保存尚未启用"});
    await render();
    await act(async()=>button("测试后端调用").click());
    expect(host.textContent).toContain("加密保存服务启用后");
    expect(button("保存为后端默认模型").disabled).toBe(true);
  });
  it("does not save an incomplete custom connection",async()=>{
    await render({...selected,apiKey:""});
    expect(button("保存为后端默认模型").disabled).toBe(true);
    expect(button("测试后端调用").disabled).toBe(true);
  });
  it("shows backend access failures and retains the selected browser connection",async()=>{
    client.read.mockRejectedValue(new Error("请先连接后端工作区"));
    await render();
    expect(host.querySelector('[role="status"]')?.textContent).toBe("请先连接后端工作区");
    expect(selected.apiKey).toBe("private");
  });
});
