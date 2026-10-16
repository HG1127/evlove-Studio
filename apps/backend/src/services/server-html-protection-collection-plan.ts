import { createHash } from "node:crypto";
import { CandidateSchema, HtmlProtectionSearchStateRegistrationSchema, HtmlProtectionSearchStateRequestSchema, HtmlProtectionSnapshotRequestSchema, type Candidate, type EvolveProject, type TestCase } from "@evolution/contracts";
import { confirmedHtmlProtectionOperationalScope, htmlProtectionInventory, htmlProtectionObligationPlan, htmlProtectionOriginalRuntimePlan, htmlProtectionOriginalSearchCountFormat } from "@evolution/core";
import { HTML_PROTECTION_CLOUD_URL } from "@evolution/adapters/sandbox";
import { readServerHtmlProtectionInputs, type ServerHtmlProtectionInputPorts } from "./server-html-protection-input";

export const SERVER_HTML_PROTECTION_COLLECTION_POLICY = "html-protection-collection-plan-v2-original-search-facts";
function canonical(value: unknown): string {
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  if (value !== null && typeof value === "object") return "{" + Object.entries(value)
    .filter(([, item]) => item !== undefined).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
    .map(([key, item]) => JSON.stringify(key) + ":" + canonical(item)).join(",") + "}";
  return JSON.stringify(value);
}
const sha = (value: unknown) => createHash("sha256").update(canonical(value)).digest("hex");

/** Internal app preparation only: full actual Original + exact stored paper, never Candidate-derived registration. */
export async function prepareServerHtmlProtectionCollectionPlan(args: {
  project: EvolveProject;
  testCase: TestCase;
  criterionId: string;
  candidate?: Candidate;
  execution: { executionId: string; jobId: string; generation: number };
  ports?: ServerHtmlProtectionInputPorts;
}) {
  // Freeze caller state before storage awaits. These are controller ports, not HTTP/AI input.
  const project = structuredClone(args.project), testCase = structuredClone(args.testCase);
  const criterionId = args.criterionId;
  const execution = HtmlProtectionSnapshotRequestSchema.shape.execution.parse(args.execution);
  const candidate = args.candidate ? CandidateSchema.parse(structuredClone(args.candidate)) : undefined;
  const ports = args.ports ? { getArtifact: args.ports.getArtifact.bind(args.ports) } : undefined;
  if (candidate) {
    const stored = project.candidates.filter(item => item.id === candidate.id);
    if (stored.length !== 1 || canonical(CandidateSchema.parse(stored[0])) !== canonical(candidate)) {
      throw Error("Collection Candidate differs from the unique stored Mission subject");
    }
  }
  const inputs = await readServerHtmlProtectionInputs({ project, testCase, criterionId, candidate, ports });
  const original = inputs.binding.original;
  const operationalScope = confirmedHtmlProtectionOperationalScope(project, original);
  const inventory = htmlProtectionInventory({ sourceArtifactId: original.sourceArtifactId, html: inputs.originalHtml });
  const runtimePlan = htmlProtectionOriginalRuntimePlan({ sourceArtifactId: original.sourceArtifactId, originalSha256: original.sha256, html: inputs.originalHtml });
  const searchCountFormat = htmlProtectionOriginalSearchCountFormat({ sourceArtifactId: original.sourceArtifactId, originalSha256: original.sha256, html: inputs.originalHtml });
  const obligationPlan = htmlProtectionObligationPlan({ originalInventory: inventory, runtimeProfile: runtimePlan.runtimeProfile,
    frozenContentContract: { protectionCriterionId: criterionId, rubric: project.acceptanceRubric, ...(operationalScope ? { operationalScope } : {}) } });
  const planSha256 = sha({ policyVersion: SERVER_HTML_PROTECTION_COLLECTION_POLICY,
    paperSha256: inputs.binding.paperSha256, criterionId, original, obligationPlan, runtimePlan, searchCountFormat });
  const searchRegistry = runtimePlan.search.registry;
  const searchInput = runtimePlan.census.controls.find(control => control.id === "search");
  const searchStates = runtimePlan.search.states;
  const searchRegistration = searchRegistry?.projection === "search-membership-v1" && searchInput && searchStates.length === 4
    ? HtmlProtectionSearchStateRegistrationSchema.parse({
      schemaVersion: "html-protection-search-state-registration-v1", original,
      policyVersion: SERVER_HTML_PROTECTION_COLLECTION_POLICY, planSha256, registrySha256: sha(searchRegistry), registry: searchRegistry,
      input: { id: "search", tag: "INPUT", namespace: "http://www.w3.org/1999/xhtml",
        type: searchInput.attributes.find(item => item.name === "type")?.value ?? "text", initialValue: searchStates[0]!.inputValue },
      states: searchStates.map(state => state.stateIntent === "boot" ? { stateKind: state.stateIntent, stateId: state.stateId }
        : { stateKind: state.stateIntent, stateId: state.stateId, value: state.inputValue }),
    }) : null;
  const searchRequests = searchRegistration ? (["original", "executed"] as const).flatMap(sourceRole =>
    searchRegistration.states.map(state => HtmlProtectionSearchStateRequestSchema.parse({
      schemaVersion: "html-protection-search-state-request-v1", binding: inputs.binding, sourceRole,
      policyVersion: SERVER_HTML_PROTECTION_COLLECTION_POLICY, planSha256, registrySha256: searchRegistration.registrySha256,
      execution, batchId: "original-search-catalog", stateId: state.stateId, stateKind: state.stateKind,
    }))) : [];
  const bootRequests = runtimePlan.bootBatches.flatMap(batch => (["original", "executed"] as const).map(sourceRole =>
    HtmlProtectionSnapshotRequestSchema.parse({ schemaVersion: "html-protection-snapshot-request-v1",
      binding: inputs.binding, sourceRole, documentUrl: HTML_PROTECTION_CLOUD_URL,
      policyVersion: SERVER_HTML_PROTECTION_COLLECTION_POLICY, planSha256,
      registrySha256: sha(batch.registry), registry: batch.registry, execution,
      stateId: batch.stateId, batchId: batch.batchId })));
  return {
    schemaVersion: "server-html-protection-collection-plan-v1" as const,
    binding: inputs.binding, planSha256, obligationPlan, operationalScope, runtimePlan, bootRequests,
    searchRegistration, searchRequests, searchCountFormat, searchRequiresStatefulExecution: true as const,
    // Full private physical inputs stay inside the app collector; no public route returns this material.
    physicalInputs: { original: Buffer.from(inputs.originalHtml, "utf8"), executed: Buffer.from(inputs.executedHtml, "utf8") },
    limitations: ["Preparation is not observation, signing or acceptance.",
      "Search query/clear, copy, semantic/visual and coarse runtime residual execution are still required.",
      "Caller execution IDs must come from the real Workflow owner; request schemas do not authenticate that owner."],
  };
}
