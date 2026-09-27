import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { indexServerCodebaseZip } from "./server-codebase-zip-index";

function findBytes(haystack: Uint8Array, needle: Uint8Array) {
  for (let offset = 0; offset <= haystack.length - needle.length; offset += 1) {
    if (needle.every((byte, index) => haystack[offset + index] === byte)) return offset;
  }
  return -1;
}

describe("Server codebase ZIP index", () => {
  it("rejects a text entry whose bytes disagree with its CRC", async () => {
    const zip = new JSZip();
    zip.file("src/config.ts", "CRC-BOUND-SOURCE");
    const bytes = new Uint8Array(await zip.generateAsync({ type: "uint8array", compression: "STORE" }));
    const offset = findBytes(bytes, new TextEncoder().encode("CRC-BOUND-SOURCE"));
    expect(offset).toBeGreaterThan(0);
    bytes[offset]! ^= 1;
    await expect(indexServerCodebaseZip(bytes)).rejects.toThrow("CRC32");
  });

  it("rejects unsafe original paths and ignores binary dependencies", async () => {
    const zip = new JSZip();
    zip.file("../escape.ts", "export const leaked = true");
    await expect(indexServerCodebaseZip(new Uint8Array(await zip.generateAsync({ type: "uint8array" })))).rejects.toThrow("不安全");
    const clean = new JSZip();
    clean.file("src/config.ts", "export const setup = true");
    clean.file("node_modules/large.bin", new Uint8Array(1_000_000));
    const index = await indexServerCodebaseZip(new Uint8Array(await clean.generateAsync({ type: "uint8array", compression: "DEFLATE" })));
    expect(index.fileCount).toBe(2);
    expect(index.textFiles.map((file) => file.path)).toEqual(["src/config.ts"]);
  });
});