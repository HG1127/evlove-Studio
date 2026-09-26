import {afterEach,describe,expect,it,vi} from "vitest";
import {defaultProjectAiProfile} from "../project-profile";
import {getAiRoutingPolicy,listProviderConnections,listSavedRoutingPresets} from "./registry";

const originalStorage=Object.getOwnPropertyDescriptor(window,"localStorage")!;
afterEach(()=>Object.defineProperty(window,"localStorage",originalStorage));

describe("provider registry with denied browser storage",()=>{
  it("keeps model selection and the Composer render path readable",()=>{
    Object.defineProperty(window,"localStorage",{
      configurable:true,
      get(){throw new DOMException("Storage denied","SecurityError");},
    });
    expect(listProviderConnections()).toEqual([]);
    expect(getAiRoutingPolicy().operationRoutes).toEqual({});
    expect(listSavedRoutingPresets()).toEqual([]);
    expect(defaultProjectAiProfile()).toBeDefined();
  });

  it("does not mark a failed legacy migration complete",()=>{
    const setItem=vi.fn(()=>{throw new DOMException("Storage denied","SecurityError");});
    Object.defineProperty(window,"localStorage",{
      configurable:true,
      value:{getItem:vi.fn(()=>null),setItem},
    });
    expect(listProviderConnections()).toEqual([]);
    expect(setItem).toHaveBeenCalledWith("evolve-studio:provider-migration:v2","1");
  });
});
