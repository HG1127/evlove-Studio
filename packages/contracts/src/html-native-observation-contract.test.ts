import {describe,expect,it} from "vitest";
import {htmlNativeEvidenceFixture} from "@evolution/testkit";
import {ExecuteArtifactAiResultSchema,ExecuteArtifactBatchAiResultSchema} from "./ai-schemas";

describe("native observation trust boundary",()=>{
  it("does not accept server-only native or rendered-document proof from a single AI execute response",()=>{
    const {nativeHtmlProof,renderedDocumentEvidence}=htmlNativeEvidenceFixture();
    const result=ExecuteArtifactAiResultSchema.parse({output:"Model claim",nativeHtmlProof,renderedDocumentEvidence});
    expect(result).not.toHaveProperty("nativeHtmlProof");expect(result).not.toHaveProperty("renderedDocumentEvidence");
  });
  it("does not accept server-only proof from an AI batch row",()=>{
    const {nativeHtmlProof,renderedDocumentEvidence}=htmlNativeEvidenceFixture();
    const result=ExecuteArtifactBatchAiResultSchema.parse({results:[{testCaseId:"native-case",output:"Model claim",nativeHtmlProof,renderedDocumentEvidence}]});
    expect(result.results[0]).not.toHaveProperty("nativeHtmlProof");expect(result.results[0]).not.toHaveProperty("renderedDocumentEvidence");
  });
});
