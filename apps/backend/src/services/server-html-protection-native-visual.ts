import { createHash } from "node:crypto";
import { z } from "zod";
import { htmlProtectionNativeVisualDelta } from "@evolution/core";
import { validateHtmlProtectionWholeNativeDocument } from "@evolution/adapters/sandbox";
import { htmlProtectionCanonicalJson } from "./server-html-protection-authority-attestation";
const digest=(value:unknown)=>createHash("sha256").update(htmlProtectionCanonicalJson(value)).digest("hex");
const NativeDocument=z.object({realm:z.object({frameId:z.string().min(1)}).passthrough(),value:z.unknown()}).passthrough();
/** Only private native readback after the full custody/producer checks may enter this function. */
export function prepareServerHtmlProtectionNativeVisualComparison(originalRaw:unknown,executedRaw:unknown) {
  const left=NativeDocument.parse(originalRaw),right=NativeDocument.parse(executedRaw);
  const original=validateHtmlProtectionWholeNativeDocument(left.value,left.realm.frameId),
    executed=validateHtmlProtectionWholeNativeDocument(right.value,right.realm.frameId);
  const delta=htmlProtectionNativeVisualDelta(original,executed);
  const comparison={originalMaterialSha256:digest(originalRaw),executedMaterialSha256:digest(executedRaw),delta};
  // Never sample or truncate a large complete comparison. Absence/overflow must remain a capability gap.
  if(Buffer.byteLength(htmlProtectionCanonicalJson(comparison),"utf8")>4*1024*1024)throw Error("operational-native-visual-full-comparison-budget-exceeded");
  return {...comparison,sha256:digest(comparison)};
}
