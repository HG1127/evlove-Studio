import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import {
  HTML_PROTECTION_SNAPSHOT_LIMITS, HtmlProtectionSnapshotBodySchema,
  HtmlProtectionSnapshotLimitations, HtmlProtectionSnapshotRegistrySchema,
  HtmlProtectionSnapshotRequestSchema, HtmlProtectionSnapshotResultSchema,
  type HtmlProtectionSnapshotBody, type HtmlProtectionSnapshotRequest, type HtmlProtectionSnapshotResult,
} from "@evolution/contracts";

/** Internal browser-controller port; never populated from a route, model or page JSON. */
const DOM_MUTATION_EVENTS = [
  "DOM.attributeModified", "DOM.attributeRemoved", "DOM.characterDataModified",
  "DOM.childNodeCountUpdated", "DOM.childNodeInserted", "DOM.childNodeRemoved",
  "DOM.distributedNodesUpdated", "DOM.documentUpdated", "DOM.inlineStyleInvalidated",
  "DOM.shadowRootPushed", "DOM.shadowRootPopped", "DOM.pseudoElementAdded", "DOM.pseudoElementRemoved",
  "DOM.adoptedStyleSheetsModified", "DOM.topLayerElementsUpdated",
] as const;
type SnapshotCdpEvent = "Runtime.executionContextCreated" | typeof DOM_MUTATION_EVENTS[number];
export interface HtmlProtectionSnapshotCdpPort {
  on(event: SnapshotCdpEvent, callback: (event: unknown) => void): void;
  send(method: string, params?: Record<string, unknown>): Promise<unknown>;
  detach(): Promise<unknown>;
}
export const HTML_PROTECTION_NATIVE_SNAPSHOT_FUNCTION = String.raw`
function collectRegisteredNativeDomProjection(args) {
  try {
  const {registry,limits}=args,apply=Reflect.apply,descriptor=Object.getOwnPropertyDescriptor;
  const getter=(prototype,name)=>{const entry=descriptor(prototype,name);if(typeof entry?.get!=="function")throw Error("Native getter unavailable");return object=>apply(entry.get,object,[]);};
  const nodeType=getter(Node.prototype,"nodeType"),nodeName=getter(Node.prototype,"nodeName"),nodeValue=getter(Node.prototype,"nodeValue");
  const childNodes=getter(Node.prototype,"childNodes"),parentElement=getter(Node.prototype,"parentElement");
  const namespace=getter(Element.prototype,"namespaceURI"),attributes=getter(Element.prototype,"attributes"),shadowRoot=getter(Element.prototype,"shadowRoot");
  const assignedSlot=getter(Element.prototype,"assignedSlot"),shadowHost=getter(ShadowRoot.prototype,"host"),getRootNode=Node.prototype.getRootNode;
  const attrName=getter(Attr.prototype,"name"),attrValue=getter(Attr.prototype,"value"),attrNamespace=getter(Attr.prototype,"namespaceURI");
  const getAttribute=Element.prototype.getAttribute,elementMatches=Element.prototype.matches;
  const docQuery=Document.prototype.querySelectorAll,fragmentQuery=DocumentFragment.prototype.querySelectorAll;
  const slotNodes=HTMLSlotElement.prototype.assignedNodes,templateContent=getter(HTMLTemplateElement.prototype,"content");
  const inputValue=getter(HTMLInputElement.prototype,"value"),computed=window.getComputedStyle;
  const encode=TextEncoder.prototype.encode,encoder=new TextEncoder(),gaps=[],seenGaps=new Set();
  let scannedNodes=0,shadowRoots=0,readBytes=0;
  const gap=(code,targetId)=>{const key=code+"|"+(targetId??"");if(!seenGaps.has(key)){seenGaps.add(key);gaps.push(targetId?{code,targetId}:{code});}};
  const account=value=>{if(typeof value==="string"){
    // UTF-8 bytes cannot be fewer than UTF-16 code units. Reject before encoder allocation.
    if(value.length>limits.textUtf8Bytes-readBytes)throw Error("SNAPSHOT_LIMIT");
    readBytes+=apply(encode,encoder,[value]).byteLength;if(readBytes>limits.textUtf8Bytes)throw Error("SNAPSHOT_LIMIT");
  }return value;};
  const finish=value=>{
    const encoded=JSON.stringify(value);
    if(encoded.length>limits.bodyUtf8Bytes||apply(encode,encoder,[encoded]).byteLength>limits.bodyUtf8Bytes)throw Error("SNAPSHOT_LIMIT");
    return value;
  };
  const attr=(element,name)=>account(apply(getAttribute,element,[name]));
  const children=node=>{const list=childNodes(node);if(list.length>limits.nodes)throw Error("SNAPSHOT_LIMIT");return Array.from(list);};
  const roots=[document],seen=new Set(),pending=[{node:document,depth:0}];
  // A bounded physical walk discovers every open root; no user callback/JSON is invoked.
  while(pending.length){
    const {node,depth}=pending.pop();if(seen.has(node))continue;seen.add(node);
    if(++scannedNodes>limits.nodes||depth>limits.depth)throw Error("SNAPSHOT_LIMIT");
    account(nodeValue(node));
    if(nodeType(node)===1){
      const tag=account(nodeName(node)).toLowerCase();
      if(["iframe","object","embed"].includes(tag))gap(tag);
      const attrs=attributes(node);if(attrs.length>limits.attributesPerNode)throw Error("SNAPSHOT_LIMIT");
      for(const item of Array.from(attrs)){account(attrName(item));account(attrValue(item));account(attrNamespace(item));}
      const shadow=shadowRoot(node);if(shadow){if(++shadowRoots>limits.shadowRoots)throw Error("SNAPSHOT_LIMIT");roots.push(shadow);pending.push({node:shadow,depth:depth+1});}
      if(tag==="template")pending.push({node:templateContent(node),depth:depth+1});
    }
    for(const child of children(node))pending.push({node:child,depth:depth+1});
  }
  const select=selector=>{
    const css=selector.startsWith("css=")?selector.slice(4):selector,matches=[],unique=new Set();
    for(const root of roots){const query=nodeType(root)===9?docQuery:fragmentQuery;for(const node of apply(query,root,[css]))if(!unique.has(node)){unique.add(node);matches.push(node);}}
    return matches;
  };
  const counters={scannedNodes,collectedNodes:0,shadowRoots,textUtf8Bytes:0};
  if(registry.projection==="boot-subtree-v1"){
    const targets=registry.targets.map(target=>{
      const matches=select(target.selector),nodes=[],physical=[],indexes=new Map();
      if(matches.length!==1){gap(matches.length?"ambiguous-target":"missing-target",target.targetId);return {targetId:target.targetId,matchCount:matches.length,nodes};}
      const work=[{node:matches[0],parent:null,edge:"root",depth:0}];
      while(work.length){
        const {node,parent,edge,depth}=work.pop();if(indexes.has(node))continue;
        if(++counters.collectedNodes>limits.nodes||depth>limits.depth)throw Error("SNAPSHOT_LIMIT");
        const index=nodes.length,type=nodeType(node),element=type===1,attrs=element?Array.from(attributes(node)):[];
        indexes.set(node,index);physical.push(node);
        nodes.push({index,parent,edge,type,name:account(nodeName(node)),namespace:element?account(namespace(node)):null,
          value:account(nodeValue(node)),attributes:attrs.map(item=>({name:account(attrName(item)),namespace:account(attrNamespace(item)),value:account(attrValue(item))})),assignedIndexes:[],assignedOutsideTarget:0});
        // Reverse pushes preserve light-child order; extra trees retain explicit edge identities.
        if(element&&nodeName(node).toLowerCase()==="template")work.push({node:templateContent(node),parent:index,edge:"template",depth:depth+1});
        const shadow=element?shadowRoot(node):null;if(shadow)work.push({node:shadow,parent:index,edge:"shadow",depth:depth+1});
        const list=children(node);for(let i=list.length-1;i>=0;i--)work.push({node:list[i],parent:index,edge:"light",depth:depth+1});
      }
      for(let i=0;i<physical.length;i++)if(nodeType(physical[i])===1&&nodeName(physical[i]).toLowerCase()==="slot"){
        const assigned=apply(slotNodes,physical[i],[{flatten:false}]);
        for(const node of assigned){const reference=indexes.get(node);if(reference===undefined)nodes[i].assignedOutsideTarget++;else nodes[i].assignedIndexes.push(reference);}
        if(nodes[i].assignedOutsideTarget)gap("slot-outside-target",target.targetId);
      }
      return {targetId:target.targetId,matchCount:1,nodes};
    });
    return finish({projection:"boot-subtree-v1",targets,counters,gaps});
  }
  if(registry.projection!=="search-membership-v1")throw Error("Unsupported fixed projection");
  const ancestor=node=>{const root=apply(getRootNode,node,[]);return assignedSlot(node)||parentElement(node)||(root instanceof ShadowRoot?shadowHost(root):null);};
  const membership=element=>{
    let current=element,chapterId=null,ancestorDisplayNone=false,depth=0;
    while(current){
      if(++depth>limits.depth)throw Error("SNAPSHOT_LIMIT");
      if(apply(computed,window,[current]).display==="none")ancestorDisplayNone=true;
      if(chapterId===null&&apply(elementMatches,current,[registry.chapterSelector]))chapterId=attr(current,"id");
      current=ancestor(current);
    }
    return {id:attr(element,"id"),tag:nodeName(element),namespace:namespace(element),classAttribute:attr(element,"class"),
      hidden:apply(getAttribute,element,["hidden"])!==null,display:apply(computed,window,[element]).display,ancestorDisplayNone,chapterId};
  };
  const cards=select(registry.cardSelector).map(membership),chapters=select(registry.chapterSelector).map(membership);
  for(const list of [cards,chapters]){const ids=list.map(row=>row.id);if(ids.some(id=>!id)||new Set(ids).size!==ids.length)gap("missing-or-duplicate-id",registry.targetId);}
  const inputs=select(registry.inputSelector),counts=select(registry.countSelector);
  if(inputs.length!==1)gap(inputs.length?"ambiguous-target":"missing-target",registry.targetId);
  if(counts.length!==1)gap(counts.length?"ambiguous-target":"missing-target",registry.targetId);
  counters.collectedNodes=cards.length+chapters.length+(inputs.length===1?1:0)+(counts.length===1?1:0);
  if(counters.collectedNodes>limits.nodes)throw Error("SNAPSHOT_LIMIT");
  const input=inputs.length===1?inputs[0]:null,isInput=input&&nodeName(input).toLowerCase()==="input"&&namespace(input)==="http://www.w3.org/1999/xhtml";
  if(input&&!isInput)gap("unsupported-input",registry.targetId);
  const textContent=getter(Node.prototype,"textContent");
  return finish({projection:"search-membership-v1",targetId:registry.targetId,cards,chapters,
    input:{matchCount:inputs.length,tag:input?account(nodeName(input)):null,value:isInput?account(inputValue(input)):null},
    count:{matchCount:counts.length,text:counts.length===1?account(textContent(counts[0])):null},counters,gaps});
  } catch(error) { if(error?.message==="SNAPSHOT_LIMIT")return {capabilityGap:"limit-exceeded"};throw error; }
}
`;

const FrameTreeSchema = z.object({ frameTree: z.object({ frame: z.object({ id: z.string().min(1), loaderId: z.string().min(1), url: z.string() }) }) });
const ContextSchema = z.object({ context: z.object({
  id: z.number().int(), name: z.string(), uniqueId: z.string().min(1),
  auxData: z.object({ frameId: z.string(), isDefault: z.literal(false), type: z.literal("isolated") }),
}) });
const WorldSchema = z.object({ executionContextId: z.number().int() });
const ResponseSchema = z.object({ result: z.object({ type: z.literal("object"), value: z.unknown() }), exceptionDetails: z.unknown().optional() });
const MirrorSchema = z.object({ root: z.unknown() });
const MirrorNodeSchema = z.object({
  nodeId: z.number().int().positive(), backendNodeId: z.number().int().positive(),
  nodeType: z.number().int(), nodeName: z.string(), nodeValue: z.string(),
  childNodeCount: z.number().int().nonnegative().optional(),
  children: z.array(z.unknown()).optional(), shadowRoots: z.array(z.unknown()).optional(),
  templateContent: z.unknown().optional(), contentDocument: z.unknown().optional(),
  shadowRootType: z.enum(["open", "closed", "user-agent"]).optional(),
  attributes: z.array(z.string()).optional(),
}).passthrough();

/** Deterministic encoding of validated JSON data; digests are computed outside the page. */
function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    const text = JSON.stringify(value); if (text === undefined) throw new Error("Non-JSON snapshot material"); return text;
  }
  if (Array.isArray(value)) return "[" + value.map(canonicalJson).join(",") + "]";
  const item = value as Record<string, unknown>;
  return "{" + Object.keys(item).sort().map(key => JSON.stringify(key) + ":" + canonicalJson(item[key])).join(",") + "}";
}
const digest = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");
export function htmlProtectionSnapshotRegistrySha256(registry: unknown) {
  return digest(canonicalJson(HtmlProtectionSnapshotRegistrySchema.parse(registry)));
}
function noFragment(url: string) { const parsed = new URL(url); parsed.hash = ""; return parsed.href; }
type Gap = HtmlProtectionSnapshotResult["gaps"][number];
/**
 * One-level native requests map light/open containers within fixed budgets.
 * Never recursively serialize unknown closed/frame/plugin content. Shallow CDP metadata
 * can still include a large text/attribute field before transport parsing: caller-owned
 * isolated browser/process limits remain required; this is not a hard memory guarantee.
 * DOM.setChildNodes is protocol population, not a mutation, and is not counted.
 */
async function nativeMirror(session: HtmlProtectionSnapshotCdpPort, root: unknown, active: () => void) {
  const pending = [{ value: root, depth: 0, parent: null as number | null, edge: "root" }];
  const codes = new Set<Gap["code"]>(), ids = new Set<number>(), records: unknown[] = [];
  let bytes = 0, shadows = 0;
  const parseNode = (value: unknown) => {
    // Cap response arrays/strings before Zod traversal or UTF-8 allocation. The raw
    // protocol response itself has already crossed the CDP transport boundary.
    const data = z.object({ nodeValue: z.string(), children: z.unknown().optional(),
      attributes: z.unknown().optional(), shadowRoots: z.unknown().optional() }).passthrough().parse(value);
    if (data.nodeValue.length > HTML_PROTECTION_SNAPSHOT_LIMITS.textUtf8Bytes
      || (Array.isArray(data.children) && data.children.length > HTML_PROTECTION_SNAPSHOT_LIMITS.nodes)
      || (Array.isArray(data.attributes) && data.attributes.length > HTML_PROTECTION_SNAPSHOT_LIMITS.attributesPerNode * 2)
      || (Array.isArray(data.shadowRoots) && data.shadowRoots.length > HTML_PROTECTION_SNAPSHOT_LIMITS.shadowRoots)) throw new Error("SNAPSHOT_LIMIT");
    if (Array.isArray(data.attributes) && data.attributes.some(item => typeof item === "string" && item.length > HTML_PROTECTION_SNAPSHOT_LIMITS.textUtf8Bytes)) throw new Error("SNAPSHOT_LIMIT");
    return MirrorNodeSchema.parse(value);
  };
  while (pending.length) {
    const current = pending.pop()!; let node = parseNode(current.value);
    active();
    if (records.length >= HTML_PROTECTION_SNAPSHOT_LIMITS.nodes || current.depth > HTML_PROTECTION_SNAPSHOT_LIMITS.depth) throw new Error("SNAPSHOT_LIMIT");
    const opaque = node.shadowRootType === "closed" || node.shadowRootType === "user-agent";
    if (!opaque && [1, 9, 11].includes(node.nodeType)) {
      if (node.childNodeCount === undefined) throw new Error("Native container count unavailable");
      if (node.childNodeCount > HTML_PROTECTION_SNAPSHOT_LIMITS.nodes - records.length) throw new Error("SNAPSHOT_LIMIT");
      if (node.childNodeCount !== (node.children?.length ?? 0)) {
        await session.send("DOM.requestChildNodes", { nodeId: node.nodeId, depth: 1, pierce: false }); active();
        node = parseNode(z.object({ node: z.unknown() }).parse(await session.send("DOM.describeNode", {
          backendNodeId: node.backendNodeId, depth: 1, pierce: false,
        })).node); active();
        if (node.childNodeCount !== (node.children?.length ?? 0)) throw new Error("Native mirror incomplete");
      }
    }
    if (ids.has(node.backendNodeId)) throw new Error("Duplicate native mirror identity"); ids.add(node.backendNodeId);
    const strings = [node.nodeName, node.nodeValue, ...(node.attributes ?? [])];
    if (strings.reduce((total, item) => total + item.length, 0) > HTML_PROTECTION_SNAPSHOT_LIMITS.textUtf8Bytes - bytes) throw new Error("SNAPSHOT_LIMIT");
    bytes += strings.reduce((total, item) => total + Buffer.byteLength(item, "utf8"), 0);
    if (bytes > HTML_PROTECTION_SNAPSHOT_LIMITS.textUtf8Bytes) throw new Error("SNAPSHOT_LIMIT");
    if (node.shadowRootType === "closed") codes.add("closed-shadow-root");
    if (["IFRAME", "OBJECT", "EMBED"].includes(node.nodeName.toUpperCase())) codes.add(node.nodeName.toLowerCase() as "iframe" | "object" | "embed");
    if ((node.children?.length ?? 0) > HTML_PROTECTION_SNAPSHOT_LIMITS.nodes || (node.attributes?.length ?? 0) > HTML_PROTECTION_SNAPSHOT_LIMITS.attributesPerNode * 2) throw new Error("SNAPSHOT_LIMIT");
    const index = records.length;
    records.push({ parent: current.parent, edge: current.edge, backendNodeId: node.backendNodeId,
      nodeType: node.nodeType, nodeName: node.nodeName, nodeValue: node.nodeValue,
      attributes: node.attributes ?? [], shadowRootType: node.shadowRootType ?? null,
      childNodeCount: node.childNodeCount ?? null });
    if (opaque) continue;
    const add = (value: unknown, edge: string) => pending.push({ value, edge, parent: index, depth: current.depth + 1 });
    // Embedded documents are unsupported, and closed/UA shadow descendants stay opaque.
    // Inert-template instrumentation is not established by ordinary frame DOM events.
    if (node.templateContent) throw new Error("SNAPSHOT_TEMPLATE_UNSUPPORTED");
    for (const value of [...(node.shadowRoots ?? [])].reverse()) {
      if (++shadows > HTML_PROTECTION_SNAPSHOT_LIMITS.shadowRoots) throw new Error("SNAPSHOT_LIMIT"); add(value, "shadow");
    }
    for (const value of [...(node.children ?? [])].reverse()) add(value, "light");
  }
  const encoded = canonicalJson(records);
  if (Buffer.byteLength(encoded, "utf8") > HTML_PROTECTION_SNAPSHOT_LIMITS.bodyUtf8Bytes) throw new Error("SNAPSHOT_LIMIT");
  return { gaps: [...codes].map(code => ({ code })), sha256: digest(encoded) };
}
function collectedTextBytes(body: HtmlProtectionSnapshotBody) {
  if (body.projection === "boot-subtree-v1") return body.targets.reduce((total, target) => total + target.nodes.reduce((sum, node) =>
    sum + Buffer.byteLength(node.value ?? "", "utf8") + node.attributes.reduce((count, attribute) => count + Buffer.byteLength(attribute.value, "utf8"), 0), 0), 0);
  return [...body.cards, ...body.chapters].reduce((sum, row) => sum + [row.id, row.classAttribute, row.chapterId].reduce<number>((n, text) => n + Buffer.byteLength(text ?? "", "utf8"), 0), 0)
    + Buffer.byteLength(body.input.value ?? "", "utf8") + Buffer.byteLength(body.count.text ?? "", "utf8");
}
function validateRegisteredBody(request: HtmlProtectionSnapshotRequest, body: HtmlProtectionSnapshotBody) {
  if (body.projection !== request.registry.projection) throw new Error("Registered projection mismatch");
  const ids = request.registry.projection === "search-membership-v1" ? [request.registry.targetId] : request.registry.targets.map(target => target.targetId);
  if (body.gaps.some(gap => gap.targetId !== undefined && !ids.includes(gap.targetId))) throw new Error("Foreign snapshot gap scope");
  if (body.projection === "boot-subtree-v1" && request.registry.projection === "boot-subtree-v1") {
    if (body.targets.length !== request.registry.targets.length || body.targets.some((target, index) => target.targetId !== request.registry.targets[index]!.targetId)) throw new Error("Registered target coverage mismatch");
    if (body.targets.some(target => target.matchCount === 1 && !target.nodes.length)) throw new Error("Selected subtree is missing");
    if (body.counters.collectedNodes !== body.targets.reduce((sum, target) => sum + target.nodes.length, 0)) throw new Error("Incomplete subtree count");
  } else if (body.projection === "search-membership-v1" && request.registry.projection === "search-membership-v1" && body.targetId !== request.registry.targetId) throw new Error("Registered membership scope mismatch");
}

function projectionGaps(body: HtmlProtectionSnapshotBody): Gap[] {
  const gaps: Gap[] = [];
  if (body.projection === "boot-subtree-v1") {
    for (const target of body.targets) {
      if (target.matchCount !== 1) gaps.push({ code: target.matchCount ? "ambiguous-target" : "missing-target", targetId: target.targetId });
      if (target.nodes.some(node => node.assignedOutsideTarget > 0)) gaps.push({ code: "slot-outside-target", targetId: target.targetId });
    }
  } else {
    for (const rows of [body.cards, body.chapters]) {
      const ids = rows.map(row => row.id);
      if (ids.some(id => !id) || new Set(ids).size !== ids.length) gaps.push({ code: "missing-or-duplicate-id", targetId: body.targetId });
    }
    for (const count of [body.input.matchCount, body.count.matchCount]) if (count !== 1) gaps.push({ code: count ? "ambiguous-target" : "missing-target", targetId: body.targetId });
    if (body.input.matchCount === 1 && (body.input.tag !== "INPUT" || body.input.value === null)) gaps.push({ code: "unsupported-input", targetId: body.targetId });
    if (body.count.matchCount === 1 && body.count.text === null) throw new Error("Incomplete native count text");
    const count = body.cards.length + body.chapters.length + Number(body.input.matchCount === 1) + Number(body.count.matchCount === 1);
    if (body.counters.collectedNodes !== count) throw new Error("Incomplete membership count");
  }
  return gaps;
}

/**
 * Collect only the registered projection in a positively identified native isolated realm.
 * The caller derives registry/expectations from physical Original and owns the loaded Page.
 * Supplied bytes are hashed here; binding those bytes to the served document remains the
 * trusted execution service responsibility. Native event generation is latched across a
 * fully materialized pre/post mirror window, including transient insert/remove cycles.
 * This is DOM snapshot stability, not cross-script/visual closure. No signing is performed.
 */
export async function collectVercelSandboxHtmlProtectionSnapshot(args: {
  request: unknown; physicalHtml: Uint8Array; createSession(): Promise<HtmlProtectionSnapshotCdpPort>;
}): Promise<HtmlProtectionSnapshotResult> {
  const request = HtmlProtectionSnapshotRequestSchema.parse(args.request);
  const physicalInput = { sha256: digest(args.physicalHtml), byteLength: args.physicalHtml.byteLength };
  const base = { schemaVersion: "html-protection-snapshot-result-v1" as const, request,
    observedAt: new Date().toISOString(), physicalInput, limitations: [...HtmlProtectionSnapshotLimitations] };
  const unavailable = (code: Gap["code"]) => HtmlProtectionSnapshotResultSchema.parse({
    ...base, availability: "unavailable", projectionComplete: false, gaps: [{ code }],
  });
  const expected = request.sourceRole === "original" ? request.binding.original : request.binding.executed;
  if (physicalInput.sha256 !== expected.sha256 || physicalInput.byteLength !== expected.byteLength) return unavailable("physical-input-mismatch");
  if (htmlProtectionSnapshotRegistrySha256(request.registry) !== request.registrySha256) return unavailable("capability-unavailable");
  if (request.registry.projection === "copy-material-v1") return unavailable("copy-material-undefined");
  let session: HtmlProtectionSnapshotCdpPort | undefined, timer: ReturnType<typeof setTimeout> | undefined, expired = false;
  const detached = new Set<HtmlProtectionSnapshotCdpPort>();
  const detach = (port: HtmlProtectionSnapshotCdpPort) => { if (!detached.has(port)) { detached.add(port); void port.detach().catch(() => {}); } };
  const active = () => { if (expired) { if (session) detach(session); throw new Error("Observation deadline expired"); } };
  const operation = (async () => {
    session = await args.createSession(); active();
    const contexts = new Map<number, z.infer<typeof ContextSchema>["context"]>();
    session.on("Runtime.executionContextCreated", event => { const result = ContextSchema.safeParse(event); if (result.success) contexts.set(result.data.context.id, result.data.context); });
    let mutationEvents = 0, monitoring = false;
    for (const event of DOM_MUTATION_EVENTS) session.on(event, () => { if (monitoring) mutationEvents = Math.min(Number.MAX_SAFE_INTEGER, mutationEvents + 1); });
    await session.send("Runtime.enable"); active();
    await session.send("DOM.enable", { includeWhitespace: "all" }); active();
    monitoring = true;
    const stable = () => { active(); if (mutationEvents) throw new Error("UNSTABLE_DOM"); };
    const before = FrameTreeSchema.parse(await session.send("Page.getFrameTree")).frameTree.frame; active();
    if (noFragment(before.url) !== noFragment(request.documentUrl)) throw new Error("UNSTABLE_DOCUMENT");
    const name = "evolution-dom-snapshot-" + randomUUID();
    const world = WorldSchema.parse(await session.send("Page.createIsolatedWorld", { frameId: before.id, worldName: name, grantUniveralAccess: false })); active();
    const context = contexts.get(world.executionContextId);
    if (!context || context.name !== name || context.auxData.frameId !== before.id) throw new Error("Native independent realm not established");
    const observe = async () => {
      const response = ResponseSchema.parse(await session!.send("Runtime.callFunctionOn", {
        functionDeclaration: HTML_PROTECTION_NATIVE_SNAPSHOT_FUNCTION, uniqueContextId: context.uniqueId,
        arguments: [{ value: { registry: request.registry, limits: HTML_PROTECTION_SNAPSHOT_LIMITS } }],
        returnByValue: true, awaitPromise: false, silent: true, userGesture: false,
      })); active();
      if (response.exceptionDetails) throw new Error("SNAPSHOT_CAPABILITY");
      if (z.object({ capabilityGap: z.literal("limit-exceeded") }).strict().safeParse(response.result.value).success) throw new Error("SNAPSHOT_LIMIT");
      return response;
    };
    // A native light/open/template preflight bounds the known tree before CDP metadata
    // requests. It is not the authoritative body and cannot prove unknown closed domains.
    HtmlProtectionSnapshotBodySchema.parse((await observe()).result.value);
    const root = MirrorSchema.parse(await session.send("DOM.getDocument", { depth: 0, pierce: false })).root; active();
    const preMirror = await nativeMirror(session, root, active); stable();
    const documentBackendId = MirrorNodeSchema.parse(root).backendNodeId;
    // All supported physical containers are now mapped for native mutation events.
    // Never clear the latch: even a transient mutation restoring identical endpoints fails.
    const observed = await observe(); stable();
    const postRoot = z.object({ node: z.unknown() }).parse(await session.send("DOM.describeNode", {
      backendNodeId: documentBackendId, depth: 0, pierce: false,
    })).node; stable();
    const postMirror = await nativeMirror(session, postRoot, stable); stable();
    const after = FrameTreeSchema.parse(await session.send("Page.getFrameTree")).frameTree.frame; stable();
    if (before.id !== after.id || before.loaderId !== after.loaderId || noFragment(before.url) !== noFragment(after.url)) throw new Error("UNSTABLE_DOCUMENT");
    if (preMirror.sha256 !== postMirror.sha256) throw new Error("UNSTABLE_DOM");
    const body = HtmlProtectionSnapshotBodySchema.parse(observed.result.value); validateRegisteredBody(request, body);
    body.counters.textUtf8Bytes = collectedTextBytes(body);
    const gaps = [...body.gaps]; for (const gap of [...preMirror.gaps, ...postMirror.gaps, ...projectionGaps(body)]) if (!gaps.some(item => item.code === gap.code && item.targetId === gap.targetId)) gaps.push(gap);
    body.gaps = gaps; HtmlProtectionSnapshotBodySchema.parse(body);
    const encoded = canonicalJson(body), bodyUtf8Bytes = Buffer.byteLength(encoded, "utf8");
    if (bodyUtf8Bytes > HTML_PROTECTION_SNAPSHOT_LIMITS.bodyUtf8Bytes) throw new Error("SNAPSHOT_LIMIT");
    return HtmlProtectionSnapshotResultSchema.parse({
      ...base, observedAt: new Date().toISOString(), availability: "available", projectionComplete: gaps.length === 0,
      realm: { observerVersion: "chromium-cdp-isolated-stable-dom-v2", frameId: before.id, loaderId: before.loaderId, uniqueContextId: context.uniqueId },
      stability: { protocol: "chromium-cdp-dom-mutation-window-v1", preMirrorSha256: preMirror.sha256, postMirrorSha256: postMirror.sha256, mutationEvents: 0 },
      body, bodySha256: digest(encoded), bodyUtf8Bytes, gaps,
    });
  })();
  try {
    return await Promise.race([operation, new Promise<HtmlProtectionSnapshotResult>((_, reject) => {
      timer = setTimeout(() => { expired = true; reject(new Error("Observation deadline expired")); }, HTML_PROTECTION_SNAPSHOT_LIMITS.timeoutMs);
    })]);
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    return unavailable(message.includes("SNAPSHOT_LIMIT") ? "limit-exceeded" : message.includes("UNSTABLE_DOCUMENT") ? "unstable-document" : message.includes("UNSTABLE_DOM") ? "unstable-dom" : message.includes("SNAPSHOT_TEMPLATE_UNSUPPORTED") ? "template-mutation-unavailable" : "capability-unavailable");
  } finally { expired = true; if (timer) clearTimeout(timer); if (session) detach(session); }
}
