import { htmlProtectionCloudCanonicalJson as canonical } from "./vercel-sandbox-html-protection-cloud-protocol";
import { boundHtmlProtectionWholeNativeSession } from "./html-protection-whole-native-deadline";
import { createHash } from "node:crypto";
import { z } from "zod";
import type { Page, BrowserContext } from "@playwright/test";
import type { HtmlProtectionWholeRuntimeSourcePlan, HtmlProtectionWholeRuntimeRequest } from "@evolution/contracts";
import { HtmlProtectionWholeNativeGap, createHtmlProtectionWholeNativeObserver } from "./html-protection-whole-native-observer";

const Context = z.object({ context: z.object({ id: z.number().int(), uniqueId: z.string(), name: z.string(), auxData: z.object({ isDefault: z.boolean(), frameId: z.string() }) }) });
const Script = z.object({ scriptId: z.string(), url: z.string(), executionContextId: z.number().int(), hash: z.string().optional(), startLine: z.number().int().nonnegative(), startColumn: z.number().int().nonnegative() }).passthrough();
const FunctionCoverage = z.object({ functionName: z.string(), isBlockCoverage: z.boolean(), ranges: z.array(z.object({
  startOffset: z.number().int().nonnegative(), endOffset: z.number().int().nonnegative(), count: z.number().int().nonnegative() }).strict().refine(value => value.endOffset >= value.startOffset, "Invalid actual V8 range")).min(1) }).passthrough();
const Coverage = z.object({ result: z.array(z.object({ scriptId: z.string(), url: z.string(), functions: z.array(FunctionCoverage) }).passthrough()), timestamp: z.number() }).passthrough();
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
/** Controller starts before user navigation. Native V8 ranges cannot be replaced by client labels or page console. */
export async function createOwnedHtmlProtectionScriptCoverage(args: { page: Page; context: BrowserContext; signal: AbortSignal; deadline: number }) {
  const cdp = boundHtmlProtectionWholeNativeSession(await args.context.newCDPSession(args.page), args.deadline, args.signal, code => new HtmlProtectionWholeNativeGap(code)), contexts = new Map<number, z.infer<typeof Context>["context"]>(), scripts = new Map<string, z.infer<typeof Script>>();
  let closed = false, overflow = false;
  let bootstrapScope: { phase: "fresh-owned-about-blank-before-subject-navigation-v1"; frameId: string; loaderId: string; url: "about:blank" } | undefined;
  let acceptingBootstrap = true;
  const controllerBootstrap: Array<{ sourceSha256: string; sourceCharacters: number; nativeContextUniqueId: string; nativeFrameId: string }> = [];
  const active = () => { if (closed || args.signal.aborted || Date.now() >= args.deadline || overflow) throw new HtmlProtectionWholeNativeGap("native-script-coverage-owner-unavailable"); };
  cdp.on("Runtime.executionContextCreated", event => { const value = Context.safeParse(event); if (value.success) { if (contexts.size >= 64) overflow = true; else contexts.set(value.data.context.id, value.data.context); } });
  cdp.on("Runtime.executionContextDestroyed", event => { contexts.delete(event.executionContextId); });
  cdp.on("Runtime.executionContextsCleared", () => { contexts.clear(); scripts.clear(); });
  cdp.on("Debugger.scriptParsed", event => { const value = Script.safeParse(event); if (value.success && (acceptingBootstrap || (value.data.executionContextAuxData as { isDefault?: boolean } | undefined)?.isDefault !== false)) { if (scripts.size >= 2048) overflow = true; else scripts.set(value.data.scriptId, value.data); } });
  try {
    // Warm only the fixed driver's serializer on the fresh about:blank Page, before any subject navigation.
    // It reads no task document and supplies no model/page evidence; subsequent helpers require exact complete bootstrap bytes/counts.
    z.object({ frameTree: z.object({ frame: z.object({ url: z.literal("about:blank") }) }) }).parse(await cdp.send("Page.getFrameTree"));

    await cdp.send("Runtime.enable"); active(); await cdp.send("Debugger.enable"); active();
    // Prevent the inspector itself from pausing a document that normally executes without a debugger. No later resume/replay is performed.
    await cdp.send("Debugger.setSkipAllPauses", { skip: true }); active(); await cdp.send("Profiler.enable"); active();
    // Owned WebSocket interception may install a default-realm init program for the next navigation.
    // Materialize it before any subject bytes exist, retaining the actual complete sources instead of a static exemption.
    const previousFrame = z.object({ frameTree: z.object({ frame: z.object({ id: z.string(), loaderId: z.string(), url: z.literal("about:blank") }) }) }).parse(await cdp.send("Page.getFrameTree")).frameTree.frame;
    await cdp.send("Page.enable");
    const blankNavigation = z.object({ frameId: z.literal(previousFrame.id), loaderId: z.string().min(1), errorText: z.string().optional() }).passthrough().parse(await cdp.send("Page.navigate", { url: "about:blank" }));
    if (blankNavigation.errorText || blankNavigation.loaderId === previousFrame.loaderId) throw new HtmlProtectionWholeNativeGap("owned-pre-navigation-controller-navigation-unavailable");
    let bootFrame: { id: string; loaderId: string; url: "about:blank" } | undefined, blankContext: z.infer<typeof Context>["context"] | undefined;
    for (let attempt = 0; attempt < 100 && !blankContext; attempt++) {
      active();
      const frame = z.object({ frameTree: z.object({ frame: z.object({ id: z.literal(previousFrame.id), loaderId: z.string(), url: z.literal("about:blank") }) }) }).parse(await cdp.send("Page.getFrameTree")).frameTree.frame;
      if (frame.loaderId === blankNavigation.loaderId) {
        bootFrame = frame;
        blankContext = [...contexts.values()].find(context => context.auxData.isDefault && context.auxData.frameId === frame.id);
      }
      if (!blankContext) await new Promise<void>(resolve => setTimeout(resolve, 25));
    }
    if (!blankContext || !bootFrame) throw new HtmlProtectionWholeNativeGap("owned-pre-navigation-controller-context-unavailable");
    const preparedFrame = bootFrame;
    // Native inspector serialization code is materialized by callFunctionOn, independently before any user document exists.
    await cdp.send("Runtime.callFunctionOn", { executionContextId: blankContext.id, functionDeclaration: "function() { return undefined; }", returnByValue: true, silent: true }); active();
    bootstrapScope = { phase: "fresh-owned-about-blank-before-subject-navigation-v1", frameId: preparedFrame.id, loaderId: preparedFrame.loaderId, url: "about:blank" };
    const bootstrapNative = await createHtmlProtectionWholeNativeObserver({ ...args, frameId: preparedFrame.id, loaderId: preparedFrame.loaderId, documentUrl: "about:blank",
      assertCurrent: async () => { const current = z.object({ frameTree: z.object({ frame: z.object({ id: z.literal(preparedFrame.id), loaderId: z.literal(preparedFrame.loaderId), url: z.literal("about:blank") }) }) }).parse(await cdp.send("Page.getFrameTree")); if (!current) throw new HtmlProtectionWholeNativeGap("owned-bootstrap-document-drift"); } });
    try {
      await bootstrapNative.census(); await bootstrapNative.viewport(); await bootstrapNative.target("html"); await bootstrapNative.backendNodeId("html");
      await bootstrapNative.document(); await bootstrapNative.visualCapture(() => bootstrapNative.screenshot({ x: 0, y: 0, width: 1, height: 1 }));
    } finally { await bootstrapNative.dispose(); }
    for (const [scriptId, parsed] of scripts) {
      const context = contexts.get(parsed.executionContextId);
      if (!context || !context.auxData.isDefault || context.auxData.frameId !== preparedFrame.id) continue;
      const source = z.object({ scriptSource: z.string().max(2 * 1024 * 1024) }).strict().parse(await cdp.send("Debugger.getScriptSource", { scriptId })); active();
      controllerBootstrap.push({ sourceSha256: hash(source.scriptSource), sourceCharacters: source.scriptSource.length, nativeContextUniqueId: context.uniqueId, nativeFrameId: preparedFrame.id });
    }
    acceptingBootstrap = false;
    await cdp.send("Profiler.startPreciseCoverage", { callCount: true, detailed: true, allowTriggeredUpdates: false }); active();
  } catch (error) { await cdp.detach().catch(() => {}); throw error; }
  return {
    async collect(args: { sourcePlan: HtmlProtectionWholeRuntimeSourcePlan; subjectScriptLocations: HtmlProtectionWholeRuntimeRequest["subjectScriptLocations"]; frameId: string; documentUrl: string }) {
      active();
      const result = Coverage.parse(await cdp.send("Profiler.takePreciseCoverage"));
      const captured: Array<{ parentId: string; sourceSha256: string; sourceCharacters: number; sourcePath: string;
        scriptId: string; url: string; contextUniqueId: string; frameId: string; nativeSourceLocation: { line: number; column: number };
        functions: z.infer<typeof FunctionCoverage>[]; coveragePresent: boolean; nativeRangeCount: number }> = [];
      const controllerScripts: Array<{ sourceSha256: string; sourceCharacters: number; contextUniqueId: string; frameId: string; scriptId: string }> = [];
      const expected = args.sourcePlan.scriptShape.map(script => ({ parentId: script.id, sourceSha256: hash((script.literal ?? "").replace(/\r\n?/g,"\n")), sourceCharacters: (script.literal ?? "").replace(/\r\n?/g,"\n").length, sourcePath: script.sourcePath }));
      const unmatched: Array<{ sourceSha256: string; sourceCharacters: number; url: string; nativeSourceLocation: { line: number; column: number }; sourceMatchedParents: string[]; contextName: string; contextUniqueId: string; scriptAuxData: unknown }> = [];
      for (const [scriptId, parsed] of scripts) {
        const context = contexts.get(parsed.executionContextId);
        if (!context || !context.auxData.isDefault || context.auxData.frameId !== args.frameId) continue;
        active(); const source = z.object({ scriptSource: z.string() }).strict().parse(await cdp.send("Debugger.getScriptSource", { scriptId })); active();
        if (source.scriptSource.length > 2 * 1024 * 1024) throw new HtmlProtectionWholeNativeGap("native-script-source-capacity-unavailable");
        const sourceSha256 = hash(source.scriptSource), location = args.subjectScriptLocations.find(item => item.line === parsed.startLine && item.column === parsed.startColumn),
          identity = expected.find(item => item.parentId === location?.parentId && item.sourceSha256 === sourceSha256 && item.sourceCharacters === source.scriptSource.length);
        const boot = controllerBootstrap.filter(item => item.sourceSha256 === sourceSha256 && item.sourceCharacters === source.scriptSource.length);
        const already = controllerScripts.filter(item => item.sourceSha256 === sourceSha256 && item.sourceCharacters === source.scriptSource.length).length;
        // Exact pre-user about:blank program bytes, bounded occurrence. URL or caller policy cannot exempt arbitrary script.
        if (!identity && parsed.url === "" && boot.length > already && parsed.startLine === 0 && parsed.startColumn === 0) {
          controllerScripts.push({ sourceSha256, sourceCharacters: source.scriptSource.length, contextUniqueId: context.uniqueId, frameId: args.frameId, scriptId }); continue;
        }
        if (!identity || parsed.url !== args.documentUrl) { unmatched.push({ sourceSha256, sourceCharacters: source.scriptSource.length, url: parsed.url, nativeSourceLocation: { line: parsed.startLine, column: parsed.startColumn }, contextName: context.name, contextUniqueId: context.uniqueId, scriptAuxData: parsed.executionContextAuxData ?? null, sourceMatchedParents: expected.filter(item => item.sourceSha256 === sourceSha256 && item.sourceCharacters === source.scriptSource.length).map(item => item.parentId) }); continue; }
        const coverage = result.result.find(item => item.scriptId === scriptId);
        captured.push({ ...identity, scriptId, url: parsed.url, contextUniqueId: context.uniqueId, frameId: args.frameId, nativeSourceLocation: { line: parsed.startLine, column: parsed.startColumn },
          functions: coverage?.functions ?? [], coveragePresent: Boolean(coverage), nativeRangeCount: coverage?.functions.reduce((sum, fn) => sum + fn.ranges.length, 0) ?? 0 });
      }
      const missingParentIds = expected.filter(item => captured.filter(script => script.parentId === item.parentId).length !== 1).map(item => item.parentId);
      return { producer: "chromium-v8-precise-source-coverage-v1", instrumentationPolicy: "owned-inspector-skip-pauses-before-subject-v1", observedAt: new Date().toISOString(), frameId: args.frameId,
        sourcePlanOriginal: args.sourcePlan.original, expectedScriptCount: expected.length, scripts: captured, bootstrapScope, controllerBootstrap, controllerBootstrapSha256: hash(canonical({ bootstrapScope, controllerBootstrap })), controllerScripts, unmatched, missingParentIds,
        gaps: [...(unmatched.length ? ["foreign-or-dynamic-page-script"] : []), ...(missingParentIds.length ? ["original-script-not-exactly-observed"] : []),
          ...(captured.some(script => !script.coveragePresent || !script.functions.length) ? ["actual-script-execution-coverage-missing"] : [])],
        limitations: ["A positive range proves actual execution on this owned Page, not all possible inputs or every source branch.",
          "Zero-count source ranges and unexecuted effects remain explicit; source identity and V8 coverage do not grant whole protection."] };
    },
    async dispose() { closed = true; await cdp.send("Profiler.stopPreciseCoverage").catch(() => {}); await cdp.detach().catch(() => {}); },
  };
}
export type HtmlProtectionOwnedScriptCoverage = Awaited<ReturnType<typeof createOwnedHtmlProtectionScriptCoverage>>;
