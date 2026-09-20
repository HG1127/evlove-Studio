import { afterEach, expect, it, vi } from "vitest";
import { builtinRunnerGateway, getRunnerGatewayConfig, isBuiltinRunnerGateway, resetRunnerGatewayConfig, saveRunnerGatewayConfig, testRunnerGateway } from "./target-runner-config";

afterEach(() => { vi.unstubAllGlobals(); window.localStorage.clear(); });
it("旧内置地址迁移至当前域，发布走同域服务端代理且不沿用旧 Token", () => {
  window.localStorage.setItem("evolve-studio:target-runner:v1", JSON.stringify({ enabled: true, label: "内置 Runner 网关", runUrl: "http://127.0.0.1:8000/__runner/run", releaseUrl: "http://old/__runner/release", bearerToken: "old-token" }));
  const config = getRunnerGatewayConfig();
  expect(config.runUrl).toBe(builtinRunnerGateway().runUrl);
  expect(config.releaseUrl).toBe(builtinRunnerGateway().releaseUrl);
  expect(config.bearerToken).toBe("");
});
it("自定义远程执行器保留配置，恢复默认后无需保存地址", () => {
  const custom = { ...builtinRunnerGateway(), label: "CI", runUrl: "https://ci.example.com/__runner/run", releaseUrl: "https://ci.example.com/release" };
  expect(isBuiltinRunnerGateway(custom)).toBe(false);
  saveRunnerGatewayConfig(custom);
  expect(getRunnerGatewayConfig()).toEqual(custom);
  expect(resetRunnerGatewayConfig()).toEqual(builtinRunnerGateway());
});
it("接口在线但无执行能力不能报告就绪", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true, pong: true, protocol: "evolve-runner/2", capabilities: { htmlBrowser: false, build: false, e2e: false } }) }));
  const result = await testRunnerGateway(builtinRunnerGateway());
  expect(result.ok).toBe(false);
  expect(result.message).toContain("没有可用浏览器");
});
it("502 的内置代理错误给出重启指引，不能当作鉴权问题", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 502, json: async () => ({}) }));
  const result = await testRunnerGateway(builtinRunnerGateway());
  expect(result.ok).toBe(false);
  expect(result.message).toContain("重启");
});
