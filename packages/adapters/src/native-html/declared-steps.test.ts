// @vitest-environment node
import {runInNewContext} from "node:vm";
import {describe,expect,it,vi} from "vitest";
import type {HtmlNativeBrowserAssertions} from "@evolution/contracts";
import {HTML_NATIVE_DECLARED_STEPS_SOURCE} from "./declared-steps";

// Execute only the trusted function with a synthetic page port. No browser or user document runs on the host.
const execute=runInNewContext(`(${HTML_NATIVE_DECLARED_STEPS_SOURCE})`) as (page:unknown,assertions:HtmlNativeBrowserAssertions|undefined,record:ReturnType<typeof vi.fn>)=>Promise<void>;
const plan:HtmlNativeBrowserAssertions={schemaVersion:"source-grounded-browser-assertions-v1",plans:[[
  {action:"visible",selector:"#search"},{action:"fill",selector:"#search",value:"missing"},
  {action:"count",selector:".matches",count:0},{action:"text",selector:"#count",value:"0 页命中"},
  {action:"fill",selector:"#search",value:""},{action:"visible",selector:"#first"},
]]};
function pagePort(){
  let query="";
  return {reload:vi.fn(async()=>{query="";}),locator:vi.fn((selector:string)=>({
    fill:vi.fn(async(value:string)=>{query=value;}),isVisible:vi.fn(async()=>selector==="#search"||query===""),
    count:vi.fn(async()=>query==="missing"?0:2),innerText:vi.fn(async()=>"搜索：0 页命中"),
  }))};
}
describe("native execution of unchanged declared predicates",()=>{
  it("executes each ordered predicate, uses the existing Runner text semantics, and restores the profile start state",async()=>{
    const page=pagePort(),record=vi.fn();await execute(page,plan,record);
    expect(page.locator.mock.calls.map(([selector])=>selector)).toEqual(plan.plans[0]!.map(step=>step.selector));
    expect(record.mock.calls).toEqual(plan.plans[0]!.map((_,index)=>[`declared-browser-0-${index}`,true,{tested:1,failed:0}]));
    expect(page.reload).toHaveBeenCalledTimes(2);
  });
  it("records assertion and action failures without dropping remaining restoration predicates",async()=>{
    const page=pagePort(),record=vi.fn(),normal=page.locator.getMockImplementation()!;
    page.locator.mockImplementation(selector=>({...normal(selector),fill:vi.fn(async()=>{throw Error("synthetic action failure");})}));
    await execute(page,plan,record);
    expect(record.mock.calls).toHaveLength(6);
    expect(record.mock.calls[1]).toEqual(["declared-browser-0-1",false,{tested:1,failed:1}]);
    expect(record.mock.calls[2]?.[1]).toBe(false);
    expect(record.mock.calls.at(-1)?.[0]).toBe("declared-browser-0-5");
  });
  it("keeps distinct plans separate and does no declared work for a legacy receipt",async()=>{
    const page=pagePort(),record=vi.fn();await execute(page,undefined,record);
    expect(record).not.toHaveBeenCalled();expect(page.reload).not.toHaveBeenCalled();
    await execute(page,{...plan,plans:[plan.plans[0]!,[{action:"visible",selector:"#search"}]]},record);
    expect(record.mock.calls.at(-1)?.[0]).toBe("declared-browser-1-0");
    expect(page.reload).toHaveBeenCalledTimes(3);
  });
});
