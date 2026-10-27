import {expect,test} from "@playwright/test";

test("the browser can import public adapters and parse a Mission without loading Node telemetry",async({page,baseURL})=>{
  const origin=new URL(baseURL!).origin,pageErrors:string[]=[];
  page.on("pageerror",error=>pageErrors.push(error.message));
  await page.route("**/*",route=>{
    const url=new URL(route.request().url());
    if(url.origin!==origin||url.pathname.startsWith("/api/"))return route.abort();
    return route.continue();
  });
  await page.goto("/");
  await expect(page.getByRole("heading",{name:"工作台"})).toBeVisible();
  const parsed=await page.evaluate(async()=>{
    const publicEntry="/packages/adapters/src/index.ts",fixture="/src/features/evolve/data/mock-project.ts";
    const adapters=await import(/* @vite-ignore */publicEntry) as typeof import("@evolution/adapters");
    const {demoProject}=await import(/* @vite-ignore */fixture) as typeof import("../src/features/evolve/data/mock-project");
    const result=adapters.parseStoredEvolveProject(demoProject);
    return {id:result.id,expectedId:demoProject.id,publicParser:typeof adapters.parseStoredEvolveProject};
  });
  expect(parsed.publicParser).toBe("function");expect(parsed.id).toBe(parsed.expectedId);
  expect(pageErrors).toEqual([]);
});
