import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { Page } from "@playwright/test";
import {
  HTML_PROTECTION_SEARCH_STATE_LIMITS, HTML_PROTECTION_SNAPSHOT_LIMITS,
  HtmlProtectionSearchInputObservationSchema, HtmlProtectionSearchStateSessionSchema,
  type HtmlProtectionSearchInputObservation, type HtmlProtectionSearchStateGap,
} from "@evolution/contracts";
import type { HtmlProtectionSearchNativeReadPort } from "./html-protection-search-state";

type Cdp = {
  on(event: string, listener: (event: unknown) => void): unknown;
  off?(event: string, listener: (event: unknown) => void): unknown;
  send(method: string, params?: Record<string, unknown>): Promise<unknown>;
  detach(): Promise<unknown>;
};
const FrameSchema = z.object({ frameTree: z.object({ frame: z.object({
  id: z.string().min(1).max(512), loaderId: z.string().min(1).max(512), url: z.string().max(2048),
}) }) });
const ContextSchema = z.object({ context: z.object({
  id: z.number().int().positive(), uniqueId: z.string().min(1).max(512), name: z.string(),
  auxData: z.object({ isDefault: z.literal(false), type: z.literal("isolated"), frameId: z.string() }),
}) });
const ServedSchema = z.object({
  frameId: z.string().min(1).max(512), loaderId: z.string().min(1).max(512), url: z.string().url().max(2048),
  physicalInput: HtmlProtectionSearchInputObservationSchema.shape.physicalInput,
}).strict();
const ConstructorSchema = z.object({
  expected: HtmlProtectionSearchStateSessionSchema,
  servedDocument: ServedSchema, registeredCssSelector: z.string().min(1).max(500),
  caseDeadline: z.number().finite().positive(),
}).strict();
const CountSchema = z.object({
  matchCount: z.number().int().nonnegative().max(HTML_PROTECTION_SNAPSHOT_LIMITS.nodes),
  scannedNodes: z.number().int().positive().max(HTML_PROTECTION_SNAPSHOT_LIMITS.nodes),
  shadowRoots: z.number().int().nonnegative().max(HTML_PROTECTION_SNAPSHOT_LIMITS.shadowRoots),
  readUtf8Bytes: z.number().int().nonnegative().max(HTML_PROTECTION_SNAPSHOT_LIMITS.textUtf8Bytes),
}).strict();
const FactSchema = HtmlProtectionSearchInputObservationSchema.shape.input.unwrap()
  .omit({ matchCount: true, backendNodeId: true }).extend({ connected: z.literal(true) }).strict();
const RemoteSchema = z.object({ result: z.object({
  type: z.string(), subtype: z.string().optional(), objectId: z.string().optional(), value: z.unknown().optional(),
}), exceptionDetails: z.unknown().optional() });
const NodeSchema = z.object({
  node: z.object({ nodeId: z.number().int().nonnegative(), backendNodeId: z.number().int().positive(),
    nodeType: z.literal(1), nodeName: z.string().min(1), attributes: z.array(z.string()).optional() }).passthrough(),
});
const DOM_EVENTS = [
  "DOM.attributeModified", "DOM.attributeRemoved", "DOM.characterDataModified", "DOM.childNodeCountUpdated",
  "DOM.childNodeInserted", "DOM.childNodeRemoved", "DOM.distributedNodesUpdated", "DOM.documentUpdated",
  "DOM.shadowRootPushed", "DOM.shadowRootPopped",
] as const;
class ReadGap extends Error {
  readonly code: HtmlProtectionSearchStateGap;
  constructor(code: HtmlProtectionSearchStateGap) { super(code); this.code = code; }
}
function nativeCss(value: string) {
  const css = value.startsWith("css=") ? value.slice(4) : value;
  return !css.trim() || css.length > 500 || css.includes(">>") || /^[a-zA-Z][a-zA-Z0-9_-]*=/.test(css) ? undefined : css;
}
function noFragment(value: string) { const url = new URL(value); url.hash = ""; return url.href; }

const SEARCH_NATIVE_PROGRAM = String.raw`
function readOwnedNativeSearchInput(args) {
  try {
    const apply=Reflect.apply,descriptor=Object.getOwnPropertyDescriptor;
    const getter=(prototype,name)=>{const property=descriptor(prototype,name);if(typeof property?.get!=="function")throw Error("NATIVE_GETTER");return object=>apply(property.get,object,[]);};
    const nodeType=getter(Node.prototype,"nodeType"),nodeName=getter(Node.prototype,"nodeName");
    const namespace=getter(Element.prototype,"namespaceURI"),getAttribute=Element.prototype.getAttribute;
    if(args.mode==="facts"){
      const connected=getter(Node.prototype,"isConnected"),owner=getter(Node.prototype,"ownerDocument");
      const input=this instanceof HTMLInputElement,isElement=nodeType(this)===1;
      if(!isElement)throw Error("NATIVE_ELEMENT");
      const value=input?getter(HTMLInputElement.prototype,"value")(this):null;
      if(typeof value==="string"&&value.length>4096)throw Error("NATIVE_LIMIT");
      return {connected:connected(this)&&owner(this)===document,id:apply(getAttribute,this,["id"]),tag:nodeName(this),
        namespace:namespace(this),type:input?getter(HTMLInputElement.prototype,"type")(this):null,
        value,
        disabled:input?getter(HTMLInputElement.prototype,"disabled")(this):null,
        readOnly:input?getter(HTMLInputElement.prototype,"readOnly")(this):null};
    }
    const {limits,selector}=args,childNodes=getter(Node.prototype,"childNodes"),nodeValue=getter(Node.prototype,"nodeValue");
    const attributes=getter(Element.prototype,"attributes"),shadowRoot=getter(Element.prototype,"shadowRoot");
    const attrValue=getter(Attr.prototype,"value"),attrName=getter(Attr.prototype,"name"),attrNamespace=getter(Attr.prototype,"namespaceURI");
    const templateContent=getter(HTMLTemplateElement.prototype,"content");
    const docQuery=Document.prototype.querySelectorAll,fragmentQuery=DocumentFragment.prototype.querySelectorAll;
    const roots=[document],pending=[{node:document,depth:0}],seen=new Set(),encode=TextEncoder.prototype.encode,encoder=new TextEncoder();
    let shadowRoots=0,readUtf8Bytes=0;
    const account=value=>{if(typeof value==="string"){
      if(value.length>limits.textUtf8Bytes-readUtf8Bytes)throw Error("NATIVE_LIMIT");
      readUtf8Bytes+=apply(encode,encoder,[value]).byteLength;if(readUtf8Bytes>limits.textUtf8Bytes)throw Error("NATIVE_LIMIT");
    }};
    while(pending.length){
      const {node,depth}=pending.pop();if(seen.has(node))continue;seen.add(node);
      if(seen.size>limits.nodes||depth>limits.depth)throw Error("NATIVE_LIMIT");
      account(nodeName(node));account(nodeValue(node));
      if(nodeType(node)===1){
        const attrs=attributes(node);if(attrs.length>limits.attributesPerNode)throw Error("NATIVE_LIMIT");
        for(const attr of Array.from(attrs)){account(attrName(attr));account(attrNamespace(attr));account(attrValue(attr));}
        const shadow=shadowRoot(node);if(shadow){if(++shadowRoots>limits.shadowRoots)throw Error("NATIVE_LIMIT");roots.push(shadow);pending.push({node:shadow,depth:depth+1});}
        if(nodeName(node)==="TEMPLATE")pending.push({node:templateContent(node),depth:depth+1});
      }
      const list=childNodes(node);
      if(list.length>limits.nodes-seen.size||pending.length+list.length>limits.nodes)throw Error("NATIVE_LIMIT");
      for(const child of Array.from(list))pending.push({node:child,depth:depth+1});
    }
    const matches=new Set();
    try {for(const root of roots){const query=nodeType(root)===9?docQuery:fragmentQuery;
      for(const element of apply(query,root,[selector])){matches.add(element);if(matches.size>limits.nodes)throw Error("NATIVE_LIMIT");}
    }}catch(error){if(error?.message==="NATIVE_LIMIT")throw error;return {capabilityGap:"unsupported-selector"};}
    if(args.mode==="count")return {matchCount:matches.size,scannedNodes:seen.size,shadowRoots,readUtf8Bytes};
    if(args.mode==="select")return matches.size===1?matches.values().next().value:null;
    throw Error("NATIVE_MODE");
  } catch {return {capabilityGap:"native-unavailable"};}
}
`;

/**
 * Deployment-owned light/open native CSS input read, not whole protection or authority.
 * servedDocument MUST be the trusted controller's independently verified HTTP/Response
 * byte receipt. A matching SHA label/DTO cannot establish physical startup provenance.
 * This producer never reads main-world accessors, page JSON or console evidence. Closed/UA
 * roots, embedded frames and inert-template activation remain outside this query domain.
 * Shallow CDP metadata crosses transport before Node validation: owned Sandbox/process
 * limits remain necessary; these checks are not a hard CDP memory guarantee.
 */
export function createHtmlProtectionSearchNativeInput(options: {
  page: Page; expected: unknown; servedDocument: unknown; registeredCssSelector: string;
  caseDeadline: number; signal?: AbortSignal;
}): HtmlProtectionSearchNativeReadPort & { dispose(): void } {
  if (!options || Object.keys(options).some(key => !["page", "expected", "servedDocument", "registeredCssSelector", "caseDeadline", "signal"].includes(key))) {
    throw Error("Invalid fixed native input construction");
  }
  const config = ConstructorSchema.parse({ expected: options.expected, servedDocument: options.servedDocument,
    registeredCssSelector: options.registeredCssSelector, caseDeadline: options.caseDeadline });
  const signal = options.signal === undefined ? undefined : z.instanceof(AbortSignal).parse(options.signal);
  const page = options.page, context = page.context(), createSession = context.newCDPSession.bind(context);
  const css = nativeCss(config.registeredCssSelector);
  const expected = config.expected, physical = expected.binding[expected.sourceRole];
  const physicalInput = { sha256: physical.sha256, byteLength: physical.byteLength };
  const deadline = Math.min(config.caseDeadline, Date.now() + HTML_PROTECTION_SEARCH_STATE_LIMITS.caseTimeoutMs);
  const sessions = new Set<Cdp>();
  let disposed = false, busy = false;
  const unavailable = (code: HtmlProtectionSearchStateGap) => ({ page, observation: HtmlProtectionSearchInputObservationSchema.parse({
    schemaVersion: "html-protection-search-input-observation-v1", availability: "unavailable",
    physicalInput: { ...physicalInput }, gaps: [code],
  }) });
  function detach(session: Cdp) {
    if (sessions.delete(session)) void Promise.resolve().then(() => session.detach()).catch(() => undefined);
  }
  function dispose() { disposed = true; for (const session of [...sessions]) detach(session); }
  async function read(receivedPage: Page, selector: string): Promise<{ page: Page; observation: HtmlProtectionSearchInputObservation }> {
    if (receivedPage !== page) return unavailable("page-mismatch");
    if (!css || typeof selector !== "string" || nativeCss(selector) !== css) return unavailable("unsupported-selector");
    if (busy) return unavailable("operation-in-progress");
    if (disposed) return unavailable("session-unavailable");
    if (signal?.aborted) return unavailable("aborted");
    if (physical.sha256 !== config.servedDocument.physicalInput.sha256 || physical.byteLength !== config.servedDocument.physicalInput.byteLength) return unavailable("physical-input-mismatch");
    if (expected.frameId !== config.servedDocument.frameId || expected.loaderId !== config.servedDocument.loaderId) return unavailable("document-mismatch");
    const actionDeadline = Math.min(deadline, Date.now() + HTML_PROTECTION_SEARCH_STATE_LIMITS.actionTimeoutMs);
    if (Date.now() >= actionDeadline) return unavailable("deadline-exceeded");
    busy = true;
    let session: Cdp | undefined, interrupted = false, timer: ReturnType<typeof setTimeout> | undefined, abort: (() => void) | undefined;
    const worldName = "evolution-search-input-" + randomUUID(), group = "evolution-search-input-" + randomUUID();
    const listeners: Array<{ event: string; listener: (event: unknown) => void }> = [];
    const active = () => {
      if (interrupted || disposed) throw new ReadGap(signal?.aborted ? "aborted" : disposed ? "session-unavailable" : "deadline-exceeded");
      if (signal?.aborted) throw new ReadGap("aborted");
      if (Date.now() >= actionDeadline) throw new ReadGap("deadline-exceeded");
    };
    const operation = (async () => {
      active();
      session = await createSession(page) as unknown as Cdp; sessions.add(session); active();
      const contexts = new Map<number, z.infer<typeof ContextSchema>["context"]>();
      let monitoring = false, mutated = false, realmInvalid = false;
      let selectedContext: z.infer<typeof ContextSchema>["context"] | undefined;
      const on = (event: string, listener: (event: unknown) => void) => { listeners.push({ event, listener }); session!.on(event, listener); };
      on("Runtime.executionContextCreated", event => {
        const value = ContextSchema.safeParse(event);
        if (value.success) {
          if (contexts.size >= 128 && !contexts.has(value.data.context.id)) { realmInvalid = true; return; }
          contexts.set(value.data.context.id, value.data.context);
          if (selectedContext && value.data.context.id === selectedContext.id && value.data.context.uniqueId !== selectedContext.uniqueId) realmInvalid = true;
        }
      });
      on("Runtime.executionContextsCleared", () => { realmInvalid = true; });
      on("Runtime.executionContextDestroyed", event => {
        const value = z.object({ executionContextId: z.number().int() }).safeParse(event);
        if (selectedContext && value.success && value.data.executionContextId === selectedContext.id) realmInvalid = true;
      });
      for (const event of DOM_EVENTS) on(event, () => { if (monitoring) mutated = true; });
      const stable = () => { active(); if (realmInvalid || mutated) throw new ReadGap("document-mismatch"); };
      await session.send("Runtime.enable"); active();
      await session.send("DOM.enable", { includeWhitespace: "all" }); active(); monitoring = true;
      const before = FrameSchema.parse(await session.send("Page.getFrameTree")).frameTree.frame; stable();
      const checkFrame = (current: typeof before) => {
        if (current.id !== expected.frameId || current.loaderId !== expected.loaderId
          || noFragment(current.url) !== noFragment(config.servedDocument.url)) throw new ReadGap("document-mismatch");
      };
      checkFrame(before);
      await session.send("DOM.getDocument", { depth: 0, pierce: false }); stable();
      const world = z.object({ executionContextId: z.number().int().positive() }).parse(await session.send("Page.createIsolatedWorld", {
        frameId: before.id, worldName, grantUniveralAccess: false,
      })); stable();
      selectedContext = contexts.get(world.executionContextId);
      if (!selectedContext || selectedContext.name !== worldName || selectedContext.auxData.frameId !== before.id) throw new ReadGap("native-unavailable");
      const call = async (mode: "count" | "select" | "facts", objectId?: string) => {
        stable();
        const response = RemoteSchema.parse(await session!.send("Runtime.callFunctionOn", {
          functionDeclaration: SEARCH_NATIVE_PROGRAM, ...(objectId ? { objectId } : { uniqueContextId: selectedContext!.uniqueId }),
          arguments: [{ value: { mode, ...(mode === "facts" ? {} : { selector: css, limits: HTML_PROTECTION_SNAPSHOT_LIMITS }) } }],
          returnByValue: mode !== "select", objectGroup: group, generatePreview: false,
          awaitPromise: false, silent: true, userGesture: false,
        })); stable();
        if (response.exceptionDetails) throw new ReadGap("native-unavailable");
        const gap = z.object({ capabilityGap: z.enum(["unsupported-selector", "native-unavailable"]) }).strict().safeParse(response.result.value);
        if (gap.success) throw new ReadGap(gap.data.capabilityGap);
        const encoded = JSON.stringify(response.result.value);
        if (encoded !== undefined && (encoded.length > HTML_PROTECTION_SNAPSHOT_LIMITS.bodyUtf8Bytes
          || Buffer.byteLength(encoded, "utf8") > HTML_PROTECTION_SNAPSHOT_LIMITS.bodyUtf8Bytes)) throw new ReadGap("native-unavailable");
        return response.result;
      };
      const count = CountSchema.parse((await call("count")).value);
      const base = { schemaVersion: "html-protection-search-input-observation-v1" as const, availability: "available" as const,
        frameId: before.id, loaderId: before.loaderId, physicalInput: { ...physicalInput }, gaps: [] };
      let input: NonNullable<HtmlProtectionSearchInputObservation["input"]>;
      if (count.matchCount !== 1) input = { matchCount: count.matchCount, backendNodeId: null,
        id: null, tag: null, namespace: null, type: null, value: null, disabled: null, readOnly: null };
      else {
        const selected = await call("select");
        if (selected.type !== "object" || selected.subtype !== "node" || !selected.objectId) throw new ReadGap("native-unavailable");
        const objectId = selected.objectId;
        z.object({ nodeId: z.number().int().positive() }).parse(await session.send("DOM.requestNode", { objectId })); stable();
        const describe = async () => {
          const raw = await session!.send("DOM.describeNode", { objectId, depth: 0, pierce: false }); stable();
          const rough = z.object({ node: z.object({ attributes: z.unknown().optional() }).passthrough() }).parse(raw).node;
          if (Array.isArray(rough.attributes) && (rough.attributes.length > HTML_PROTECTION_SNAPSHOT_LIMITS.attributesPerNode * 2
            || rough.attributes.some(value => typeof value === "string" && value.length > HTML_PROTECTION_SNAPSHOT_LIMITS.textUtf8Bytes))) throw new ReadGap("native-unavailable");
          return NodeSchema.parse(raw).node;
        };
        const firstNode = await describe(), first = FactSchema.parse((await call("facts", objectId)).value);
        const secondNode = await describe(), second = FactSchema.parse((await call("facts", objectId)).value);
        if (firstNode.backendNodeId !== secondNode.backendNodeId || firstNode.nodeName !== first.tag || secondNode.nodeName !== second.tag
          || JSON.stringify(first) !== JSON.stringify(second)) throw new ReadGap("input-identity-mismatch");
        const { connected: _connected, ...facts } = second;
        void _connected;
        input = { matchCount: 1, backendNodeId: secondNode.backendNodeId, ...facts };
      }
      const finalCount = CountSchema.parse((await call("count")).value);
      if (count.matchCount !== finalCount.matchCount) throw new ReadGap("input-identity-mismatch");
      const after = FrameSchema.parse(await session.send("Page.getFrameTree")).frameTree.frame; stable(); checkFrame(after);
      if (before.id !== after.id || before.loaderId !== after.loaderId) throw new ReadGap("document-mismatch");
      return { page, observation: HtmlProtectionSearchInputObservationSchema.parse({ ...base, input }) };
    })();
    try {
      return await Promise.race([operation, new Promise<never>((_, reject) => {
        const stop = (code: "aborted" | "deadline-exceeded") => { interrupted = true; reject(new ReadGap(code)); };
        timer = setTimeout(() => stop("deadline-exceeded"), Math.max(0, actionDeadline - Date.now()));
        abort = () => stop("aborted"); signal?.addEventListener("abort", abort, { once: true });
        if (signal?.aborted) stop("aborted");
      })]);
    } catch (error) { return unavailable(error instanceof ReadGap ? error.code : "native-unavailable"); }
    finally {
      interrupted = true; busy = false; if (timer !== undefined) clearTimeout(timer); if (abort) signal?.removeEventListener("abort", abort);
      if (session) {
        for (const { event, listener } of listeners) { try { session.off?.(event, listener); } catch { /* Owned cleanup only. */ } }
        const owned = session;
        void Promise.resolve().then(() => owned.send("Runtime.releaseObjectGroup", { objectGroup: group })).catch(() => undefined);
        detach(session);
      }
      // Late createSession resolution owns only this Page's new session; active() rejects before any read.
      void operation.catch(() => { if (session) detach(session); });
    }
  }
  return { read, dispose };
}
