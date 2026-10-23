import { describe, expect, it } from "vitest";
import { CandidateSchema, ExperimentPolicySchema, type SourceArtifact } from "../schemas";
import { buildCandidateDeterministically } from "./candidate-builder";

describe("V2.8 candidate fast paths", () => {
  it("builds a deterministic ZIP overlay when a code patch targets an existing file", () => {
    const artifact = {
      id: "zip-1",
      name: "system.zip",
      role: "target",
      mimeType: "application/zip",
      size: 1024,
      extension: "zip",
      inputMode: "upload",
      parseStatus: "ready",
      artifactKind: "codebase",
      artifactDescriptor: { subtype: "zip", adapterId: "codebase-zip-repository", confidence: 0.98, preservationMode: "same-package" as const, fidelity: "high" as const, formatExtension: "zip", editable: true, capabilities: { parse: true, mutate: true, materialize: true, validateStructure: true, execute: true, visual: false }, evolutionDimensions: [], requiredValidations: [], limitations: [] },
      structure: ["src/app.ts", "src/runtime.ts"],
      structuredContent: { kind: "codebase", manifest: ["src/app.ts", "src/runtime.ts"] },
      createdAt: new Date().toISOString(),
    } as unknown as SourceArtifact;
    const candidate = CandidateSchema.parse({
      id: "C-fast",
      name: "runtime fast patch",
      change: "replace runtime implementation",
      patches: [{ id: "p1", component: "code", operation: "update", target: "src/runtime.ts", artifactId: "zip-1", content: "export function runtime(){ return 'fast'; }", rationale: "exact file replacement" }],
    });
    const built = buildCandidateDeterministically(candidate, [artifact]);
    expect(built).toBeTruthy();
    expect(built?.snapshots[0]?.buildMode).toBe("deterministic");
    const overlay = JSON.parse(built?.snapshots[0]?.content ?? "{}") as { overlay?: boolean; files?: Array<{ path: string; content: string }> };
    expect(overlay.overlay).toBe(true);
    expect(overlay.files?.[0]?.path).toBe("src/runtime.ts");
    expect(overlay.files?.[0]?.content).toContain("return 'fast'");
  });

  it("defaults experiments to adaptive successive-halving mode", () => {
    const policy = ExperimentPolicySchema.parse({});
    expect(policy.mode).toBe("adaptive");
    expect(policy.finalistCount).toBe(2);
    expect(policy.screeningCaseCount).toBe(2);
    expect(policy.batchSize).toBe(5);
    expect(policy.batchArtifactRuntime).toBe(true);
  });
  it("treats an HTML ID target as an element even when navigation links contain it",()=>{
    const source='<html><body><a href="#slide-15">Jump</a><article id="slide-15">Original<div>nested</div></article><footer>Keep</footer></body></html>';
    const artifact={id:"html",name:"sop.html",extension:"html",mimeType:"text/html",artifactKind:"document",textContent:source} as SourceArtifact;
    const candidate=CandidateSchema.parse({id:"C-id",name:"Clear steps",change:"Clarify",patches:[{id:"p",component:"prompt",operation:"update",target:"#slide-15",content:'<!-- plan --><article id="slide-15">Clear<div>nested</div></article>',rationale:"Element target"}]});
    const built=buildCandidateDeterministically(candidate,[artifact]);
    expect(built?.snapshots[0]?.content).toContain('<a href="#slide-15">Jump</a>');
    expect(built?.snapshots[0]?.content).toContain('<article id="slide-15">Clear<div>nested</div></article>');
  });

});
