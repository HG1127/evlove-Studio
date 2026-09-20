import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, it, expect, vi } from "vitest";
vi.mock("../../../components/ui/button", () => ({ Button: (props: import("react").ButtonHTMLAttributes<HTMLButtonElement>) => <button {...props}/> }));
import { BaselineRetryAction } from "./baseline-retry-action";

describe("补跑按钮真实点击", () => {
 it("点击即调用执行入口，等待期间显示反馈并阻止重复点击", async () => {
  const host = document.createElement("div"); document.body.append(host);
  const root = createRoot(host);
  let finish!: (value: unknown) => void;
  const retry = vi.fn(() => new Promise(resolve => { finish = resolve; }));
  await act(async () => root.render(<BaselineRetryAction busy={false} retry={retry}/>));
  await act(async () => host.querySelector("button")!.click());
  expect(retry).toHaveBeenCalledTimes(1);
  expect(host.textContent).toContain("已收到补跑请求");
  expect(host.querySelector("button")!.disabled).toBe(true);
  await act(async () => finish({status:"completed"}));
  expect(host.textContent).toContain("补跑与评审完成");
  await act(async () => root.unmount()); host.remove();
 });
 it("执行入口异常会显示原因，而不是吞掉错误", async () => {
  const host = document.createElement("div"); document.body.append(host); const root=createRoot(host);
  await act(async()=>root.render(<BaselineRetryAction busy={false} retry={async()=>{throw new Error("Target 未确认");}}/>));
  await act(async()=>host.querySelector("button")!.click());
  expect(host.textContent).toContain("补跑未完成：Target 未确认");
  expect(host.querySelector("button")!.disabled).toBe(false);
  await act(async()=>root.unmount()); host.remove();
 });
});
