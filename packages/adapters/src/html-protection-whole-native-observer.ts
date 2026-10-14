import { OwnedHtmlProtectionDocumentGap } from "./html-protection-owned-document";
import { boundHtmlProtectionWholeNativeSession } from "./html-protection-whole-native-deadline";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { Page, BrowserContext, CDPSession } from "@playwright/test";
import { HTML_PROTECTION_WHOLE_RUNTIME_LIMITS as limits } from "@evolution/contracts";
import { validateHtmlProtectionWholeNativeDocument } from "./html-protection-whole-native-material";
import { collectHtmlProtectionWholeNativeEventListeners } from "./html-protection-whole-native-events";
import { HTML_PROTECTION_WHOLE_NATIVE_PROGRAM as program } from "./html-protection-whole-native-program";
import { htmlProtectionCloudCanonicalJson as canonical, htmlProtectionCloudSha256 as sha } from "./vercel-sandbox-html-protection-cloud-protocol";

const Frame = z.object({ frameTree: z.object({ frame: z.object({ id: z.string(), loaderId: z.string(), url: z.string() }) }) });
const Context = z.object({ context: z.object({ id: z.number().int().positive(), uniqueId: z.string().min(1), name: z.string(),
  auxData: z.object({ frameId: z.string(), isDefault: z.literal(false), type: z.literal("isolated") }) }) });
const DefaultContext = z.object({ context: z.object({ id: z.number().int().positive(), uniqueId: z.string().min(1), auxData: z.object({ frameId: z.string(), isDefault: z.literal(true) }) }) });
const Remote = z.object({ result: z.object({ type: z.string(), objectId: z.string().optional(), value: z.unknown().optional() }), exceptionDetails: z.unknown().optional() });
const withoutFragment = (value: string) => { try { const url = new URL(value); url.hash = ""; return url.href; } catch { return null; } };
const mutations = ["DOM.attributeModified", "DOM.attributeRemoved", "DOM.characterDataModified", "DOM.childNodeInserted", "DOM.childNodeRemoved",
  "DOM.documentUpdated", "DOM.shadowRootPushed", "DOM.shadowRootPopped", "DOM.adoptedStyleSheetsModified"] as const;
export class HtmlProtectionWholeNativeGap extends Error {
  readonly code: string;
  constructor(code: string, readonly diagnostic?: { mutationObserved?: boolean; mirrorChanged?: boolean; stylesChanged?: boolean; activeAnimations?: number }) { super(code); this.code = code; }
}
/** Native realm/document/window ownership. No page-provided JSON or main-world fallback is accepted. */
export async function createHtmlProtectionWholeNativeObserver(args: {
  page: Page; context: BrowserContext; frameId: string; loaderId: string; documentUrl: string;
  assertCurrent: () => Promise<void>; signal: AbortSignal; deadline: number;
}) {
  const cdp = boundHtmlProtectionWholeNativeSession(await args.context.newCDPSession(args.page), args.deadline, args.signal, code => new HtmlProtectionWholeNativeGap(code)), name = "evolution-whole-native-" + randomUUID();
  const realms = new Map<number, z.infer<typeof Context>["context"]>();
  let selected: z.infer<typeof Context>["context"] | undefined, defaultContext: z.infer<typeof DefaultContext>["context"] | undefined, invalid = false, observing = false, changed = false, closed = false, frameChecked = false;
  const active = async () => {
    if (closed || invalid || args.signal.aborted || Date.now() >= args.deadline) throw new HtmlProtectionWholeNativeGap("native-owner-unavailable");
    try { await args.assertCurrent(); } catch (error) { if (error instanceof OwnedHtmlProtectionDocumentGap) throw new HtmlProtectionWholeNativeGap(error.inspectorCause ?? error.code); throw error; }
    if (!frameChecked) {
      const frame = Frame.parse(await cdp.send("Page.getFrameTree")).frameTree.frame;
      if (frame.id !== args.frameId || frame.loaderId !== args.loaderId || withoutFragment(frame.url) !== args.documentUrl) throw new HtmlProtectionWholeNativeGap("native-document-mismatch");
      frameChecked = true;
    }
  };
  cdp.on("Page.frameNavigated", event => {
    const frame = z.object({ frame: z.object({ id: z.string(), loaderId: z.string(), url: z.string(), parentId: z.string().optional() }) }).safeParse(event);
    if (!frame.success) invalid = true;
    else if (!frame.data.frame.parentId) {
      if (frame.data.frame.id !== args.frameId || frame.data.frame.loaderId !== args.loaderId || withoutFragment(frame.data.frame.url) !== args.documentUrl) invalid = true; }
  });
  cdp.on("Page.navigatedWithinDocument", event => {
    const frame = z.object({ frameId: z.string(), url: z.string() }).safeParse(event);
    if (!frame.success) invalid = true; else if (frame.data.frameId === args.frameId) { if (withoutFragment(frame.data.url) !== args.documentUrl) invalid = true; }
  });
  for (const event of ["Inspector.detached", "Inspector.targetCrashed"] as const) cdp.on(event, () => { invalid = true; });
  cdp.on("Runtime.executionContextCreated", event => { const parsed = Context.safeParse(event); if (parsed.success) realms.set(parsed.data.context.id, parsed.data.context); const nativeDefault = DefaultContext.safeParse(event); if (nativeDefault.success && nativeDefault.data.context.auxData.frameId === args.frameId) { if (defaultContext && defaultContext.uniqueId !== nativeDefault.data.context.uniqueId) invalid = true; defaultContext = nativeDefault.data.context; } });
  cdp.on("Runtime.executionContextDestroyed", event => { if ((selected && event.executionContextId === selected.id) || (defaultContext && event.executionContextId === defaultContext.id)) invalid = true; });
  cdp.on("Runtime.executionContextsCleared", () => { invalid = true; });
  for (const event of mutations) cdp.on(event, () => { if (observing) changed = true; });
  for (const event of ["CSS.styleSheetChanged", "CSS.styleSheetAdded", "CSS.styleSheetRemoved", "Animation.animationStarted", "Animation.animationCanceled"] as const) cdp.on(event, () => { if (observing) changed = true; });
  try {
    await cdp.send("Page.enable"); await cdp.send("Runtime.enable"); await cdp.send("DOM.enable", { includeWhitespace: "all" }); await cdp.send("CSS.enable"); await cdp.send("Animation.enable");
    await active();
    const world = z.object({ executionContextId: z.number().int().positive() }).parse(await cdp.send("Page.createIsolatedWorld", { frameId: args.frameId, worldName: name, grantUniveralAccess: false }));
    selected = realms.get(world.executionContextId);
    if (!defaultContext || !selected || selected.name !== name || selected.auxData.frameId !== args.frameId) throw new HtmlProtectionWholeNativeGap("native-isolated-realm-unavailable");
  } catch (error) { await cdp.detach().catch(() => {}); throw error; }
  const realm = { frameId: args.frameId, loaderId: args.loaderId, uniqueContextId: selected.uniqueId };
  // Compile fixed controller code once in this owned pristine realm; every read still obtains new live DOM/CSS material.
  const compiled = Remote.parse(await cdp.send("Runtime.evaluate", { contextId: selected.id, expression: "(" + program + ")", returnByValue: false, silent: true }));
  if (compiled.exceptionDetails || !compiled.result.objectId || compiled.result.type !== "function") throw new HtmlProtectionWholeNativeGap("native-program-binding-unavailable");
  const nativeProgramObjectId = compiled.result.objectId;
  const rootMirror = z.object({ root: z.object({ backendNodeId: z.number().int().positive() }) }).parse(await cdp.send("DOM.getDocument", { depth: -1, pierce: true }));
  const rootBackendNodeId = rootMirror.root.backendNodeId;
  async function call(mode: string, values: Record<string, unknown> = {}, object = false) {
    await active();
    const response = Remote.parse(await cdp.send("Runtime.callFunctionOn", {
      objectId: nativeProgramObjectId, functionDeclaration: "function(args) { return Reflect.apply(this, undefined, [args]); }", arguments: [{ value: { mode, ...values,
        maximumBytes: limits.observationBytes, maximumNodes: limits.nodes, maximumProperties: limits.properties } }],
      returnByValue: !object, awaitPromise: true, generatePreview: false, silent: true, userGesture: false,
    }));
    await active(); if (response.exceptionDetails) throw new HtmlProtectionWholeNativeGap("native-operation-unavailable");
    if (object) {
      if (!response.result.objectId) throw new HtmlProtectionWholeNativeGap("native-target-unavailable");
      const node = z.object({ node: z.object({ backendNodeId: z.number().int().positive() }) }).parse(await cdp.send("DOM.describeNode", { objectId: response.result.objectId }));
      await cdp.send("Runtime.releaseObject", { objectId: response.result.objectId }); return node.node.backendNodeId;
    }
    const encoded = canonical(response.result.value);
    if (Buffer.byteLength(encoded) > limits.observationBytes) throw new HtmlProtectionWholeNativeGap("native-body-capacity-unavailable");
    return response.result.value;
  }
  async function readProperties() {
    const properties = z.object({ elementCount: z.number().int().positive().max(limits.nodes), activeAnimations: z.number().int().nonnegative(),
      viewport: z.object({ width: z.number().positive(), height: z.number().positive() }).strict(), scroll: z.object({ x: z.number().finite(), y: z.number().finite() }).strict(),
      documentSize: z.object({ width: z.number().positive(), height: z.number().positive() }).strict(),
      styleTable: z.object({ strings: z.array(z.string()), styleRows: z.array(z.array(z.tuple([z.number().int().nonnegative(), z.number().int().nonnegative()]))),
        elements: z.array(z.object({ sourcePath: z.string(), tag: z.string(), id: z.string().nullable(), namespace: z.string().nullable(), bounds: z.array(z.number().finite()).length(4),
          styles: z.number().int().nonnegative(), beforeStyles: z.number().int().nonnegative(), afterStyles: z.number().int().nonnegative(), markerStyles: z.number().int().nonnegative() }).strict()).max(limits.nodes) }).strict() }).strict().parse(await call("properties"));
    if (properties.elementCount !== properties.styleTable.elements.length || properties.styleTable.elements.some(row => [row.styles, row.beforeStyles, row.afterStyles, row.markerStyles].some(index => index >= properties.styleTable.styleRows.length))
      || properties.styleTable.styleRows.some(row => row.length > limits.properties || row.some(pair => pair.some(index => index >= properties.styleTable.strings.length)))) throw new HtmlProtectionWholeNativeGap("native-style-table-incomplete");
    return properties;
  }
  async function windowRead<T>(read: () => Promise<T>, includeStyles = false) {
    await active();
    if (observing) throw new HtmlProtectionWholeNativeGap("native-window-reentrant");
    changed = false; observing = true;
    try {
      const before = await cdp.send("DOM.describeNode", { backendNodeId: rootBackendNodeId, depth: -1, pierce: true });
      const beforeStyles = includeStyles ? await readProperties() : undefined;
      if (beforeStyles?.activeAnimations) throw new HtmlProtectionWholeNativeGap("visual-active-animation-domain-unresolved");
      const value = await read();
      const afterStyles = includeStyles ? await readProperties() : undefined;
      const after = await cdp.send("DOM.describeNode", { backendNodeId: rootBackendNodeId, depth: -1, pierce: true });
      await active();
      if (changed || sha(canonical(before)) !== sha(canonical(after)) || (includeStyles && (afterStyles?.activeAnimations || sha(canonical(beforeStyles)) !== sha(canonical(afterStyles))))) throw new HtmlProtectionWholeNativeGap("native-document-unstable", { mutationObserved: changed, mirrorChanged: sha(canonical(before)) !== sha(canonical(after)), stylesChanged: includeStyles && sha(canonical(beforeStyles)) !== sha(canonical(afterStyles)), activeAnimations: afterStyles?.activeAnimations ?? 0 });
      return { realm, stability: { preMirrorSha256: sha(canonical(before)), postMirrorSha256: sha(canonical(after)), mutationEvents: 0 as const }, value,
        ...(includeStyles ? { styleWindow: { before: beforeStyles!, after: afterStyles!, preStylesSha256: sha(canonical(beforeStyles)), postStylesSha256: sha(canonical(afterStyles)) } } : {}) };
    } finally { observing = false; }
  }
  async function nativeScroll(distance: number) {
    if (!Number.isFinite(distance) || Math.abs(distance) > 10_000_000) throw new HtmlProtectionWholeNativeGap("visual-scroll-domain-unavailable");
    await active(); await cdp.send("Input.synthesizeScrollGesture", { x: 120, y: 120, yDistance: -distance, speed: 100_000, preventFling: true, gestureSourceType: "mouse" }); await active();
  }
  async function input(selector: string, operation: "click" | "fill" | "hover" | "leave" | "scroll", text?: string, onDispatched?: () => void) {
    const trace: Array<{ method: string; parameters: Record<string, unknown> }> = [];
    // Only these controller-owned commands can be dispatched; arbitrary caller method names cannot cross this boundary.
    const dispatch = async (method: "Input.dispatchMouseEvent" | "Input.dispatchKeyEvent" | "Input.insertText", parameters: Record<string, unknown>) => {
      await active();
      if (method === "Input.dispatchMouseEvent") {
        const value = z.object({ type: z.enum(["mouseMoved", "mousePressed", "mouseReleased"]), x: z.number().finite(), y: z.number().finite(), button: z.literal("left").optional(), clickCount: z.literal(1).optional() }).strict().parse(parameters);
        await cdp.send("Input.dispatchMouseEvent", value);
      } else if (method === "Input.dispatchKeyEvent") {
        const value = z.object({ type: z.enum(["keyDown", "keyUp"]), key: z.string(), code: z.string(), windowsVirtualKeyCode: z.number().int(), modifiers: z.literal(2).optional() }).strict().parse(parameters);
        await cdp.send("Input.dispatchKeyEvent", value);
      } else await cdp.send("Input.insertText", z.object({ text: z.string() }).strict().parse(parameters));
      await active(); trace.push({ method, parameters });
    };
    if (operation === "leave") { await dispatch("Input.dispatchMouseEvent", { type: "mouseMoved", x: 0, y: 0 }); onDispatched?.(); return trace; }
    const point = z.object({ target: z.object({ bounds: z.array(z.number().finite()).length(4) }).passthrough(), viewport: z.object({ width: z.number().positive(), height: z.number().positive() }) }).passthrough();
    let value = point.parse(await call("target", { selector }));
    const [, top, width, height] = value.target.bounds as [number, number, number, number];
    if (width <= 0 || height <= 0) throw new HtmlProtectionWholeNativeGap("native-control-not-rendered");
    if (operation === "scroll" || top < 0 || top + height > value.viewport.height) {
      const distance = top - value.viewport.height / 2 + Math.min(height / 2, 40);
      await nativeScroll(Math.abs(distance) < 1 ? 1 : distance); trace.push({ method: "Input.synthesizeScrollGesture", parameters: { distance: Math.abs(distance) < 1 ? 1 : distance } });
      value = point.parse(await call("target", { selector }));
    }
    if (operation === "scroll") { onDispatched?.(); return trace; }
    const x = value.target.bounds[0]! + Math.min(value.target.bounds[2]! / 2, 40), y = value.target.bounds[1]! + Math.min(value.target.bounds[3]! / 2, 40);
    if (x < 0 || y < 0 || x >= value.viewport.width || y >= value.viewport.height) throw new HtmlProtectionWholeNativeGap("native-control-point-unavailable");
    if (!z.object({ hit: z.literal(true) }).strict().safeParse(await call("hit-test", { selector, x, y })).success) throw new HtmlProtectionWholeNativeGap("native-control-point-obstructed");
    trace.push({ method: "native-hit-test", parameters: { selector, x, y, hit: true } });
    await dispatch("Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
    if (operation === "hover") { onDispatched?.(); return trace; }
    await dispatch("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1 });
    await dispatch("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1 });
    if (operation === "click") onDispatched?.();
    if (operation === "fill") {
      if (text === undefined) throw new HtmlProtectionWholeNativeGap("native-input-text-unavailable");
      await dispatch("Input.dispatchKeyEvent", { type: "keyDown", key: "Control", code: "ControlLeft", windowsVirtualKeyCode: 17, modifiers: 2 });
      await dispatch("Input.dispatchKeyEvent", { type: "keyDown", key: "a", code: "KeyA", windowsVirtualKeyCode: 65, modifiers: 2 });
      await dispatch("Input.dispatchKeyEvent", { type: "keyUp", key: "a", code: "KeyA", windowsVirtualKeyCode: 65, modifiers: 2 });
      await dispatch("Input.dispatchKeyEvent", { type: "keyUp", key: "Control", code: "ControlLeft", windowsVirtualKeyCode: 17 });
      await dispatch("Input.dispatchKeyEvent", { type: "keyDown", key: "Backspace", code: "Backspace", windowsVirtualKeyCode: 8 });
      await dispatch("Input.dispatchKeyEvent", { type: "keyUp", key: "Backspace", code: "Backspace", windowsVirtualKeyCode: 8 });
      onDispatched?.();
      if (text.length) await dispatch("Input.insertText", { text });
    }
    return trace;
  }
  return { realm,
    visualCapture: <T>(read: () => Promise<T>) => windowRead(read, true),
    input,
    screenshot: async (region: { x: number; y: number; width: number; height: number }) => {
      await active(); const screenshot = z.object({ data: z.string().max(6 * 1024 * 1024) }).strict().parse(await cdp.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: true, fromSurface: true, clip: { ...region, scale: 1 } })); await active(); return Buffer.from(screenshot.data, "base64");
    },
    events: (selector: string) => windowRead(() => collectHtmlProtectionWholeNativeEventListeners({ cdp, contextUniqueId: selected!.uniqueId, objectGroup: name + ":event-leases", defaultContext: { id: defaultContext!.id, uniqueId: defaultContext!.uniqueId, frameId: defaultContext!.auxData.frameId }, selector, active })),
    census: () => windowRead(() => call("census")),
    viewport: () => windowRead(() => call("viewport")),
    scrollDistance: nativeScroll,
    target: (selector: string) => windowRead(() => call("target", { selector })),
    backendNodeId: async (selector: string) => await call("select", { selector }, true) as number,
    clipboardWrite: async (sentinel: string) => { await call("clipboard-write", { sentinel }); },
    clipboardRead: async () => z.object({ text: z.string().max(limits.observationBytes) }).strict().parse(await call("clipboard-read")),
    document: () => windowRead(async () => {
      const properties = await readProperties();
      const snapshot = await cdp.send("DOMSnapshot.captureSnapshot", { computedStyles: [], includePaintOrder: true, includeDOMRects: true });
      validateNativeSnapshot(snapshot, args.frameId, 0);
      return validateHtmlProtectionWholeNativeDocument({ elementCount: properties.elementCount, styleTable: properties.styleTable, snapshot }, args.frameId);
    }),
    dispose: async () => { closed = true; await cdp.send("Runtime.releaseObjectGroup", { objectGroup: name + ":event-leases" }).catch(() => {}); await cdp.send("Runtime.releaseObject", { objectId: nativeProgramObjectId }).catch(() => {}); await cdp.detach().catch(() => {}); },
  };
}
function validateNativeSnapshot(value: unknown, frameId: string, propertyCount: number) {
  const parsed = z.object({ strings: z.array(z.string()), documents: z.array(z.object({
    frameId: z.number().int().nonnegative(), nodes: z.object({ parentIndex: z.array(z.number().int()), nodeType: z.array(z.number().int()),
      nodeName: z.array(z.number().int()), nodeValue: z.array(z.number().int()), backendNodeId: z.array(z.number().int()), attributes: z.array(z.array(z.number().int())) }).passthrough(),
    layout: z.object({ nodeIndex: z.array(z.number().int()), styles: z.array(z.array(z.number().int())),
      bounds: z.array(z.array(z.number()).length(4)), text: z.array(z.number().int()) }).passthrough(),
  }).passthrough()).length(1) }).passthrough().parse(value);
  const document = parsed.documents[0]!;
  if (parsed.strings[document.frameId] !== frameId || document.nodes.parentIndex.length > limits.nodes
    || Object.values(document.nodes).some(rows => Array.isArray(rows) && rows.length !== document.nodes.parentIndex.length)
    || document.layout.nodeIndex.length !== document.layout.styles.length || document.layout.nodeIndex.length !== document.layout.bounds.length
    || document.layout.styles.some(row => row.length !== propertyCount || row.some(index => index < -1 || index >= parsed.strings.length))) {
    throw new HtmlProtectionWholeNativeGap("native-document-incomplete");
  }
}
export type HtmlProtectionWholeNativeObserver = Awaited<ReturnType<typeof createHtmlProtectionWholeNativeObserver>>;
export type HtmlProtectionWholeNativeCdp = CDPSession;
