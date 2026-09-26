import {beforeEach,afterEach,describe,expect,it,vi} from "vitest";
import {demoProject} from "../data/mock-project";

const database=vi.hoisted(()=>({projects:undefined as unknown,initialize:vi.fn()}));
vi.mock("./project-database",()=>({
  databaseProjects:()=>database.projects,
  initializeProjectDatabase:database.initialize,
  saveDatabaseProjects:vi.fn(),
  flushProjectDatabase:vi.fn(async()=>undefined),
}));

import {initializeLocalProjects,listLocalProjects} from "./local-store";

const originalStorage=Object.getOwnPropertyDescriptor(window,"localStorage")!;
function denyLocalStorage(){
  Object.defineProperty(window,"localStorage",{
    configurable:true,
    get(){throw new DOMException("Storage denied","SecurityError");},
  });
}

beforeEach(()=>{
  database.projects=undefined;
  database.initialize.mockReset();
});
afterEach(()=>Object.defineProperty(window,"localStorage",originalStorage));

describe("local project startup with denied legacy storage",()=>{
  it("opens authoritative IndexedDB projects when localStorage is denied",async()=>{
    database.initialize.mockImplementation(async()=>{database.projects=[demoProject];});
    denyLocalStorage();
    await expect(initializeLocalProjects()).resolves.toBeUndefined();
    expect(database.initialize).toHaveBeenCalledWith([]);
    expect(listLocalProjects().map((project)=>project.id)).toEqual([demoProject.id]);
  });

  it("fails explicitly when both durable browser stores are unavailable",async()=>{
    database.initialize.mockResolvedValue(undefined);
    denyLocalStorage();
    await expect(initializeLocalProjects()).rejects.toThrow("浏览器项目存储不可用");
    expect(database.initialize).toHaveBeenCalledWith([]);
  });
});
