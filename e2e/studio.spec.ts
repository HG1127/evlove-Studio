import { expect, test } from "@playwright/test";

test("dashboard exposes the evolution input composer", async ({ page }) => {
  await page.goto("/#/");
  await expect(page.getByText("把当前版本交给 AI，直接开始一次进化")).toBeVisible();
  await expect(page.getByRole("button", { name: "上传附件" })).toBeVisible();
  await expect(page.getByPlaceholder(/告诉 AI 你要怎么进化/)).toBeVisible();
});

test("user can upload a source artifact and create an evolve project", async ({ page }) => {
  await page.goto("/#/projects/new");
  const fileInput = page.locator('input[type="file"]').first();
  await fileInput.setInputFiles({
    name: "agent-prompt.md",
    mimeType: "text/markdown",
    buffer: Buffer.from("你是一个研究 Agent。请输出结论，但当前没有证据检查流程。"),
  });
  await page.getByPlaceholder(/告诉 AI 你要怎么进化/).fill("让这个 Agent 的重要结论都有证据，并加入风险反证，但不要改变输出语言。");
  await page.getByRole("button", { name: "发送进化要求" }).click();
  await expect(page.getByText("AI 已理解本次进化输入")).toBeVisible();
  await expect(page.getByText("agent-prompt.md")).toBeVisible();
  await page.getByRole("button", { name: /创建并开始进化/ }).click();
  await expect(page.getByText("本轮进化输入")).toBeVisible();
  await expect(page.getByText("agent-prompt.md")).toBeVisible();
  await expect(page.getByText(/Original Evolution Command/)).toBeVisible();
});
