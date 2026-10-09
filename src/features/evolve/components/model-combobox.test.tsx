import {act} from "react";
import {createRoot} from "react-dom/client";
import {afterEach,beforeEach,describe,expect,it,vi} from "vitest";
import {ModelCombobox} from "./model-combobox";
let host:HTMLDivElement,root:ReturnType<typeof createRoot>;
const changed=vi.fn();
beforeEach(()=>{
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT",true);
  host=document.createElement("div");document.body.append(host);root=createRoot(host);changed.mockReset();
});
afterEach(async()=>{await act(async()=>root.unmount());host.remove();vi.unstubAllGlobals();});
async function render(tested:string[]=[],models=["x","llm","long-model"]){
  await act(async()=>root.render(<ModelCombobox models={models} value="long-model" tested={tested} onChange={changed}/>));
  const input=host.querySelector("input")!;
  await act(async()=>input.focus());
  return input;
}
async function type(input:HTMLInputElement,text:string){
  await act(async()=>{
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value")!.set!.call(input,text);
    input.dispatchEvent(new Event("input",{bubbles:true}));
  });
}
async function key(input:HTMLInputElement,key:string){await act(async()=>input.dispatchEvent(new KeyboardEvent("keydown",{key,bubbles:true})));}
const option=(label:string)=>[...document.querySelectorAll("button")].find(item=>item.textContent?.trim()===label);

describe("committed custom model selection",()=>{
  it("shows and selects a saved one-character ID",async()=>{
    await render();
    const selected=option("x");expect(selected).toBeDefined();
    await act(async()=>selected!.dispatchEvent(new MouseEvent("mousedown",{bubbles:true})));
    expect(changed).toHaveBeenCalledWith("x");
  });
  it("retains a tested short ID in the tested group",async()=>{
    await render(["llm"]);
    expect(option("✓ llm")).toBeDefined();
  });
  it("does not persist a search until the user explicitly commits",async()=>{
    const input=await render();await type(input,"g");expect(changed).not.toHaveBeenCalled();
    await key(input,"Enter");expect(changed).toHaveBeenCalledWith("g");
  });
  it("cancels an uncommitted short search with Escape",async()=>{
    const input=await render();await type(input,"g");await key(input,"Escape");
    expect(changed).not.toHaveBeenCalled();expect(input.value).toBe("long-model");
  });
  it.each(["   ","x".repeat(201)])("does not commit a value outside the shared ID contract",async value=>{
    const input=await render();await type(input,value);await key(input,"Enter");expect(changed).not.toHaveBeenCalled();
  });
});