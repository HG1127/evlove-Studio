import {z} from "zod";

const sha=z.string().regex(/^[a-f0-9]{64}$/);
const count=z.number().int().nonnegative();
export const HTML_NATIVE_PROFILE_ID="vibe-sop-browser-v1";
export const HTML_NATIVE_OBSERVATION_VERSION="html-native-observation-v1";

// Only source-derived search predicates may accompany the known native profile.
// This is deliberately separate from TestCase: no question, expected answer or case prose enters the VM.
const selector=z.string().min(1).max(160);
export const HtmlNativeBrowserStepSchema=z.discriminatedUnion("action",[
  z.object({action:z.literal("visible"),selector}).strict(),
  z.object({action:z.literal("fill"),selector,value:z.string().max(80)}).strict(),
  z.object({action:z.literal("text"),selector,value:z.string().max(80)}).strict(),
  z.object({action:z.literal("count"),selector,count}).strict(),
]);
export const HtmlNativeBrowserAssertionsSchema=z.object({
  schemaVersion:z.literal("source-grounded-browser-assertions-v1"),
  plans:z.array(z.array(HtmlNativeBrowserStepSchema).min(1).max(12)).min(1).max(2),
}).strict().refine(value=>new Set(value.plans.map(plan=>JSON.stringify(plan))).size===value.plans.length,"Duplicate browser plans");
export type HtmlNativeBrowserAssertions=z.infer<typeof HtmlNativeBrowserAssertionsSchema>;

export const HtmlNativeInventorySchema=z.object({
  cards:count,menu:count,top:count,progress:count,pageCopy:count,promptCopy:count,editablePrompts:count,
  checkItems:count,checkPanels:count,details:count,
  internalLinks:z.array(z.string().regex(/^#[\w:-]+$/)).max(500),
  unknownControls:z.array(z.object({tag:z.string(),type:z.string().nullable(),id:z.string()})).max(1000),
}).strict();

export const HtmlNativeCheckSchema=z.object({
  id:z.string().min(1).max(160),pass:z.boolean(),
  tested:count.optional(),failed:count.optional(),count:count.optional(),visible:count.optional(),expected:count.optional(),
  query:z.string().max(80).optional(),targetCardId:z.string().regex(/^slide-\d+$/).optional(),
  expectedMatched:z.boolean().optional(),matched:z.boolean().optional(),
}).strip();

export const HtmlRenderedParagraphFactsSchema=z.object({
  viewport:z.number().int().positive(),
  paragraphs:z.array(z.object({
    section:z.string().max(120),role:z.enum(["introductory","card-detail","paragraph"]),chars:count,
    lineCount:count,height:z.number().finite().nonnegative(),cardCount:count,cardDetailChars:count,
  }).strict()).max(12),
}).strict();

export const HtmlNativeSubjectSchema=z.object({
  sha256:sha,bodyTextFingerprint:z.string().min(1).max(100),inventory:HtmlNativeInventorySchema,checks:z.array(HtmlNativeCheckSchema).min(1).max(1000),
  failures:z.array(z.string().max(160)).max(1000),elapsedMs:z.number().finite().nonnegative(),
  renderedParagraphs:z.array(HtmlRenderedParagraphFactsSchema).length(2),
}).strict();

export const HTML_NATIVE_STYLE_STATE_POLICY="source-navigation-style-v2";
export const HtmlNativeStyleNavigationStateSchema=z.object({
  requestedHref:z.string().regex(/^#[\w:-]+$/).max(160),locationHref:z.string().max(160),
  activeHref:z.string().max(160).nullable(),focusedHref:z.string().max(160).nullable(),menuOpen:z.boolean(),
}).strict();
const focusState=HtmlNativeStyleNavigationStateSchema.extend({focus:z.object({
  path:z.string().min(1).max(1000).regex(/^[A-Z][A-Z0-9-]*:\d+(?:\/[A-Z][A-Z0-9-]*:\d+)*$/).nullable(),
  documentFocused:z.boolean(),
}).strict()});
export const HtmlNativeStyleStateSchema=z.discriminatedUnion("policy",[
  z.object({policy:z.literal("source-navigation-style-v1"),original:HtmlNativeStyleNavigationStateSchema,subject:HtmlNativeStyleNavigationStateSchema}).strict(),
  z.object({policy:z.literal(HTML_NATIVE_STYLE_STATE_POLICY),original:focusState,subject:focusState}).strict(),
]);
export type HtmlNativeStyleState=z.infer<typeof HtmlNativeStyleStateSchema>;
export const HtmlNativeStyleComparisonSchema=z.object({
  width:z.union([z.literal(1440),z.literal(390)]),propertyCount:z.literal(50),
  namedElementsCompared:count,styleGroupsCompared:count,changedNamed:z.array(z.string().max(160)).max(5000),
  missingGroups:z.array(z.string().max(500)).max(5000),infiniteAnimations:count,pass:z.boolean(),
  state:HtmlNativeStyleStateSchema.optional(),
}).strict().superRefine((value,ctx)=>{
  const state=value.state;
  if(state&&value.pass){
    const target=state.original.requestedHref;
    const navigationMatches=[state.original,state.subject].every(s=>s.requestedHref===target&&s.locationHref===target&&s.activeHref===target&&!s.menuOpen);
    const focusMatches=state.policy==="source-navigation-style-v1"?[state.original,state.subject].every(s=>s.focusedHref===target):
      state.subject.focusedHref===state.original.focusedHref&&state.subject.focus.path===state.original.focus.path&&state.subject.focus.documentFocused===state.original.focus.documentFocused;
    if(!navigationMatches||!focusMatches)
      ctx.addIssue({code:"custom",path:["state"],message:"Passing style comparison requires the same observed source navigation state"});
  }
});

/** Observation of one known renderer profile; it never declares a semantic quality/acceptance pass. */
const HtmlNativeVmObservationSchema=z.object({
  schemaVersion:z.literal(HTML_NATIVE_OBSERVATION_VERSION),profileId:z.literal(HTML_NATIVE_PROFILE_ID),
  isolation:z.literal("network-denied-ephemeral"),
  observedAt:z.iso.datetime(),kernelSha256:sha,programSignature:sha,styleSignature:sha,
  originalCodeBlocksRetained:z.boolean(),originalNamedElementsRetained:z.boolean(),originalInteractiveSequenceRetained:z.boolean(),
  codeBlockRetention:z.object({policy:z.literal("original-text-with-numbered-instruction-append-v1"),
    originalCount:count,retainedCount:count,exactCount:count,extendedInstructionCount:count,retained:z.boolean()}).strict().optional(),
  originalNamedElementCount:count,
  rawNamedAttributesRetained:z.boolean(),derivedSearchMetadataUpdates:count,
  originalSlideCardOrderRetained:z.boolean(),original:HtmlNativeSubjectSchema,subject:HtmlNativeSubjectSchema,
  contentSearchQueries:z.array(z.object({cardId:z.string().regex(/^slide-\d+$/),query:z.string().min(1).max(80)}).strict()).max(12),
  styleComparison:z.array(HtmlNativeStyleComparisonSchema).length(2),
  browserAssertions:HtmlNativeBrowserAssertionsSchema.optional(),
  billingStatus:z.literal("unavailable"),limitations:z.array(z.string().max(500)).max(12),
}).strict().superRefine((value,ctx)=>{
  const target=value.original.inventory.internalLinks[0];
  if(value.styleComparison.some(row=>row.state)&&value.styleComparison.some(row=>!row.state))
    ctx.addIssue({code:"custom",path:["styleComparison"],message:"Recorded navigation state must cover both viewports"});
  if(new Set(value.styleComparison.flatMap(row=>row.state?[row.state.policy]:[])).size>1)
    ctx.addIssue({code:"custom",path:["styleComparison"],message:"Both viewports must use the same explicit style-state policy"});
  if(value.styleComparison.some(row=>row.state&&[row.state.original,row.state.subject].some(s=>s.requestedHref!==target)))
    ctx.addIssue({code:"custom",path:["styleComparison"],message:"Navigation state must bind the Original's first recorded internal link"});
});
export const HTML_NATIVE_LOCAL_OBSERVATION_VERSION="html-native-observation-v2-local-browser";
export const HtmlNativeLocalBoundarySchema=z.object({
  kind:z.literal("local-browser-process-sandbox-v1"),runId:z.string().min(1).max(200),
  browserVersion:z.string().min(1).max(160),chromiumSandbox:z.literal(true),headless:z.literal(true),
  freshProcessPerSubject:z.literal(true),networkPolicy:z.literal("deny-all"),
  serviceWorkers:z.literal("block"),downloads:z.literal(false),popups:z.literal("blocked"),
  credentialEnvironment:z.literal("excluded"),storage:z.literal("ephemeral"),
}).strict();
const {schemaVersion:legacyVersion,...observationShape}=HtmlNativeVmObservationSchema.shape;void legacyVersion;
export const HtmlNativeLocalObservationSchema=z.object({
  schemaVersion:z.literal(HTML_NATIVE_LOCAL_OBSERVATION_VERSION),...observationShape,
  executionBoundary:HtmlNativeLocalBoundarySchema,
}).strict().superRefine((value,ctx)=>{
  // Keep the same source/navigation constraints as V1; only the execution provenance differs.
  const {executionBoundary:_,...legacy}=value;void _;
  const validated=HtmlNativeVmObservationSchema.safeParse({...legacy,schemaVersion:HTML_NATIVE_OBSERVATION_VERSION});
  if(!validated.success)for(const issue of validated.error.issues)ctx.addIssue({code:"custom",path:issue.path,message:issue.message});
});
export const HtmlNativeObservationSchema=z.discriminatedUnion("schemaVersion",[HtmlNativeVmObservationSchema,HtmlNativeLocalObservationSchema]);
export type HtmlNativeObservation=z.infer<typeof HtmlNativeObservationSchema>;

/** Server-only execution provenance; AI execute-result schemas intentionally do not accept this field. */
export const HtmlNativeRunProofSchema=z.object({
  sourceArtifactId:z.string().min(1),testCaseId:z.string().min(1),subjectSha256:sha,
  producer:z.literal("native-html-observer-v1"),observation:HtmlNativeObservationSchema,
}).strict();
export type HtmlNativeRunProof=z.infer<typeof HtmlNativeRunProofSchema>;

export const HtmlRenderedDocumentEvidenceSchema=z.object({
  schemaVersion:z.literal("rendered-html-document-v1"),sourceArtifactId:z.string().min(1),artifactSha256:sha,
  textFingerprint:z.string().min(1).max(100),
  text:z.string().min(1).max(64_000),paragraphs:z.array(HtmlRenderedParagraphFactsSchema).length(2),
  complete:z.literal(true),excludes:z.tuple([z.literal("scripts"),z.literal("styles"),z.literal("raw-attributes")]),
}).strict();

export const SandboxHtmlNativeRequestSchema=z.object({
  original:z.instanceof(Uint8Array).refine(bytes=>bytes.byteLength>0&&bytes.byteLength<=12_000_000),
  subject:z.instanceof(Uint8Array).refine(bytes=>bytes.byteLength>0&&bytes.byteLength<=12_000_000),
  expectedOriginalSha256:sha,expectedSubjectSha256:sha,
  browserAssertions:HtmlNativeBrowserAssertionsSchema.optional(),
}).strict();
export type SandboxHtmlNativeRequest=z.infer<typeof SandboxHtmlNativeRequestSchema>;

export const HTML_NATIVE_PAYMENT_REQUIRED="NATIVE_HTML_PAYMENT_REQUIRED";
export const HTML_NATIVE_LOCAL_UNAVAILABLE="NATIVE_HTML_LOCAL_EXECUTION_UNAVAILABLE";
export const SandboxHtmlNativeResponseSchema=z.discriminatedUnion("status",[
  z.object({status:z.literal("unavailable"),reason:z.string().min(1).max(500),reasonCode:z.literal("payment-required").optional()}).strict(),
  z.object({status:z.literal("observed"),observation:HtmlNativeObservationSchema,
    subjectText:z.string().min(1).max(64_000)}).strict(),
]);
export type SandboxHtmlNativeResponse=z.infer<typeof SandboxHtmlNativeResponseSchema>;
