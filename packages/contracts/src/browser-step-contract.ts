import { z } from "zod";

const selector = z.string().min(1).max(500).refine(value => value.trim().length > 0, "Browser selector must not be blank");
const literal = z.string().max(65_536);
const finite = z.number().finite().min(-10_000_000).max(10_000_000);
const range = { min: finite, max: finite };
const ordered = (value: { min: number; max: number }) => value.min <= value.max;
const rangeMessage = "Browser observation range must have min <= max";

// These five persisted actions retain their existing field shape and meaning.
const LegacyBrowserStepSchema = z.object({
  action: z.enum(["click", "fill", "visible", "text", "count"]),
  selector,
  value: literal.optional(),
  count: z.number().int().nonnegative().optional(),
}).strict();
const ScrollIntoViewSchema = z.object({ action: z.literal("scroll-into-view"), selector }).strict();
const InViewportSchema = z.object({
  action: z.literal("in-viewport"), selector,
  ratio: z.number().min(0).max(1).default(0), expected: z.boolean().default(true),
}).strict();
export const BROWSER_READABLE_ATTRIBUTE_NAMES = [
  "class", "id", "style", "checked", "disabled", "hidden", "open", "href", "aria-expanded", "aria-checked",
  "aria-valuenow", "aria-valuemin", "aria-valuemax", "aria-hidden", "data-progress", "data-state",
] as const;
const AttributeSchema = z.object({
  action: z.literal("attribute"), selector,
  name: z.string().max(64).refine(value => (BROWSER_READABLE_ATTRIBUTE_NAMES as readonly string[]).includes(value)
    || /^data-[a-z0-9-]+$/.test(value), "Unsupported readable browser attribute"),
  value: literal, mode: z.enum(["equals", "contains"]).default("equals"),
}).strict();
const CheckedSchema = z.object({ action: z.literal("checked"), selector, checked: z.boolean() }).strict();
const ScrollPositionSchema = z.object({
  action: z.literal("scroll-position"), selector: z.literal("html"),
  axis: z.enum(["x", "y"]).default("y"), ...range,
}).strict().refine(ordered, rangeMessage);
const CssPropertySchema = z.enum(["opacity", "transform", "width", "display", "visibility"]);
const CssLiteralSchema = z.object({
  action: z.literal("computed-style"), selector, property: CssPropertySchema,
  mode: z.literal("literal"), value: z.string().min(1).max(512),
}).strict().refine(step => step.property !== "opacity"
  || /^(?:0(?:\.\d+)?|1(?:\.0+)?)$/.test(step.value), "Literal opacity must be a number from 0 to 1");
const CssRangeSchema = z.object({
  action: z.literal("computed-style"), selector, property: z.enum(["opacity", "width"]),
  mode: z.literal("numeric-range"), ...range,
}).strict().refine(ordered, rangeMessage).refine(step => step.min >= 0
  && (step.property !== "opacity" || step.max <= 1), "CSS ranges must be nonnegative; opacity is at most 1");
const CssIdentitySchema = z.object({
  action: z.literal("computed-style"), selector, property: z.literal("transform"),
  mode: z.literal("identity-transform"), tolerance: z.number().min(0).max(0.1).default(0.01),
}).strict();
const CssRelativeSchema = z.object({
  action: z.literal("computed-style"), selector, property: z.literal("width"),
  mode: z.literal("parent-relative"), relativeTo: selector,
  min: z.number().min(0).max(1), max: z.number().min(0).max(1),
}).strict().refine(ordered, rangeMessage);
const CopyTextSchema = z.object({ action: z.literal("copy-text"), selector, value: literal }).strict();

/** Closed typed operations. No supplied JS, evaluate, callbacks or regex fields. */
const BrowserStepUnionSchema = z.union([
  LegacyBrowserStepSchema, ScrollIntoViewSchema, InViewportSchema, AttributeSchema,
  CheckedSchema, ScrollPositionSchema, CssLiteralSchema, CssRangeSchema, CssIdentitySchema,
  CssRelativeSchema, CopyTextSchema,
]);
// Keep legacy readers of optional value/count source-compatible without adding any
// fields to parsed JSON or accepting those fields on unrelated typed operations.
export const BrowserStepSchema = BrowserStepUnionSchema.transform(step =>
  step as z.infer<typeof BrowserStepUnionSchema> & { value?: string; count?: number });
export type BrowserStep = z.infer<typeof BrowserStepSchema>;
export const BROWSER_ASSERTION_ACTIONS = [
  "visible", "text", "count", "in-viewport", "attribute", "checked",
  "scroll-position", "computed-style", "copy-text",
] as const;
export function browserStepHasAssertion(step: Pick<BrowserStep, "action">): boolean {
  return (BROWSER_ASSERTION_ACTIONS as readonly string[]).includes(step.action);
}
