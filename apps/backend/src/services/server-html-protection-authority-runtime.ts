import { createHash } from "node:crypto";
import { z } from "zod";
import { HtmlProtectionOwnedRuntimeBindingSchema, HTML_PROTECTION_CLOUD_LIMITS } from "@evolution/adapters/sandbox";
const Module = HtmlProtectionOwnedRuntimeBindingSchema.extend({ text: z.string().max(HTML_PROTECTION_CLOUD_LIMITS.runtimeBytes) }).strict();
/** Deployment-owned loader only. No HTTP/Mission field selects these executable runtime bytes. */
export async function readServerHtmlProtectionAuthorityRuntime(load: () => Promise<unknown> = async () => (await import("virtual:evolution-html-protection-runtime")).default) {
  const runtime = Module.parse(await load()), bytes = Buffer.from(runtime.text, "utf8");
  if (bytes.byteLength !== runtime.byteLength || createHash("sha256").update(bytes).digest("hex") !== runtime.sha256) throw Error("html-protection-owned-runtime-integrity");
  return HtmlProtectionOwnedRuntimeBindingSchema.parse({ version: runtime.version, sha256: runtime.sha256, byteLength: runtime.byteLength });
}
