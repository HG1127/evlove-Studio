export const HTML_PROTECTION_VISUAL_OBSERVATION_VERSION = "whole-native-paired-visual-observation-v1";
export const HTML_PROTECTION_VISUAL_OBSERVATION_INSTRUCTION = [
  "Observe the actual supplied Original/executed PNG pairs and their native DOM/style/layout scope.",
  "Return exactly one row for each supplied observationId, preserving both actual image hashes.",
  "Describe concrete visible rendering/retention or change within those exact regions, with bounded image coordinates.",
  "New or refined content may move later content in document flow; compare the supplied original component mapping and protected visual contract.",
  "Do not infer unseen offscreen regions, additional viewport widths, behavior, Safety, scope completeness or Gate F.",
  "Return unavailable if the image content cannot be inspected. Never replace image evidence with text or a PASS/high score.",
  "Retained requires concrete Original and executed regions. Changed requires observed differences and Original regions.",
].join(" ");
const region = { type: "object", additionalProperties: false, properties: { x: { type: "number", minimum: 0 }, y: { type: "number", minimum: 0 },
  width: { type: "number", exclusiveMinimum: 0 }, height: { type: "number", exclusiveMinimum: 0 } }, required: ["x", "y", "width", "height"] } as const;
export const htmlProtectionVisualObservationJsonSchema = { name: "htmlProtectionVisualObservations", schema: { type: "object", additionalProperties: false,
  properties: { schemaVersion: { type: "string", enum: ["html-protection-visual-observations-v1"] }, observations: { type: "array", minItems: 1, maxItems: 2,
    items: { type: "object", additionalProperties: false, properties: { observationId: { type: "string" }, originalImageSha256: { type: "string" },
      executedImageSha256: { type: "string" }, status: { type: "string", enum: ["retained", "changed", "unavailable"] },
      originalRegions: { type: "array", items: region }, executedRegions: { type: "array", items: region }, observedRendering: { type: "string" },
      differences: { type: "array", items: { type: "string" } } },
      required: ["observationId", "originalImageSha256", "executedImageSha256", "status", "originalRegions", "executedRegions", "observedRendering", "differences"] } } },
  required: ["schemaVersion", "observations"] } } as const;
