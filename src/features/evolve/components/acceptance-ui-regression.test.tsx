// @vitest-environment jsdom
import {act} from "react";
import {createRoot,type Root} from "react-dom/client";
import {MemoryRouter} from "react-router-dom";
import {afterEach,beforeEach,describe,expect,it,vi} from "vitest";

const state=vi.hoisted(()=>({projects:[] as unknown[]}));
vi.mock("../runtime/use-local-projects",()=>({useLocalProjects:()=>state.projects}));
vi.mock("../runtime/local-store",()=>({saveLocalProject:vi.fn()}));
vi.mock("@evolution/core",()=>({governProductionLessons:(project:{lessons:unknown[];nextQueue:unknown[]})=>({
  lessons:project.lessons,nextQueue:project.nextQueue,
})}));
import {ProblemsOverview} from "./problems-overview";
import {LearningsOverview} from "./learnings-overview";

let host:HTMLDivElement,root:Root;
beforeEach(()=>{
  (globalThis as {IS_REACT_ACT_ENVIRONMENT?:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
  window.localStorage.clear();
  host=document.createElement("div");document.body.append(host);root=createRoot(host);
  state.projects=[];
});
afterEach(async()=>{
  await act(async()=>root.unmount());
  host.remove();
});
async function clickLabel(label:string){
  const button=[...host.querySelectorAll("button")].find(item=>item.textContent?.includes(label));
  expect(button, `cannot find button ${label}`).toBeTruthy();
  await act(async()=>button!.click());
}
const groupExpanded=()=>host.querySelector("button[aria-expanded]")?.getAttribute("aria-expanded");
const render=(component:React.ReactNode)=>act(async()=>root.render(<MemoryRouter>{component}</MemoryRouter>));

describe("F04 group expansion and collapse",()=>{
  it("expands and collapses all visible problem groups using actual aria-expanded",async()=>{
    state.projects=[{
      id:"real-one",name:"Real Mission",
      problems:[{id:"issue-1",title:"Evidence missing",summary:"No citation",impact:12,severity:"high",status:"recommended",evidence:[]}],
      lessons:[],nextQueue:[],
    }];
    await render(<ProblemsOverview/>);
    expect(groupExpanded()).toBe("false");
    await clickLabel("展开全部");
    expect(groupExpanded()).toBe("true");
    expect(host.textContent).toContain("Evidence missing");
    await clickLabel("折叠全部");
    expect(groupExpanded()).toBe("false");
  });
  it("uses the same expansion semantics in learning groups",async()=>{
    state.projects=[{
      id:"real-two",name:"Learning Mission",problems:[],nextQueue:[],
      lessons:[{id:"lesson-one",status:"lesson",title:"Original Lesson",summary:"Repeatable",method:[],validatedOn:[],trigger:[],limit:"",effect:""}],
    }];
    await render(<LearningsOverview/>);
    expect(groupExpanded()).toBe("false");
    await clickLabel("展开全部");
    expect(groupExpanded()).toBe("true");
    await clickLabel("折叠全部");
    expect(groupExpanded()).toBe("false");
  });
});
