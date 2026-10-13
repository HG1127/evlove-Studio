import { createHash } from "node:crypto";
import { decodeArtifactUtf8 } from "@evolution/adapters";
import {
  AcceptanceCriterionSchema, CandidateSchema, HtmlProtectionProofBindingSchema,
  SourceArtifactSchema, TestCaseSchema,
  type Candidate, type EvolveProject, type HtmlProtectionProofBinding, type SourceArtifact, type TestCase,
} from "@evolution/contracts";
import { hasSourceTextArtifactFileFormat } from "@evolution/core";
import { trustedServerBaselineChampion } from "@evolution/harness";
import { getServerArtifactStore } from "./artifact-runtime";

export type ServerHtmlProtectionInputPorts = { getArtifact(id: string): Promise<Blob | undefined> };
export type ServerHtmlProtectionInputs = {
  binding: HtmlProtectionProofBinding;
  originalHtml: string;
  executedHtml: string;
};
const MAX_BYTES = 25_000_000;
const sha = (bytes: Uint8Array | string) => createHash("sha256").update(bytes).digest("hex");

function canonical(value: unknown): string {
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  if (value !== null && typeof value === "object") return "{" + Object.entries(value)
    .filter(([, item]) => item !== undefined).sort(([a], [b]) => a.localeCompare(b))
    .map(([key, item]) => JSON.stringify(key) + ":" + canonical(item)).join(",") + "}";
  return JSON.stringify(value);
}
function decode(bytes: Uint8Array): string {
  if (!bytes.length || bytes.length > MAX_BYTES) throw new Error("HTML protection file is empty or exceeds the byte budget");
  const html = decodeArtifactUtf8(bytes);
  if (sha(html) !== sha(bytes)) throw new Error("HTML protection file cannot be restored as exact UTF-8");
  return html;
}
async function readOriginal(source: SourceArtifact, ports: ServerHtmlProtectionInputPorts) {
  if (source.inputMode === "paste" && !source.storageRef?.trim()) {
    if (source.textContent === undefined) throw new Error("Complete original pasted HTML is unavailable");
    const bytes = new TextEncoder().encode(source.textContent);
    if (source.size > 0 && bytes.length !== source.size) throw new Error("Original pasted HTML size differs from Source");
    return { bytes, html: decode(bytes) };
  }
  const blob = await ports.getArtifact(source.storageRef?.trim() || source.id);
  if (!blob || blob.size !== source.size || blob.size <= 0 || blob.size > MAX_BYTES) {
    throw new Error("Original physical HTML is missing or its size differs from Source");
  }
  const bytes = new Uint8Array(await blob.arrayBuffer());
  if (bytes.length !== blob.size) throw new Error("Original HTML read length changed");
  return { bytes, html: decode(bytes) };
}
async function readFrozen(source: SourceArtifact, raw: Candidate, ports: ServerHtmlProtectionInputPorts) {
  const candidate = CandidateSchema.parse(raw);
  const snapshots = candidate.artifactSnapshots.filter(item => item.sourceArtifactId === source.id);
  if (snapshots.length !== 1) throw new Error("Protection subject has no unique HTML snapshot");
  const snapshot = snapshots[0]!, frozen = snapshot.frozenArtifact;
  const snapshotHash = sha(snapshot.content);
  if (!frozen || frozen.sourceArtifactId !== source.id || frozen.snapshotHash !== snapshotHash
    || (snapshot.contentHash !== undefined && snapshot.contentHash !== snapshotHash)
    || frozen.name !== snapshot.name || frozen.mimeType !== snapshot.mimeType
    || !hasSourceTextArtifactFileFormat(source, snapshot.name)) {
    throw new Error("Protection frozen receipt differs from the exact original-format snapshot");
  }
  const blob = await ports.getArtifact(frozen.blobId);
  if (!blob || blob.size !== frozen.size || blob.size <= 0 || blob.size > MAX_BYTES) throw new Error("Protection frozen file is unavailable");
  const bytes = new Uint8Array(await blob.arrayBuffer());
  if (bytes.length !== frozen.size || sha(bytes) !== frozen.sha256) throw new Error("Protection frozen bytes differ from the receipt");
  const html = decode(bytes);
  if (html !== snapshot.content) throw new Error("Protection frozen file differs from snapshot content");
  return { bytes, html };
}

/**
 * Pin actual original/current/frozen files for one unchanged stored paper.
 * This collects inputs only: no script execution, observation or acceptance is implied.
 */
export async function readServerHtmlProtectionInputs(args: {
  project: EvolveProject; testCase: TestCase; criterionId: string; candidate?: Candidate;
  ports?: ServerHtmlProtectionInputPorts;
}): Promise<ServerHtmlProtectionInputs> {
  const { project } = args;
  const testCase = TestCaseSchema.parse(args.testCase);
  const paper = (testCase.hidden ? project.hiddenEvalSuite : project.evalSuite).map(item => TestCaseSchema.parse(item));
  const tests = paper.filter(item => item.id === testCase.id);
  if (new Set(paper.map(item => item.id)).size !== paper.length || tests.length !== 1
    || canonical(tests[0]) !== canonical(testCase)) throw new Error("Protection test is not the exact unique stored paper case");
  const rubric = project.acceptanceRubric.map(item => AcceptanceCriterionSchema.parse(item));
  const criteria = rubric.filter(item => item.id === args.criterionId);
  if (new Set(rubric.map(item => item.id)).size !== rubric.length || criteria.length !== 1
    || !testCase.criterionIds.includes(args.criterionId)) throw new Error("Protection criterion identity is ambiguous or unmapped");
  const criterion = criteria[0]!;
  if (!criterion.protectedConstraint || !criterion.hardGate) throw new Error("Protection proof requires a protected hard criterion");
  const sources = project.sourceArtifacts.map(item => SourceArtifactSchema.parse(item));
  if (new Set(sources.map(item => item.id)).size !== sources.length) throw new Error("Protection Source identities are duplicated");
  const scoped = new Set(criterion.artifactIds);
  if (scoped.size !== criterion.artifactIds.length || [...scoped].some(id => !sources.some(item => item.id === id && item.role === "target"))) {
    throw new Error("Protection artifact scope is duplicated or foreign");
  }
  const targets = sources.filter(item => item.role === "target" && (!scoped.size || scoped.has(item.id)));
  if (targets.length !== 1 || !/^(html|htm)$/i.test(targets[0]!.extension)
    || ["codebase", "package"].includes(targets[0]!.artifactDescriptor?.family ?? "") || targets[0]!.artifactKind === "codebase") {
    throw new Error("Protection paper requires one standalone HTML Target");
  }
  const source = targets[0]!;
  if (args.candidate && project.candidates.filter(item => item.id === args.candidate!.id).length !== 1) {
    throw new Error("Protection Candidate is not a unique Mission subject");
  }
  const champion = trustedServerBaselineChampion(project);
  if (!args.candidate && project.searchChampion && !champion) throw new Error("Current protection subject has no trusted Champion");
  const subjectCandidate = args.candidate ?? champion;
  const ports = args.ports ?? { getArtifact: (id: string) => getServerArtifactStore().get(id) };
  const original = await readOriginal(source, ports);
  const executed = subjectCandidate ? await readFrozen(source, subjectCandidate, ports) : original;
  const binding = HtmlProtectionProofBindingSchema.parse({
    missionId: project.id, testCaseId: testCase.id, criterionId: criterion.id,
    paperSha256: sha(canonical({ version: "html-protection-paper-v1", paper, rubric, protectedItems: project.protectedItems })),
    original: { sourceArtifactId: source.id, sha256: sha(original.bytes), byteLength: original.bytes.length },
    executed: { sourceArtifactId: source.id, sha256: sha(executed.bytes), byteLength: executed.bytes.length },
    subject: args.candidate ? { kind: "candidate", candidateId: args.candidate.id }
      : { kind: "current", versionId: champion?.id ?? project.version },
  });
  return { binding, originalHtml: original.html, executedHtml: executed.html };
}
