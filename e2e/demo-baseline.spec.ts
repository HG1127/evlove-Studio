import { expect, test } from "@playwright/test";

test("Demo-only Baseline explains the model gap and preserves its checkpoint until a live Judge is configured", async ({ page }) => {
  test.setTimeout(150_000);
  await page.goto("/#/");
  await page.locator('input[type="file"]').first().setInputFiles({
    name: "research-agent.md",
    mimeType: "text/markdown",
    buffer: Buffer.from("你是一个研究 Agent。针对用户问题输出中文结论，每条结论必须附证据出处，不能编造来源。"),
  });
  await page.getByPlaceholder(/告诉 AI 你要怎么进化/).fill("为重要结论加入证据检查和风险反证，保留中文输出。");
  await page.getByRole("button", { name: "发送进化要求" }).click();
  await expect(page).toHaveURL(/#\/projects\/[^?]+\?autostart=1/, { timeout: 60_000 });
  await expect(page.getByRole("heading", { name: "当前基线需要真实 AI 评审" })).toBeVisible({ timeout: 90_000 });
  await expect(page.getByRole("link", { name: "AI 模型与连接" }).last()).toBeVisible();
  await expect(page.getByText("调整轮数、预算或时间边界后再继续")).toHaveCount(0);
  await page.getByRole("button", { name: "配置完成，重新测量基线" }).click();
  await expect(page.getByRole("alert")).toContainText("请先配置并测试真实评审模型");
  await expect(page.getByRole("heading", { name: "当前基线需要真实 AI 评审" })).toBeVisible();
  await expect.poll(async () => page.evaluate(() => {
    const entries = JSON.parse(localStorage.getItem("evolve-studio:run-activity:v1") ?? "[]") as Array<{ label?: string }>;
    return entries.some((entry) => entry.label?.includes("基线重测未启动"));
  })).toBe(true);
  const activity = await page.evaluate(() => {
    const entries = JSON.parse(localStorage.getItem("evolve-studio:run-activity:v1") ?? "[]") as Array<{ label?: string }>;
    return entries.map((entry) => entry.label ?? "");
  });
  expect(activity.filter((label) => label.startsWith("Round 1 暂停："))).toHaveLength(1);
  expect(activity.some((label) => label.includes("复用上一轮 Baseline"))).toBe(false);
});