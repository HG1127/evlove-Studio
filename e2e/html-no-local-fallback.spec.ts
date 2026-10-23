import {readFile} from "node:fs/promises";
import {test,expect} from "@playwright/test";

// Browser-only test of the real Studio input -> navigation -> AutoPilot
// safety boundary. Not an authorized Vercel Sandbox execution proof.
test("HTML project never silently falls back from Server to local Harness",async({page})=>{
  const source=await readFile(new URL("./fixtures/search-source.html",import.meta.url));
  await page.goto("/#/");
  await expect(page.getByRole("heading",{name:"工作台"})).toBeVisible();
  await page.locator('input[type="file"]').first().setInputFiles({
    name:"audit-search.html",mimeType:"text/html",buffer:source,
  });
  await page.getByPlaceholder(/告诉 AI 你要怎么进化/).fill(
    "修复搜索功能：输入 alpha 必须命中 Alpha 卡片、输入不存在的词显示零结果、清空搜索恢复两张卡片。保留移动端使用体验。",
  );
  await page.getByRole("button",{name:"发送进化要求"}).click();
  await expect(page).toHaveURL(/#\/projects\/[^?]+\?autostart=1/,{timeout:60_000});
  // This fresh HTML input is not yet a persisted Server Mission.
  // A missing durable record must block before any fake local Runner starts.
  const status=page.getByRole("region",{name:"真实后端运行状态"});
  await expect(status).toBeVisible();
  // Pending or failed backend reads both keep HTML local execution disabled.
  // Do not require a timing-sensitive HTTP 404 in the Vite test runtime.
  await expect(page.getByRole("button",{name:"开始自主进化"})).toBeDisabled();
  const id=new URL(page.url()).hash.match(/^#\/projects\/([^?]+)/)?.[1];
  expect(id).toBeTruthy();
  const localEvents=await page.evaluate((missionId)=>{
    const log=JSON.parse(localStorage.getItem("evolve-studio:run-activity:v1")??"[]") as Array<{projectId?:string;label?:string}>;
    return log.filter(item=>item.projectId===missionId).map(item=>item.label??"");
  },id!);
  // The advanced manual buttons are deliberately disabled for HTML Targets;
  // a user must not bypass the AutoPilot cloud authorization boundary.
  await page.getByRole("button",{name:"高级设置"}).click();
  const advanced=page.getByText("高级控制：搜索策略、预算、定时与手动运行");
  await expect(advanced).toBeVisible();
  await advanced.click();
  const binding=await page.evaluate(async(missionId)=>{
    const [{getLocalProject},{requiresIsolatedHtmlServerExecution}]=await Promise.all([
      import("/src/features/evolve/runtime/local-store.ts"),
      import("/src/features/evolve/runtime/server-workflow-client.ts"),
    ]);
    const project=getLocalProject(missionId);
    return {adapter:project?.targetConnection.adapter,
      isolated:project?requiresIsolatedHtmlServerExecution(project):false,
      targetExtensions:project?.sourceArtifacts.filter(a=>a.role==="target").map(a=>a.extension)};
  },id!);
  expect(binding).toMatchObject({adapter:"artifact",isolated:true,targetExtensions:["html"]});
  await expect(page.getByRole("button",{name:"运行下一轮"})).toBeDisabled();
  await expect(page.getByRole("button",{name:"自动运行到停止条件"})).toBeDisabled();
  await expect(page.getByText("HTML 本地轮次与本地验证已禁用")).toBeVisible();
  // An already persisted legacy auto-bound HTTP Proxy is explicitly repairable.
  // Never silently treat that Proxy as an executable HTML Target.
  await page.evaluate(async(missionId)=>{
    const {getLocalProject,saveLocalProject}=await import("/src/features/evolve/runtime/local-store.ts");
    const project=getLocalProject(missionId);
    if(!project)throw Error("Imported audit project missing");
    saveLocalProject({...project,targetConnection:{adapter:"http",connectionId:"runner-gateway",
      status:"connected",label:"Server Target Proxy"}});
  },id!);
  await page.reload();
  // autostart=1 selects the default flow view again on reload.
  await page.getByRole("button",{name:"高级设置"}).click();
  await page.getByText("高级控制：搜索策略、预算、定时与手动运行").click();
  await expect(page.getByText("发现旧版 Target 自动绑定错误")).toBeVisible();
  await expect(page.getByRole("button",{name:"运行下一轮"})).toBeDisabled();
  await page.getByRole("button",{name:"恢复 HTML 文件 Target"}).click();
  await expect(page.getByText("发现旧版 Target 自动绑定错误")).toHaveCount(0);
  const corrected=await page.evaluate(async missionId=>{
    const {getLocalProject}=await import("/src/features/evolve/runtime/local-store.ts");
    return getLocalProject(missionId)?.targetConnection.adapter;
  },id!);
  expect(corrected).toBe("artifact");
  expect(localEvents.some(label=>label.includes("自主进化开始 · Orchestrator 接管"))).toBe(false);
});
