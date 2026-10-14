import { selectHtmlProtectionWholeClipboardValueProfile } from "@evolution/core";
import type { HtmlProtectionWholeRuntimeRequest } from "@evolution/contracts";
import type { HtmlProtectionOwnedDocument } from "./html-protection-owned-document";
import type { HtmlProtectionWholeNativeObserver } from "./html-protection-whole-native-observer";
import { HtmlProtectionWholeNativeGap } from "./html-protection-whole-native-observer";
import type { HtmlProtectionOwnedScriptCoverage } from "./html-protection-whole-script-coverage";
export async function prepareOwnedHtmlProtectionClipboardExpectation(args: {
 request: HtmlProtectionWholeRuntimeRequest; nativeEvents: unknown; owned: HtmlProtectionOwnedDocument;
 sourceCoverage: HtmlProtectionOwnedScriptCoverage | undefined; native: HtmlProtectionWholeNativeObserver; selector: string;
}) {
 const selected = selectHtmlProtectionWholeClipboardValueProfile({ sourcePlan: args.request.sourcePlan, subjectScriptLocations: args.request.subjectScriptLocations, nativeEvents: args.nativeEvents });
 if (selected.availability !== "available") return { availability: "unavailable" as const, gaps: selected.gaps };
 if (await args.native.backendNodeId(args.selector) !== selected.profile.nativeBackendNodeId) return { availability: "unavailable" as const, gaps: ["actual-clipboard-native-listener-target-drift"] };
 const source = selected.profile.nativeFrameId === args.owned.custody.navigation.frameId && args.sourceCoverage ? await args.sourceCoverage.verifySource({ sourcePlan: args.request.sourcePlan, subjectScriptLocations: args.request.subjectScriptLocations, frameId: args.owned.custody.navigation.frameId, documentUrl: args.owned.custody.documentUrl, parentId: selected.profile.parentId, scriptId: selected.profile.nativeScriptId, contextUniqueId: selected.profile.nativeContextUniqueId }) : { availability: "unavailable" as const, gaps: ["actual-clipboard-script-source-binding-unavailable"] };
 await args.owned.assertCurrent(); if (source.availability !== "available") return { availability: "unavailable" as const, gaps: ["actual-clipboard-script-source-binding-unavailable"] };
 try {
  const before = await args.native.clipboardValue(args.selector, selected.profile.program, { scriptId: selected.profile.nativeScriptId, lineNumber: selected.profile.nativeLineNumber, columnNumber: selected.profile.nativeColumnNumber });
  return { availability: "available" as const, profile: selected.profile, source: source.source, before };
 } catch (error) { if (error instanceof HtmlProtectionWholeNativeGap) throw error; await args.owned.assertCurrent(); return { availability: "unavailable" as const, gaps: ["actual-clipboard-native-expected-value-unavailable"] }; }
}
export async function finishOwnedHtmlProtectionClipboardExpectation(args: {
 prepared: Awaited<ReturnType<typeof prepareOwnedHtmlProtectionClipboardExpectation>>; native: HtmlProtectionWholeNativeObserver;
 owned: HtmlProtectionOwnedDocument; selector: string; actualText: string;
}) {
 const prepared = args.prepared; if (prepared.availability !== "available") return prepared;
 try {
  const profile = prepared.profile, after = await args.native.clipboardValue(args.selector, profile.program, { scriptId: profile.nativeScriptId, lineNumber: profile.nativeLineNumber, columnNumber: profile.nativeColumnNumber });
  if (prepared.before.value.text !== after.value.text) return { ...prepared, availability: "unavailable" as const, after, gaps: ["actual-clipboard-expected-value-changed-during-action"] };
  if (prepared.before.value.text !== args.actualText) return { ...prepared, after, availability: "unavailable" as const, gaps: [prepared.profile.program.kind === "control-dataset-element-text" ? "actual-clipboard-DOM-value-continuity-unproved" : "actual-clipboard-handler-execution-continuity-unproved"] };
  return { ...prepared, after, availability: "observed" as const };
 } catch (error) { if (error instanceof HtmlProtectionWholeNativeGap) throw error; await args.owned.assertCurrent(); return { ...prepared, availability: "unavailable" as const, gaps: ["actual-clipboard-native-expected-value-unavailable"] }; }
}
