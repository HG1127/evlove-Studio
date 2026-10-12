// @vitest-environment node
import { describe, expect, it } from "vitest";
import { decodeArtifactUtf8 } from "./artifact-utf8";

describe("Artifact UTF-8 byte preservation", () => {
  it.each(["", "plain\r\ntext", "\ufeff原文 😀 é\r\n", "\ufeff\ufeffdouble BOM", "embedded\ufeffBOM"])("roundtrips %j without normalization", (text) => {
    const bytes = new TextEncoder().encode(text);
    expect(decodeArtifactUtf8(bytes)).toBe(text);
    expect(decodeArtifactUtf8(bytes.buffer)).toBe(text);
    expect(new TextEncoder().encode(decodeArtifactUtf8(bytes))).toEqual(bytes);
  });
  it("reads only the selected byte view", () => {
    const bytes = new Uint8Array([0xff, 0xef, 0xbb, 0xbf, 0x41, 0xff]);
    expect(decodeArtifactUtf8(bytes.subarray(1, 5))).toBe("\ufeffA");
  });
  it.each([[0xc3, 0x28], [0xef, 0xbb], [0xc0, 0xaf], [0xed, 0xa0, 0x80]])("refuses malformed UTF-8 %j", (...values) => {
    expect(() => decodeArtifactUtf8(new Uint8Array(values))).toThrow();
  });
});