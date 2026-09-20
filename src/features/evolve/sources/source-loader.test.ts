import { afterEach, expect, it, vi } from "vitest";
import { webcrypto } from "node:crypto";
import { extractSource } from "./source-loader";
import { parseCacheKey } from "./parse-cache";

afterEach(() => vi.unstubAllGlobals());
it("fingerprints exact content, filename and format independently", async () => {
  vi.stubGlobal("crypto", webcrypto);
  const bytes = new TextEncoder().encode("same");
  const key = await parseCacheKey("a.md", "text/plain", bytes);
  expect(key).toBe(await parseCacheKey("a.md", "text/plain", bytes));
  expect(key).not.toBe(await parseCacheKey("b.md", "text/plain", bytes));
  expect(key).not.toBe(await parseCacheKey("a.md", "text/plain", new TextEncoder().encode("edit")));
});
it("preserves original bytes when parsing without worker support", async () => {
  vi.stubGlobal("Worker", undefined);
  const content = "# 完整材料\n" + "真实内容".repeat(40000) + "结尾证据";
  const buffer = new TextEncoder().encode(content);
  const parsed = await extractSource({name:"a.md",mimeType:"text/markdown",buffer});
  expect(parsed.extractedText).toBe(content);
  expect(new TextDecoder().decode(buffer)).toBe(content);
});
