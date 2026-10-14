import { validateHtmlProtectionWholeClipboardReadback } from "./html-protection-whole-clipboard-readback";
import { z } from "zod";
import { validateHtmlProtectionWholeSearchReadback } from "./html-protection-whole-search-readback";
import { HTML_PROTECTION_WHOLE_RUNTIME_LIMITS as limits, HtmlProtectionWholeRuntimeRequestSchema,
  HtmlProtectionWholeRuntimeActionFactSchema, HtmlProtectionWholeRuntimeRegistrationSchema, type HtmlProtectionWholeRuntimeRequest } from "@evolution/contracts";
import { validateHtmlProtectionWholeNativeDocument, HtmlProtectionWholeNativeStyleTableSchema } from "./html-protection-whole-native-material";
import { htmlProtectionWholeRuntimeActions } from "@evolution/core";
import { HtmlProtectionOwnedRuntimeBindingSchema, htmlProtectionCloudCanonicalJson as canonical, htmlProtectionCloudSha256 as sha } from "./vercel-sandbox-html-protection-cloud-protocol";
import { HTML_PROTECTION_WHOLE_CLOUD_RUNNER_SCRIPT as runner, HtmlProtectionWholeCloudInputSchema, HtmlProtectionWholeCloudManifestSchema,
  type HtmlProtectionWholeCloudManifest, type HtmlProtectionWholePrivateRecord } from "./vercel-sandbox-html-protection-whole-cloud-protocol";
const equal = (a: unknown, b: unknown) => canonical(a) === canonical(b);
const digest = z.string().regex(/^[a-f0-9]{64}$/);
const native = z.object({ realm: z.object({ frameId: z.string(), loaderId: z.string(), uniqueContextId: z.string().min(1) }).strict(),
  stability: z.object({ preMirrorSha256: digest, postMirrorSha256: digest, mutationEvents: z.literal(0) }).strict(), value: z.unknown(), styleWindow: z.unknown().optional() }).strict();
export type HtmlProtectionWholeReadbackInput = { manifest: unknown; records: Array<{ record: HtmlProtectionWholePrivateRecord; material: unknown }>;
  expectedRequest: HtmlProtectionWholeRuntimeRequest; trustedRuntimeBinding: z.infer<typeof HtmlProtectionOwnedRuntimeBindingSchema> };
/** Pure structural/provenance revalidation after full physical GETs. The runtime binding must come from deployment composition, never a signed DTO. */
export function validateHtmlProtectionWholeReadback(args: HtmlProtectionWholeReadbackInput) {
  const manifest = HtmlProtectionWholeCloudManifestSchema.parse(structuredClone(args.manifest)), request = HtmlProtectionWholeRuntimeRequestSchema.parse(structuredClone(args.expectedRequest));
  const ownedRuntime = HtmlProtectionOwnedRuntimeBindingSchema.parse(structuredClone(args.trustedRuntimeBinding));
  const physical = request.binding[request.sourceRole], input = HtmlProtectionWholeCloudInputSchema.parse({ schemaVersion: "html-protection-whole-private-input-v1",
    nonce: manifest.nonce, request, ownedRuntime, material: { sha256: physical.sha256, byteLength: physical.byteLength } });
  if (!equal(manifest.request, request) || manifest.inputSha256 !== sha(canonical(input)) || manifest.ownedRuntimeSha256 !== ownedRuntime.sha256 || manifest.runnerSha256 !== sha(runner)) throw Error("Whole readback request/runtime binding mismatch");
  if (args.records.length !== manifest.records.length || args.records.some((item, index) => !equal(item.record, manifest.records[index]))) throw Error("Whole readback complete record reference/order mismatch");
  if (manifest.custody) for (const seen of [manifest.custody.staged, manifest.custody.nodeResponse, manifest.custody.browserResponse]) if (!equal(seen, input.material)) throw Error("Whole readback physical custody mismatch");
  const realms = new Set<string>(), documents = new Set<string>(), visuals = new Map<string, Array<ReturnType<typeof validateVisual>>>();
  let actions = 0, boot = false, scripts = 0;
  const actionFacts: Array<z.infer<typeof HtmlProtectionWholeRuntimeActionFactSchema>> = []; let sourceMaterial: unknown;
  const expected = manifest.registration ? htmlProtectionWholeRuntimeActions(request.sourcePlan, manifest.registration) : [];
  if (!equal(manifest.expectedActions, expected)) throw Error("Whole readback independently derived action plan mismatch");
  for (const [index, { record, material }] of args.records.entries()) {
    const bytes = Buffer.from(canonical(material));
    if (sha(bytes) !== record.sha256 || bytes.byteLength !== record.byteLength) throw Error("Whole readback material SHA/size mismatch");
    // Each part is independently bound to its actual physical slice, including numbering and complete byte limits.
    if (record.recordId !== "native-record:" + manifest.nonce + ":" + index) throw Error("Whole readback producer record identity mismatch");
    let offset = 0;
    for (const [partIndex, part] of record.parts.entries()) {
      const actual = bytes.subarray(offset, offset + part.byteLength), path = ".evolution/runtime/whole-observations/" + String(index).padStart(5, "0") + "-" + String(partIndex).padStart(3, "0") + ".part";
      if (part.path !== path || actual.byteLength !== part.byteLength || sha(actual) !== part.sha256 || (partIndex + 1 < record.parts.length && part.byteLength !== limits.partBytes)) throw Error("Whole readback actual part binding mismatch");
      offset += part.byteLength;
    }
    if (offset !== bytes.byteLength) throw Error("Whole readback incomplete physical parts");
    if (record.kind === "boot-census") {
      if (boot || actions || record.stateId !== "native-boot-census") throw Error("Whole readback boot order mismatch"); boot = true;
      validateNative(material, manifest, realms);
      const census = z.object({ controls: HtmlProtectionWholeRuntimeRegistrationSchema.shape.controls, revealTargets: HtmlProtectionWholeRuntimeRegistrationSchema.shape.revealTargets,
        elementCount: z.number().int().positive().max(limits.nodes), gaps: z.array(z.string()) }).strict().parse(native.parse(material).value);
      if (request.sourceRole === "original") {
        const registration = HtmlProtectionWholeRuntimeRegistrationSchema.parse({ schemaVersion: "html-protection-owned-boot-registration-v1", original: request.binding.original,
          sourcePlanSha256: request.sourcePlanSha256, nativeBootSha256: sha(canonical(material)), nativeElementCount: census.elementCount, controls: census.controls, revealTargets: census.revealTargets, gaps: census.gaps });
        if (!equal(registration, manifest.registration)) throw Error("Whole readback Original boot registration independently differs");
      } else if (!equal(request.registration, manifest.registration)) throw Error("Whole readback executed registry cannot expand Original");
    } else if (record.kind === "action") {
      const fact = HtmlProtectionWholeRuntimeActionFactSchema.parse(material); actionFacts.push(fact);
      if (!boot || !equal(fact.action, expected[actions++]) || fact.action.stateId !== record.stateId) throw Error("Whole readback foreign/reordered actual action");
      if (fact.nativeObservation !== undefined) {
        const body = Buffer.from(canonical(fact.nativeObservation));
        if (sha(body) !== fact.nativeObservationSha256 || body.byteLength !== fact.nativeObservationByteLength) throw Error("Whole readback native action body mismatch");
        const observation = z.object({ before: z.unknown().optional(), after: z.unknown().optional(), events: z.unknown().optional(), behaviorClaims: z.unknown().optional(), clipboard: z.unknown().optional(), clipboardExpectation: z.unknown().optional(), dispatchTrace: z.array(z.object({ method: z.string().min(1), parameters: z.record(z.string(), z.unknown()) }).strict()).optional(), navigation: z.unknown().optional() }).strict().parse(fact.nativeObservation);
        for (const window of [observation.before, observation.after].filter(item => item !== undefined)) validateNative(window, manifest, realms);
        if (fact.status === "observed" && (!observation.before || !observation.after || !fact.settled || fact.dispatched !== (fact.action.operation === "boot" ? 0 : 1)
          || fact.beforeBackendNodeId === null || fact.beforeBackendNodeId !== fact.afterBackendNodeId)) throw Error("Whole readback observed action lacks actual execution");
        if (observation.events !== undefined) validateNative(observation.events, manifest, realms);
        if (fact.status === "observed" && fact.action.operation === "copy") z.object({ text: z.string(), sentinelSha256: digest }).strict().parse(observation.clipboard);
        if (fact.status === "observed" && fact.action.intent === "navigate") {
          const navigation = z.object({ selector: z.string(), fragment: z.string(), beforeBackendNodeId: z.number().int().positive(), afterBackendNodeId: z.number().int().positive(), before: z.unknown(), after: z.unknown() }).strict().parse(observation.navigation);
          if (navigation.beforeBackendNodeId !== navigation.afterBackendNodeId) throw Error("Whole readback navigation target drift");
          validateNative(navigation.before, manifest, realms); validateNative(navigation.after, manifest, realms);
        }
      } else if (fact.status === "observed") throw Error("Whole readback observed action missing native body");
    } else if (record.kind === "document") {
      if (documents.has(record.stateId) || !expected.some(action => action.stateId === record.stateId && ["boot", "viewport"].includes(action.operation))) throw Error("Whole readback unregistered native document state");
      documents.add(record.stateId); validateNative(material, manifest, realms);
      validateHtmlProtectionWholeNativeDocument(native.parse(material).value, manifest.custody!.navigation.frameId);
    } else if (record.kind === "visual-tile") {
      const value = validateVisual(material, manifest, realms), match = /^(owned-state:\d+):tile:(\d+)$/.exec(record.stateId);
      if (!match || !documents.has(match[1]!)) throw Error("Whole readback visual tile not bound to observed native document");
      const rows = visuals.get(match[1]!) ?? [];
      if (Number(match[2]) !== rows.length) throw Error("Whole readback visual tile sequence incomplete"); rows.push(value); visuals.set(match[1]!, rows);
    } else if (record.kind === "script-coverage") {
      if (++scripts !== 1 || record.stateId !== "source-program-coverage") throw Error("Whole readback script coverage count/order mismatch"); validateScript(material, manifest); sourceMaterial = material;
    }
  }
  validateHtmlProtectionWholeSearchReadback({ request, facts: actionFacts, sourceMaterial });
  validateHtmlProtectionWholeClipboardReadback({ request, facts: actionFacts, sourceMaterial, custody: manifest.custody?.navigation });
  if (actions !== manifest.actualActionCount || (manifest.registration && !boot) || (realms.size > 1)) throw Error("Whole readback actual observation sequence/realm mismatch");
  if (manifest.availability === "available") {
    if (realms.size !== 1 || scripts !== 1 || expected.some(action => ["boot", "viewport"].includes(action.operation) && !documents.has(action.stateId))) throw Error("Whole readback actual native state set incomplete");
    for (const stateId of documents) validateVisualSet(visuals.get(stateId) ?? []);
  }
  return { manifest, records: args.records.map(item => structuredClone(item)), producerValidation: "whole-owned-native-physical-readback-v2" as const,
    limitations: ["Native material authenticity requires full physical GET readbacks and deployment-owned runtime provenance outside this pure function.", "Validation authenticates actual observations, not arbitrary runtime/continuous responsive closure or acceptance."] };
}
function validateNative(value: unknown, manifest: HtmlProtectionWholeCloudManifest, realms: Set<string>) {
  const observation = native.parse(value);
  if (observation.realm.frameId !== manifest.custody?.navigation.frameId || observation.realm.loaderId !== manifest.custody?.navigation.loaderId
    || observation.stability.preMirrorSha256 !== observation.stability.postMirrorSha256) throw Error("Whole native realm/custody drift");
  realms.add(observation.realm.uniqueContextId);
}
function validateVisual(material: unknown, manifest: HtmlProtectionWholeCloudManifest, realms: Set<string>) {
  validateNative(material, manifest, realms);
  const parsed = z.object({ value: z.object({ image: z.object({ mimeType: z.literal("image/png"), base64: z.string().max(6 * 1024 * 1024), sha256: digest, byteLength: z.number().int().positive().max(4 * 1024 * 1024) }).strict(),
    region: z.object({ x: z.literal(0), y: z.number().finite().nonnegative(), width: z.number().positive(), height: z.number().positive() }).strict(),
    viewport: z.object({ width: z.number().positive(), height: z.number().positive() }).strict(), documentSize: z.object({ width: z.number().positive(), height: z.number().positive() }).strict(),
    before: z.unknown(), after: z.unknown(), nativeScrollDispatches: z.number().int().nonnegative() }).strict(),
    styleWindow: z.object({ before: z.unknown(), after: z.unknown(), preStylesSha256: digest, postStylesSha256: digest }).strict() }).passthrough().parse(material);
  validateNative(parsed.value.before, manifest, realms); validateNative(parsed.value.after, manifest, realms);
  const styles = parsed.styleWindow;
  if (sha(canonical(styles.before)) !== styles.preStylesSha256 || sha(canonical(styles.after)) !== styles.postStylesSha256 || styles.preStylesSha256 !== styles.postStylesSha256) throw Error("Whole visual native CSS/layout window drift");
  const style = z.object({ activeAnimations: z.literal(0), elementCount: z.number().int().positive(), styleTable: HtmlProtectionWholeNativeStyleTableSchema, viewport: z.unknown(), scroll: z.unknown(), documentSize: z.unknown() }).strict().parse(styles.before);
  if (style.elementCount !== style.styleTable.elements.length) throw Error("Whole visual full element/style scope incomplete");
  if (!equal(style.viewport, parsed.value.viewport) || !equal(style.documentSize, parsed.value.documentSize)) throw Error("Whole visual viewport/size outside native CSS/layout window");
  const image = parsed.value.image, bytes = Buffer.from(image.base64, "base64");
  if (bytes.toString("base64") !== image.base64 || sha(bytes) !== image.sha256 || bytes.byteLength !== image.byteLength || !bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) throw Error("Whole visual actual PNG readback mismatch");
  if (bytes.byteLength < 33 || bytes.readUInt32BE(8) !== 13 || bytes.subarray(12, 16).toString("ascii") !== "IHDR"
    || bytes.readUInt32BE(16) !== Math.ceil(parsed.value.region.width) || bytes.readUInt32BE(20) !== Math.ceil(parsed.value.region.height)) throw Error("Whole visual actual PNG dimensions differ from captured region");
  const view = z.object({ viewport: z.unknown(), scroll: z.object({ x: z.number().finite(), y: z.number().finite() }).strict(), documentSize: z.unknown() }).strict();
  const before = view.parse(native.parse(parsed.value.before).value), after = view.parse(native.parse(parsed.value.after).value);
  if (!equal(before, after) || !equal(before.viewport, parsed.value.viewport) || !equal(before.documentSize, parsed.value.documentSize)
    || Math.abs(before.scroll.x) > 1 || Math.abs(before.scroll.y - parsed.value.region.y) > 1 || !equal(style.scroll, before.scroll)) throw Error("Whole visual captured region differs from native scroll window");
  return parsed.value;
}
function validateVisualSet(rows: Array<ReturnType<typeof validateVisual>>) {
  if (!rows.length) throw Error("Whole native pixel coverage absent");
  let covered = 0; const first = rows[0]!;
  for (const row of rows) {
    if (!equal(row.viewport, first.viewport) || !equal(row.documentSize, first.documentSize) || row.region.width !== row.viewport.width || row.region.y > covered + 1
      || row.region.height > row.viewport.height || row.region.y + row.region.height > row.documentSize.height + 1) throw Error("Whole native pixel scope drift/gap");
    covered = Math.max(covered, row.region.y + row.region.height);
  }
  if (first.documentSize.width > first.viewport.width + 1 || covered < first.documentSize.height - 1) throw Error("Whole native pixel coverage incomplete");
}
function validateScript(material: unknown, manifest: HtmlProtectionWholeCloudManifest) {
  const range = z.object({ startOffset: z.number().int().nonnegative(), endOffset: z.number().int().nonnegative(), count: z.number().int().nonnegative() }).strict();
  const parsed = z.object({ producer: z.literal("chromium-v8-precise-source-coverage-v1"), instrumentationPolicy: z.literal("owned-inspector-skip-pauses-before-subject-v1"), frameId: z.string(), sourcePlanOriginal: z.unknown(), expectedScriptCount: z.number().int().nonnegative(),
    scripts: z.array(z.object({ scriptId: z.string().min(1), parentId: z.string(), sourceSha256: digest, sourceCharacters: z.number().int().nonnegative(), frameId: z.string(), url: z.string(), contextUniqueId: z.string().min(1),
      nativeSourceLocation: z.object({ line: z.number().int().nonnegative(), column: z.number().int().nonnegative() }).strict(), coveragePresent: z.boolean(),
      functions: z.array(z.object({ functionName: z.string(), isBlockCoverage: z.boolean(), ranges: z.array(range).min(1) }).passthrough()) }).passthrough()),
    bootstrapScope: z.object({ phase: z.literal("fresh-owned-about-blank-before-subject-navigation-v1"), url: z.literal("about:blank"), frameId: z.string(), loaderId: z.string() }).strict(), controllerBootstrapSha256: digest,
    controllerBootstrap: z.array(z.object({ sourceSha256: digest, sourceCharacters: z.number().int().nonnegative(), nativeContextUniqueId: z.string().min(1), nativeFrameId: z.string() }).strict()).max(2048),
    controllerScripts: z.array(z.object({ sourceSha256: digest, sourceCharacters: z.number().int().nonnegative(), contextUniqueId: z.string().min(1), frameId: z.string(), scriptId: z.string().min(1) }).strict()).max(2048),
    unmatched: z.array(z.unknown()), missingParentIds: z.array(z.string()), gaps: z.array(z.string()) }).passthrough().parse(material);
  if (parsed.frameId !== manifest.custody?.navigation.frameId || !equal(parsed.sourcePlanOriginal, manifest.request.binding.original) || parsed.expectedScriptCount !== manifest.request.sourcePlan.scriptShape.length) throw Error("Whole native script scope binding mismatch");
  if (parsed.bootstrapScope.frameId !== parsed.frameId || parsed.bootstrapScope.loaderId === manifest.custody?.navigation.loaderId
    || parsed.controllerBootstrap.some(item => item.nativeFrameId !== parsed.frameId)
    || parsed.controllerBootstrapSha256 !== sha(canonical({ bootstrapScope: parsed.bootstrapScope, controllerBootstrap: parsed.controllerBootstrap }))) throw Error("Whole native pre-user controller bootstrap binding mismatch");
  const controllerIds = new Set<string>(), defaultRealms = new Set<string>();
  for (const item of parsed.controllerScripts) {
    const boot = parsed.controllerBootstrap.filter(boot => boot.sourceSha256 === item.sourceSha256 && boot.sourceCharacters === item.sourceCharacters), occurrences = parsed.controllerScripts.filter(other => other.sourceSha256 === item.sourceSha256 && other.sourceCharacters === item.sourceCharacters).length;
    if (item.frameId !== parsed.frameId || !boot.length || occurrences > boot.length || controllerIds.has(item.scriptId)) throw Error("Whole native unbound/extra controller script occurrence"); controllerIds.add(item.scriptId); defaultRealms.add(item.contextUniqueId);
  }
  const seen = new Set<string>(), sourceScriptIds = new Set<string>();
  for (const item of parsed.scripts) {
    const expected = manifest.request.sourcePlan.scriptShape.find(script => script.id === item.parentId), location = manifest.request.subjectScriptLocations.find(location => location.parentId === item.parentId), body = expected?.literal?.replace(/\r\n?/g, "\n");
    if (!expected || body === undefined || seen.has(item.parentId) || item.sourceSha256 !== sha(body) || item.sourceCharacters !== body.length || item.frameId !== parsed.frameId || item.url !== manifest.custody?.documentUrl || controllerIds.has(item.scriptId) || sourceScriptIds.has(item.scriptId)
      || !equal(item.nativeSourceLocation, location && { line: location.line, column: location.column }) || item.functions.some(fn => fn.ranges.some(range => range.endOffset < range.startOffset || range.endOffset > body.length))) throw Error("Whole native script occurrence/range mismatch");
    seen.add(item.parentId); sourceScriptIds.add(item.scriptId); defaultRealms.add(item.contextUniqueId);
  }
  const missing = manifest.request.sourcePlan.scriptShape.filter(script => !seen.has(script.id)).map(script => script.id);
  if (defaultRealms.size > 1 || parsed.missingParentIds.length !== new Set(parsed.missingParentIds).size || !equal([...parsed.missingParentIds].sort(), [...missing].sort())) throw Error("Whole native missing source parent or realm concealed");
  if (manifest.availability === "available" && (parsed.unmatched.length || parsed.missingParentIds.length || parsed.gaps.length || missing.length || parsed.scripts.some(script => !script.coveragePresent || !script.functions.length))) throw Error("Whole native source coverage incomplete");
}
