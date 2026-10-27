import { expect, test } from "@playwright/test";

test("dashboard exposes the evolution input composer", async ({ page }) => {
  await page.goto("/#/");
  await expect(page.getByRole("heading", { name: "工作台" })).toBeVisible();
  await expect(page.getByRole("button", { name: "上传附件" })).toBeVisible();
  await expect(page.getByPlaceholder(/告诉 AI 你要怎么进化/)).toBeVisible();
});

test("user can upload a source artifact and create an evolve project", async ({ page }) => {
  await page.goto("/#/");
  const fileInput = page.locator('input[type="file"]').first();
  await fileInput.setInputFiles({
    name: "agent-prompt.md",
    mimeType: "text/markdown",
    buffer: Buffer.from("你是一个研究 Agent。请输出结论，但当前没有证据检查流程。"),
  });
  await page.getByPlaceholder(/告诉 AI 你要怎么进化/).fill("让这个 Agent 的重要结论都有证据，并加入风险反证，但不要改变输出语言。");
  await page.getByRole("button", { name: "发送进化要求" }).click();
  await expect(page).toHaveURL(/#\/projects\/[^?]+\?autostart=1/, { timeout: 60_000 });
  await expect(page.getByRole("heading", { name: /agent-prompt/ })).toBeVisible();
  const missionId = new URL(page.url()).hash.match(/^#\/projects\/([^?]+)/)?.[1];
  expect(missionId).toBeTruthy();
  await expect.poll(async () => page.evaluate(({ missionId }) => {
    const entries = JSON.parse(localStorage.getItem("evolve-studio:run-activity:v1") ?? "[]") as Array<{ projectId?: string; label?: string }>;
    return entries.filter((entry) => entry.projectId === missionId && entry.label?.startsWith("自主进化开始 · Orchestrator")).length;
  }, { missionId })).toBe(1);
  await page.getByRole("button", { name: /1 · 输入任务/ }).click();
  await page.getByText("查看解析覆盖与证据详情").click();
  await expect(page.getByText("agent-prompt.md", { exact: true }).first()).toBeVisible();
  await page.getByText("补充材料、修正类型或修改原始要求").click();
  await page.getByPlaceholder(/告诉 AI 这次要怎么进化/).fill("请把每条结论绑定原始证据，并保留中文版输出。");
  const update = page.getByRole("button", { name: "更新并自动进化" });
  await expect(update).toBeEnabled();
  await update.click();
  await expect(page.getByRole("button", { name: /2 · 自动进化/ })).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: /1 · 输入任务/ }).click();
  await expect(page.getByRole("button", { name: /1 · 输入任务/ })).toHaveAttribute("aria-pressed", "true");
});

test("release governance route renders its real Outcome entry point", async ({ page },testInfo) => {
  const errors:string[]=[],failedRequests:Array<{origin:string;path:string;error?:string}>=[];
  page.on("pageerror",error=>errors.push(error.message));
  page.on("requestfailed",request=>{const url=new URL(request.url());failedRequests.push({origin:url.origin,path:url.pathname,error:request.failure()?.errorText});});
  try{
    await page.goto("/#/releases");
    await expect(page.getByRole("heading", { name: "发布治理" })).toBeVisible();
    expect(errors).toEqual([]);
  }finally{
    const body=await page.locator("body").innerText({timeout:1000}).catch(()=>"Body unavailable");
    await testInfo.attach("release-route-observations.json",{body:Buffer.from(JSON.stringify({errors,failedRequests,body:body.slice(0,5000)},null,2)),contentType:"application/json"});
  }
});
