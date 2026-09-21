import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ProductionRuntimePorts } from "@evolution/contracts";
import { configureProductionRuntime, resetProductionRuntime } from "./production-runtime";
import {
  getVisualEvidence,
  hydrateVisualEvidence,
  visualEvidenceManifestArtifactId,
  visualEvidenceScreenshotArtifactId,
} from "./visual-evidence";

const artifacts = new Map<string, Blob>();
const runtime: ProductionRuntimePorts = {
  missions:{initialize:async()=>{},list:async()=>[],get:async()=>undefined,save:async()=>{},delete:async()=>{},flush:async()=>{}},
  jobs:{list:async()=>[],get:async()=>undefined,put:async()=>{},cancel:async()=>{}},
  events:{append:async()=>{},list:async()=>[]},
  artifacts:{
    put:async(id,blob)=>{artifacts.set(id,blob);},
    get:async(id)=>artifacts.get(id),
    delete:async(id)=>{artifacts.delete(id);},
  },
};

beforeEach(()=>{
  localStorage.clear();
  artifacts.clear();
  configureProductionRuntime(runtime,"http");
  vi.stubGlobal("indexedDB",undefined);
});

afterEach(()=>{
  resetProductionRuntime();
  vi.unstubAllGlobals();
});

describe("durable visual evidence",()=>{
  it("hydrates a screenshot manifest from Artifact Store into the browser projection",async()=>{
    const projectId="visual-remote";
    const itemId="shot-1";
    const blobId=visualEvidenceScreenshotArtifactId(projectId,itemId);
    artifacts.set(blobId,new Blob(["image-bytes"],{type:"image/png"}));
    artifacts.set(visualEvidenceManifestArtifactId(projectId),new Blob([JSON.stringify({
      version:1,
      savedAt:"2026-09-21T00:00:00.000Z",
      items:[{id:itemId,name:"screen.png",addedAt:"2026-09-21T00:00:00.000Z",artifactHash:"abc",blobId}],
    })],{type:"application/json"}));

    const restored=await hydrateVisualEvidence(projectId);
    expect(restored.items).toHaveLength(1);
    expect(restored.items[0]?.artifactHash).toBe("abc");
    expect(restored.items[0]?.dataUrl).toMatch(/^data:image\/png;base64,/);
    expect(getVisualEvidence(projectId).items[0]?.id).toBe(itemId);
  });

  it("migrates a legacy localStorage screenshot into Artifact Store without embedding dataUrl in the manifest",async()=>{
    const projectId="visual-legacy";
    localStorage.setItem(`evolve-studio:visual-evidence:${projectId}`,JSON.stringify({
      items:[{id:"shot-local",name:"legacy.png",addedAt:"2026-09-21T00:00:00.000Z",dataUrl:"data:image/png;base64,aGVsbG8=",artifactHash:"legacy-hash"}],
    }));

    await hydrateVisualEvidence(projectId);
    expect(artifacts.has(visualEvidenceScreenshotArtifactId(projectId,"shot-local"))).toBe(true);
    const manifest=artifacts.get(visualEvidenceManifestArtifactId(projectId));
    expect(manifest).toBeDefined();
    const text=await manifest!.text();
    expect(text).toContain("legacy-hash");
    expect(text).not.toContain("data:image/png");
  });
});
