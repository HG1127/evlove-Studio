import { createHash } from "node:crypto";
import { z } from "zod";
import { HtmlProtectionSemanticFrozenRequirementsSchema, HtmlProtectionSemanticObservationsSchema, type HtmlProtectionSemanticObservations, type HtmlProtectionObligation, type HtmlProtectionSemanticFrozenRequirements } from "@evolution/contracts";
import { deriveHtmlProtectionSemanticRequirementScopes, type HtmlProtectionObligationPlan } from "@evolution/core";
import { runServerAi } from "./ai-gateway";
import { htmlProtectionCanonicalJson } from "./server-html-protection-authority-attestation";
const sha = (value: string) => createHash("sha256").update(value, "utf8").digest("hex");
const NativeDocument = z.object({ value: z.object({ snapshot: z.object({ strings: z.array(z.string()),
  documents: z.array(z.object({ nodes: z.object({ parentIndex: z.array(z.number().int()), nodeType: z.array(z.number().int()),
    nodeName: z.array(z.number().int()), nodeValue: z.array(z.number().int()), attributes: z.array(z.array(z.number().int())) }).passthrough() }).passthrough()).min(1),
}).passthrough() }).passthrough() }).passthrough();
export type HtmlProtectionSemanticComponent = { obligationId: string; originalContent: string; executedContent: string;
  originalRendered: string; executedRendered: string; originalContentSha256: string; executedContentSha256: string;
  originalRenderedSha256: string; executedRenderedSha256: string; requirementsSha256: string;
  requirementScope: ReturnType<typeof deriveHtmlProtectionSemanticRequirementScopes>["scopes"][number]; available: boolean };
function nativeText(raw: unknown, id?: string) {
  const parsed = NativeDocument.safeParse(raw);
  if (!parsed.success || parsed.data.value.snapshot.documents.length !== 1) return undefined;
  const { strings, documents } = parsed.data.value.snapshot, nodes = documents[0]!.nodes, count = nodes.nodeType.length;
  if ([nodes.parentIndex, nodes.nodeName, nodes.nodeValue, nodes.attributes].some(values => values.length !== count)) return undefined;
  if(nodes.parentIndex.some(parent=>parent < -1 || parent >= count)
    ||nodes.nodeName.some(index=>index<0||index>=strings.length)||nodes.nodeValue.some(index=>index<0||index>=strings.length)
    ||nodes.attributes.some(attributes=>attributes.length%2!==0||attributes.some(index=>index<0||index>=strings.length)))return undefined;
  for(let index=0;index<count;index++){let cursor=index;const seen=new Set<number>();while(cursor>=0){if(seen.has(cursor))return undefined;seen.add(cursor);cursor=nodes.parentIndex[cursor]!;}}
  let root = -1;
  if (id !== undefined) {
    const matches: number[] = [];
    nodes.attributes.forEach((attributes, index) => {
      if (attributes.length % 2) return;
      for (let offset = 0; offset < attributes.length; offset += 2) if (strings[attributes[offset]!] === "id" && strings[attributes[offset + 1]!] === id) matches.push(index);
    });
    if (matches.length > 1) return undefined;
    if (!matches.length) return "";
    root = matches[0]!;
  }
  const parts: string[] = [];
  for (let index = 0; index < count; index++) {
    if (nodes.nodeType[index] !== 3) continue;
    let cursor = index, selected = root === -1, excluded = false;
    const seen = new Set<number>();
    while (cursor >= 0) {
      if (cursor >= count || seen.has(cursor)) return undefined;
      seen.add(cursor); if (cursor === root) selected = true;
      const name = strings[nodes.nodeName[cursor]!] ?? "";
      if (/^(SCRIPT|STYLE)$/i.test(name)) excluded = true;
      cursor = nodes.parentIndex[cursor]!;
    }
    const value = strings[nodes.nodeValue[index]!];
    if (value === undefined) return undefined;
    if (selected && !excluded) parts.push(value);
  }
  return parts.join("");
}
/** Native bodies must already have independent full manifest/custody/record validation. No page text/AI value is accepted here. */
export function prepareServerHtmlProtectionSemanticComponents(args: { plan: HtmlProtectionObligationPlan;
  originalHtml: string; executedHtml: string; originalNativeDocument: unknown; executedNativeDocument: unknown;
  executedInventory: HtmlProtectionObligationPlan["originalInventory"]; nativeComplete: boolean; frozenRequirements: HtmlProtectionSemanticFrozenRequirements }) {
  const requirements = deriveHtmlProtectionSemanticRequirementScopes(args), requirementsSha256 = sha(htmlProtectionCanonicalJson(requirements.frozenRequirements));
  return args.plan.requiredObligations.filter(item => item.evidenceKind === "semantic").map(obligation => {
    const originalCard = args.plan.scope.cards.find(card => card.semanticObligationId === obligation.id || card.contentObligationId === obligation.id);
    const original = originalCard ? args.plan.originalInventory.cards[originalCard.originalIndex]!.literal : args.originalHtml;
    const currentCards = originalCard?.id ? args.executedInventory.cards.filter(card => card.id === originalCard.id) : [];
    const executed = originalCard ? currentCards.length === 1 ? currentCards[0]!.literal : currentCards.length === 0 ? "" : null : args.executedHtml;
    const originalRendered = nativeText(args.originalNativeDocument, originalCard?.id ?? undefined);
    const executedRendered = nativeText(args.executedNativeDocument, originalCard?.id ?? undefined);
    const available = args.nativeComplete && original !== null && executed !== null && originalRendered !== undefined
      && executedRendered !== undefined && Boolean(originalRendered.trim()) && (!originalCard || Boolean(originalCard.id));
    return { obligationId: obligation.id, originalContent: original ?? "", executedContent: executed ?? "",
      originalRendered: originalRendered ?? "", executedRendered: executedRendered ?? "",
      originalContentSha256: sha(original ?? ""), executedContentSha256: sha(executed ?? ""),
      originalRenderedSha256: sha(originalRendered ?? ""), executedRenderedSha256: sha(executedRendered ?? ""), requirementsSha256,
      requirementScope: requirements.scopes.find(item => item.obligationId === obligation.id)!, available };
  });
}
function cites(citations: HtmlProtectionSemanticObservations["observations"][number]["originalCitations"], content: string) {
  return citations.every(item => Number.isInteger(item.start) && Number.isInteger(item.end)
    && item.start >= 0 && item.end <= content.length && item.end > item.start && content.slice(item.start, item.end) === item.quote);
}
const SEGMENT_CHARACTERS = 1000;
type Range = { start: number; end: number };
export type HtmlProtectionSemanticSegment = HtmlProtectionSemanticComponent & { observationId: string; originalRenderedRange: Range; executedRenderedRange: Range };
function ranges(text:string):Range[]{
  const result:Range[]=[];
  for(let start=0;start<text.length;){let end=Math.min(text.length,start+SEGMENT_CHARACTERS);
    if(end<text.length&&text.charCodeAt(end)>=0xDC00&&text.charCodeAt(end)<=0xDFFF&&text.charCodeAt(end-1)>=0xD800&&text.charCodeAt(end-1)<=0xDBFF)end--;
    result.push({start,end});start=end;}
  return result.length?result:[{start:0,end:0}];
}
/** A deterministic complete registered partition, independently re-derived from full native text on restoration. */
export function prepareServerHtmlProtectionSemanticSegments(components:readonly HtmlProtectionSemanticComponent[]):HtmlProtectionSemanticSegment[]{
  return components.flatMap(component=>{const original=ranges(component.originalRendered),executed=ranges(component.executedRendered),count=Math.max(original.length,executed.length);
    return Array.from({length:count},(_,index)=>{const originalRenderedRange=original[Math.min(index,original.length-1)]!,executedRenderedRange=executed[Math.min(index,executed.length-1)]!;
      const observationId="semantic-segment:"+sha(JSON.stringify({id:component.obligationId,original:component.originalContentSha256,executed:component.executedContentSha256,
        originalNative:component.originalRenderedSha256,executedNative:component.executedRenderedSha256,requirements:component.requirementsSha256,index,originalRenderedRange,executedRenderedRange}));
      return {...component,observationId,originalRenderedRange,executedRenderedRange};});});
}
function coversNative(citations:HtmlProtectionSemanticObservations["observations"][number]["originalRenderedCitations"],content:string,range:Range){
  if(!cites(citations,content)||citations.some(item=>item.start<range.start||item.end>range.end))return false;
  let covered=range.start;
  for(const citation of [...citations].sort((a,b)=>a.start-b.start||a.end-b.end)){if(citation.start>covered)return false;covered=Math.max(covered,citation.end);}
  return covered===range.end;
}
/** Re-run all complete partitions against fresh physical/native inputs. A saved row or model status cannot define its scope. */
export function validateServerHtmlProtectionSemanticObservations(args:{components:readonly HtmlProtectionSemanticComponent[];raw:readonly unknown[];required:readonly HtmlProtectionObligation[]}){
  const parsed=args.raw.map(raw=>HtmlProtectionSemanticObservationsSchema.parse(raw)),observations=parsed.flatMap(batch=>batch.observations),segments=prepareServerHtmlProtectionSemanticSegments(args.components);
  if(new Set(observations.map(item=>item.observationId)).size!==observations.length||observations.some(item=>!segments.some(segment=>segment.observationId===item.observationId)))throw Error("html-protection-semantic-scope-ambiguous");
  for(const observation of observations){const component=segments.find(item=>item.observationId===observation.observationId)!;
    if(observation.observationOrigin==="exact-full-identity"&&(!component.available||component.originalContent!==component.executedContent||component.originalRendered!==component.executedRendered||observation.status!=="retained"))throw Error("html-protection-semantic-exact-identity-fabricated");
    if(observation.obligationId!==component.obligationId||JSON.stringify(observation.originalRenderedRange)!==JSON.stringify(component.originalRenderedRange)
      ||JSON.stringify(observation.executedRenderedRange)!==JSON.stringify(component.executedRenderedRange)
      ||["originalContentSha256","executedContentSha256","originalRenderedSha256","executedRenderedSha256","requirementsSha256"].some(key=>observation[key as keyof typeof observation]!==component[key as keyof typeof component])
      ||!cites(observation.originalCitations,component.originalContent)||!cites(observation.executedCitations,component.executedContent)
      ||observation.status!=="unavailable"&&!observation.originalCitations.length||observation.status==="retained"&&!observation.executedCitations.length
      ||!cites(observation.originalRenderedCitations,component.originalRendered)||!cites(observation.executedRenderedCitations,component.executedRendered)
      ||observation.status!=="unavailable"&&!coversNative(observation.originalRenderedCitations,component.originalRendered,component.originalRenderedRange)
      ||observation.status==="retained"&&!coversNative(observation.executedRenderedCitations,component.executedRendered,component.executedRenderedRange)
      ||observation.status==="changed"&&!observation.differences.length)throw Error("html-protection-semantic-observation-binding-invalid");
  }
  const evidence:Array<{obligationId:string;verificationStatus:"verified"|"failed"|"unverified";detail:string}>=[],supportedObligationIds:string[]=[];
  for(const component of args.components){const expected=segments.filter(item=>item.obligationId===component.obligationId),rows=observations.filter(item=>item.obligationId===component.obligationId);
    const knownScope=component.requirementScope.verificationStatus!=="unverified",complete=component.available&&knownScope&&rows.length===expected.length&&rows.every(item=>item.status!=="unavailable"),
      failed=component.available&&(component.requirementScope.verificationStatus==="failed"||knownScope&&rows.some(item=>item.status==="changed"));
    if(complete||failed)supportedObligationIds.push(component.obligationId);
    evidence.push({obligationId:component.obligationId,verificationStatus:failed?"failed":complete?"verified":"unverified",
      detail:component.requirementScope.verificationStatus==="failed"?"Complete physical text changed outside the independently derived frozen editable body regions"
        :!knownScope?component.requirementScope.gaps.join("; "):rows.length?rows.map(item=>item.observationId+": "+item.observedMeaning+(item.differences.length?" | "+item.differences.join(" | "):"")).join("\n"):"Complete physical/native semantic observations are unavailable"});
  }
  if(args.required.filter(item=>item.evidenceKind==="semantic").some(item=>!args.components.some(component=>component.obligationId===item.id)))throw Error("html-protection-semantic-required-component-missing");
  return {evidence,supportedObligationIds,raw:parsed};
}
const MAX_MODEL_CALLS=24,MAX_REPEAT_INPUT_BYTES=20*1024*1024,MAX_SEGMENTS=4096,BATCH_QUOTE_CHARACTERS=4000;
function componentContextId(component:Pick<HtmlProtectionSemanticComponent,"originalContentSha256"|"executedContentSha256"|"originalRenderedSha256"|"executedRenderedSha256"|"requirementsSha256">){return "semantic-context:"+sha(JSON.stringify({
  originalContent:component.originalContentSha256,executedContent:component.executedContentSha256,
  originalNative:component.originalRenderedSha256,executedNative:component.executedRenderedSha256,requirements:component.requirementsSha256}));}
function quotedContextId(segment:HtmlProtectionSemanticSegment){return JSON.stringify({context:componentContextId(segment),originalRange:segment.originalRenderedRange,executedRange:segment.executedRenderedRange});}
function quotedCharacters(segment:HtmlProtectionSemanticSegment){return segment.originalRenderedRange.end-segment.originalRenderedRange.start+segment.executedRenderedRange.end-segment.executedRenderedRange.start;}
function exactIdentity(component:HtmlProtectionSemanticComponent){return component.available&&component.originalContent===component.executedContent&&component.originalRendered===component.executedRendered;}
function literalCitation(text:string,range:Range){return range.end>range.start?[{...range,quote:text.slice(range.start,range.end)}]:[];}
function exactIdentityObservation(segment:HtmlProtectionSemanticSegment):HtmlProtectionSemanticObservations["observations"][number]{
  return {obligationId:segment.obligationId,observationId:segment.observationId,observationOrigin:"exact-full-identity",
    originalRenderedRange:segment.originalRenderedRange,executedRenderedRange:segment.executedRenderedRange,
    originalContentSha256:segment.originalContentSha256,executedContentSha256:segment.executedContentSha256,
    originalRenderedSha256:segment.originalRenderedSha256,executedRenderedSha256:segment.executedRenderedSha256,requirementsSha256:segment.requirementsSha256,status:"retained",
    originalCitations:literalCitation(segment.originalContent,{start:0,end:Math.min(400,segment.originalContent.length)}),
    executedCitations:literalCitation(segment.executedContent,{start:0,end:Math.min(400,segment.executedContent.length)}),
    originalRenderedCitations:literalCitation(segment.originalRendered,segment.originalRenderedRange),executedRenderedCitations:literalCitation(segment.executedRendered,segment.executedRenderedRange),
    observedMeaning:"Complete physical component and complete independently collected native text are exactly identical",differences:[]};
}
/** Bounded workload is computed from the complete native manifest before any model request. No overflow is sampled. */
export function prepareServerHtmlProtectionSemanticCollection(args:{components:readonly HtmlProtectionSemanticComponent[];originalHtml:string;executedHtml:string;binding:unknown;required?:readonly HtmlProtectionObligation[];frozenRequirements:HtmlProtectionSemanticFrozenRequirements}){
  const frozenRequirements=HtmlProtectionSemanticFrozenRequirementsSchema.parse(args.frozenRequirements),requirementsSha256=sha(htmlProtectionCanonicalJson(frozenRequirements));
  if(args.components.some(item=>item.requirementsSha256!==requirementsSha256))throw Error("html-protection-semantic-request-frozen-requirements-drift");
  const registered=prepareServerHtmlProtectionSemanticSegments(args.components),available=registered.filter(item=>item.available&&item.requirementScope.verificationStatus==="verified"),exact=available.filter(exactIdentity),models=available.filter(item=>!exactIdentity(item));
  // Only full independently derived input contexts are shared. Every obligation keeps its own registered observation and model decision.
  const contexts=new Map<string,HtmlProtectionSemanticComponent>();
  for(const component of available){const key=componentContextId(component),prior=contexts.get(key);
    if(prior&&(prior.originalContent!==component.originalContent||prior.executedContent!==component.executedContent||prior.originalRendered!==component.originalRendered||prior.executedRendered!==component.executedRendered))throw Error("html-protection-semantic-full-context-identity-conflict");
    contexts.set(key,component);
  }
  const groups=new Map<string,HtmlProtectionSemanticSegment[]>();
  for(const segment of models){const key=quotedContextId(segment),group=groups.get(key)??[];group.push(segment);groups.set(key,group);}
  const batches:HtmlProtectionSemanticSegment[][]=[];
  for(const segment of [...groups.values()].flat()){
    const last=batches.at(-1),seen=new Set<string>();let used=0;
    for(const prior of last??[]){const key=quotedContextId(prior);if(!seen.has(key)){seen.add(key);used+=quotedCharacters(prior);}}
    const added=seen.has(quotedContextId(segment))?0:quotedCharacters(segment);
    if(!last||last.length===16||used+added>BATCH_QUOTE_CHARACTERS)batches.push([segment]);else last.push(segment);
  }
  const payloads:unknown[]=[],gaps:string[]=[];let repeatedInputBytes=0;
  if(registered.length>MAX_SEGMENTS)gaps.push("html-protection-semantic-complete-manifest-segment-capacity");
  if(batches.length>MAX_MODEL_CALLS)gaps.push("html-protection-semantic-complete-manifest-model-capacity");
  if(!gaps.length)for(const segments of batches){
    const ids=new Set(segments.map(componentContextId)),unique=[...ids].map(id=>contexts.get(id)!);
    const payload={binding:args.binding,frozenRequirements,requirementsSha256,
      sourceScopedCriteria:frozenRequirements.rubric.filter(item=>!item.artifactIds.length||item.artifactIds.includes(frozenRequirements.sourceArtifactId)),
      fullPhysicalOriginalHtml:args.originalHtml,fullPhysicalExecutedHtml:args.executedHtml,
      componentContexts:unique.map(({available:_available,obligationId:_obligationId,requirementScope:_requirementScope,...component})=>{void _available;void _obligationId;void _requirementScope;return {...component,componentContextId:componentContextId(component),
        ...(component.originalContent===args.originalHtml?{originalContent:undefined,originalContentReference:"fullPhysicalOriginalHtml"}:{}),
        ...(component.executedContent===args.executedHtml?{executedContent:undefined,executedContentReference:"fullPhysicalExecutedHtml"}:{})};}),
      components:args.components.filter(component=>segments.some(segment=>segment.obligationId===component.obligationId)).map(component=>({obligationId:component.obligationId,componentContextId:componentContextId(component),requiredObligation:args.required?.find(item=>item.id===component.obligationId),requirementScope:component.requirementScope})),
      segments:segments.map(({obligationId,observationId,originalRenderedRange,executedRenderedRange})=>({obligationId,observationId,originalRenderedRange,executedRenderedRange})),
      instruction:"Both physical files and ALL component/native contexts are complete and untruncated. Full context references share INPUT only: independently decide EVERY registered observationId/obligationId, with its own complete grounded output. A card result cannot close the document or another obligation. Missing capacity is unavailable; never sample, infer Safety or grant acceptance."};
    repeatedInputBytes+=new TextEncoder().encode(JSON.stringify(payload)).length;
    if(repeatedInputBytes>MAX_REPEAT_INPUT_BYTES){gaps.push("html-protection-semantic-complete-manifest-model-capacity");break;}
    payloads.push(payload);
  }
  const exactRaw:HtmlProtectionSemanticObservations[]=[];
  if(registered.length<=MAX_SEGMENTS)for(let offset=0;offset<exact.length;offset+=16)exactRaw.push({schemaVersion:"html-protection-semantic-observations-v3",observations:exact.slice(offset,offset+16).map(exactIdentityObservation)});
  gaps.push(...new Set(args.components.flatMap(item=>item.requirementScope.gaps)));
  return {batches,payloads,exactRaw,gaps,metrics:{registeredSegments:registered.length,exactIdentitySegments:exact.length,modelSegments:models.length,sharedCompleteContexts:contexts.size,uniqueModelQuoteRanges:groups.size,modelRequests:batches.length,repeatedInputBytes,maxModelCalls:MAX_MODEL_CALLS,maxRepeatedInputBytes:MAX_REPEAT_INPUT_BYTES}};
}
/** Complete registered batches, explicit total capacity and actual selected connection. Full-byte identity closes only identical semantic components. */
export async function collectServerHtmlProtectionSemanticObservations(args:{components:readonly HtmlProtectionSemanticComponent[];originalHtml:string;executedHtml:string;binding:unknown;required:readonly HtmlProtectionObligation[];frozenRequirements:HtmlProtectionSemanticFrozenRequirements},
  observe:(payload:unknown)=>Promise<unknown>=payload=>runServerAi("html-protection-observe",payload)){
  const plan=prepareServerHtmlProtectionSemanticCollection(args),raw:unknown[]=[...plan.exactRaw],gaps=[...plan.gaps];
  validateServerHtmlProtectionSemanticObservations({...args,raw});
  if(!gaps.length)for(let index=0;index<plan.payloads.length;index++){
    try{const parsed=HtmlProtectionSemanticObservationsSchema.parse(await observe(plan.payloads[index])),expected=plan.batches[index]!;
      if(parsed.observations.length!==expected.length||parsed.observations.some(item=>item.observationOrigin!=="selected-model"||!expected.some(segment=>segment.observationId===item.observationId)))throw Error("html-protection-semantic-response-outside-requested-batch");
      validateServerHtmlProtectionSemanticObservations({...args,raw:[...raw,parsed]});raw.push(parsed);
    }catch{gaps.push("html-protection-selected-model-semantic-observation-unavailable");break;}
  }
  return {...validateServerHtmlProtectionSemanticObservations({...args,raw}),gaps,metrics:plan.metrics};
}
