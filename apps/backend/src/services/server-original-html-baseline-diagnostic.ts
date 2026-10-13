import { EvolveProjectSchema, TestCaseSchema, type EvolveProject, type TestCase } from "@evolution/contracts";
import { OriginalHtmlBaselineDiagnosticBindingSchema, originalHtmlBaselineDiagnosticCase } from "@evolution/core";
import { readServerHtmlProtectionInputs, type ServerHtmlProtectionInputPorts } from "./server-html-protection-input";
import { serverHtmlArtifactTargetEnabled } from "./server-html-artifact-execution";

const ScopeSchema = EvolveProjectSchema.pick({ id: true, version: true, sourceArtifacts: true,
  acceptanceRubric: true, protectedItems: true, evalSuite: true, hiddenEvalSuite: true,
  campaign: true, searchChampion: true, candidates: true, targetConnection: true }).strict();
function scope(project: EvolveProject) {
  return ScopeSchema.parse({ id: project.id, version: project.version, sourceArtifacts: project.sourceArtifacts,
    acceptanceRubric: project.acceptanceRubric, protectedItems: project.protectedItems,
    evalSuite: project.evalSuite, hiddenEvalSuite: project.hiddenEvalSuite, campaign: project.campaign,
    searchChampion: project.searchChampion, candidates: project.candidates, targetConnection: project.targetConnection });
}
const equal = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right);

/**
 * Server-owned fresh file port. Not exported as a route or supplied by a model/client.
 * Two actual Blob/UTF8 reads bind the unchanged visible paper and current Source arm.
 * It proves only this observed physical file identity, not whole preservation, startup
 * custody, functional safety, or the immutability of an earlier upload without a receipt.
 */
export async function readServerOriginalHtmlBaselineDiagnosticBinding(args: {
  project: EvolveProject;
  testCase: TestCase;
  ports?: ServerHtmlProtectionInputPorts;
}) {
  if (Object.keys(args).some(key => !["project", "testCase", "ports"].includes(key))) throw Error("Invalid internal diagnostic port input");
  const wire = structuredClone(args.project), parsed = scope(wire);
  Object.assign(wire, parsed);
  const testCase = TestCaseSchema.parse(structuredClone(args.testCase));
  const selected = originalHtmlBaselineDiagnosticCase(wire);
  if (!selected || testCase.hidden || !equal(selected, testCase) || !serverHtmlArtifactTargetEnabled(wire)) {
    throw Error("Initial standalone HTML diagnostic binding is unavailable");
  }
  const ports = args.ports ? { getArtifact: args.ports.getArtifact.bind(args.ports) } : undefined;
  const first = await readServerHtmlProtectionInputs({ project: wire, testCase, criterionId: "SYS-INTEGRITY", ports });
  const second = await readServerHtmlProtectionInputs({ project: wire, testCase, criterionId: "SYS-INTEGRITY", ports });
  if (!equal(first.binding, second.binding) || first.originalHtml !== first.executedHtml
    || second.originalHtml !== second.executedHtml || first.originalHtml !== second.originalHtml
    || !equal(scope(args.project), parsed) || !equal(TestCaseSchema.parse(args.testCase), testCase)) {
    throw Error("Initial HTML diagnostic physical input or paper changed during readback");
  }
  return OriginalHtmlBaselineDiagnosticBindingSchema.parse({
    schemaVersion: "original-html-baseline-diagnostic-binding-v1", binding: second.binding,
  });
}
