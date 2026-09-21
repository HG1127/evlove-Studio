import { afterEach, expect, it, vi } from "vitest";
import { builtinRunnerGateway, getRunnerGatewayConfig, isBuiltinRunnerGateway, resetRunnerGatewayConfig, saveRunnerGatewayConfig, testRunnerGateway } from "./target-runner-config";

afterEach(() => { vi.unstubAllGlobals(); window.localStorage.clear(); });
it("旧 Runner 地址/Token 会迁移为同源 Server Target Proxy", () => {
  window.localStorage.setItem("evolve-studio:target-runner:v1", JSON.stringify({ enabled: true, label: "内置 Runner 网关", runUrl: "http://127.0.0.1:8000/__runner/run", releaseUrl: "http://old/__runner/release", bearerToken: "old-token" }));
  const config = getRunnerGatewayConfig();
  expect(config.runUrl).toBe(builtinRunnerGateway().runUrl);
  expect(config.releaseUrl).toBe(builtinRunnerGateway().releaseUrl);
  expect(JSON.stringify(config)).not.toContain("old-token");
});
it("自定义远程地址不会继续保存在浏览器", () => {
  const custom = { ...builtinRunnerGateway(), label: "CI", runUrl: "https://ci.example.com/__runner/run", releaseUrl: "https://ci.example.com/release" };
  expect(isBuiltinRunnerGateway(custom)).toBe(false);
  saveRunnerGatewayConfig(custom);
  expect(getRunnerGatewayConfig()).toMatchObject({runUrl:"/api/evolution/target-run",releaseUrl:"/api/evolution/target-release",label:"CI"});
  expect(resetRunnerGatewayConfig()).toEqual(builtinRunnerGateway());
});
it("Server Proxy 在线但未配置 Run endpoint 不能报告就绪", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ codeReady:true,runConfigured:false,releaseConfigured:false }) }));
  const result = await testRunnerGateway(builtinRunnerGateway());
  expect(result.ok).toBe(false);
  expect(result.message).toContain("尚未配置");
});
it("Server Proxy HTTP 错误不能当作连接成功", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 502, json: async () => ({}) }));
  const result = await testRunnerGateway(builtinRunnerGateway());
  expect(result.ok).toBe(false);
  expect(result.message).toContain("502");
});
