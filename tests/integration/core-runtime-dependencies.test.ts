// @vitest-environment node
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { z } from "zod";

const packageSchema = z.object({
  name: z.literal("@evolution/core"),
  dependencies: z.record(z.string(), z.string()),
  devDependencies: z.record(z.string(), z.string()).optional(),
});
const manifest = packageSchema.parse(JSON.parse(readFileSync(new URL("../../packages/core/package.json", import.meta.url), "utf8")));

describe("Core direct parser/schema runtime dependency ownership", () => {
  it.each(["@babel/parser", "zod"])("declares %s as a direct runtime dependency", name => {
    expect(manifest.dependencies[name]).toBeTruthy();
    expect(manifest.devDependencies?.[name]).toBeUndefined();
  });
});
