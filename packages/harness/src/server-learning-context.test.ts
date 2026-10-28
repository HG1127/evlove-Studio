// @vitest-environment node
import {describe,expect,it,vi} from "vitest";
import {LessonDistillationContextSchema} from "@evolution/contracts";
import {htmlNativeEvidenceFixture,learningContextFixture,learningContextHash} from "@evolution/testkit";
import {evidenceFingerprint} from "@evolution/core";
import {buildServerLessonContext} from "./server-learning-context";
const ports=()=>({verifyFrozenSnapshot:vi.fn(async()=>true),fingerprintText:async(s:string)=>learningContextHash(s)});
const rebind=(x:ReturnType<typeof learningContextFixture>)=>{x.p.validationRun.evidenceFingerprint=evidenceFingerprint(x.p,x.current);};
describe("bounded lesson distillation context",()=>{
  it("keeps complete authorized body and source identity while excluding programs, raw state and every final field",async()=>{
    const x=learningContextFixture(),before=structuredClone(x.p),io=ports(),out=await buildServerLessonContext(x.p,io),wire=JSON.stringify(out);
    expect(out.sourceArtifacts[0]).toMatchObject({binding:"baseline-original-text",representation:"html-body-text",complete:true});
    expect(out.sourceArtifacts[0]!.content).toContain("Original complete body");
    expect(out.candidateArtifacts[0]).toMatchObject({snapshotId:x.current.artifactSnapshots[0]!.id,sha256:x.current.artifactSnapshots[0]!.frozenArtifact!.sha256,binding:"frozen-snapshot",complete:true});
    expect(out.candidateArtifacts[0]!.content).toContain("Current complete body");expect(wire).toContain("const displayed = 1;");
    expect(wire).not.toMatch(/PRIVATE_.*SENTINEL/);expect(wire).not.toMatch(/"(?:independentFinal|artifactSnapshots|frozenArtifact|patches)"/);
    expect(out.validation.id).toBe(x.p.validationRun.id);expect(out.validation.evaluation).toEqual(x.p.validationRun.evaluation);
    expect(x.p).toEqual(before);expect(io.verifyFrozenSnapshot).toHaveBeenCalledOnce();
    expect(()=>LessonDistillationContextSchema.parse({...out,winner:x.current})).toThrow();
    expect(()=>LessonDistillationContextSchema.parse({...out,validation:x.p.validationRun})).toThrow();
  });
  it.each(["unreadable","changed-hash","missing-body","duplicate-source","not-accepted","wrong-validation"])("blocks %s before a provider call can be composed",async kind=>{
    const x=learningContextFixture(),io=ports();
    if(kind==="unreadable")io.verifyFrozenSnapshot.mockResolvedValue(false);
    if(kind==="changed-hash")x.current.artifactSnapshots[0]!.content+="changed";
    if(kind==="missing-body"){const s=x.current.artifactSnapshots[0]!;s.content="<p>not a complete physical HTML body</p>";s.contentHash=learningContextHash(s.content);s.frozenArtifact!.snapshotHash=s.contentHash;}
    if(kind==="duplicate-source")x.current.artifactSnapshots.push({...x.current.artifactSnapshots[0]!,id:"duplicate"});
    if(kind==="not-accepted")x.p.artifactAcceptance.status="failed";
    if(kind==="wrong-validation")x.p.validationRun.evidenceFingerprint="foreign";
    if(kind==="missing-body")rebind(x);
    await expect(buildServerLessonContext(x.p,io)).rejects.toThrow();
  });
  it("marks a stale source index unbound and a large text projection incomplete instead of claiming full file evidence",async()=>{
    const x=learningContextFixture();x.p.sourceArtifacts[0]!.textContent=x.p.sourceArtifacts[0]!.textContent!.replace("Original","Stale");
    const s=x.current.artifactSnapshots[0]!;s.content="<html><body><p>"+"complete text ".repeat(10000)+"</p></body></html>";s.contentHash=learningContextHash(s.content);s.frozenArtifact!.snapshotHash=s.contentHash;
    rebind(x);
    const out=await buildServerLessonContext(x.p,ports());expect(out.sourceArtifacts[0]!.binding).toBe("parsed-source");expect(out.sourceArtifacts[0]!.sha256).toBeUndefined();
    expect(out.candidateArtifacts[0]!.complete).toBe(false);expect(out.candidateArtifacts[0]!.availableChars).toBeGreaterThan(out.candidateArtifacts[0]!.content.length);
  });
  it("does not fall back to raw HTML when the parsed Original index lacks physical body boundaries",async()=>{
    const x=learningContextFixture();x.p.sourceArtifacts[0]!.textContent="<script>PRIVATE_UNBOUND_SOURCE_SENTINEL</script>";rebind(x);
    const out=await buildServerLessonContext(x.p,ports());expect(out.sourceArtifacts[0]).toMatchObject({content:"",complete:false,binding:"parsed-source"});
    expect(JSON.stringify(out)).not.toContain("PRIVATE_UNBOUND_SOURCE_SENTINEL");
  });
  it.each(["txt","md","json","docx","pptx","xlsx","csv","zip"])("preserves accepted %s snapshot representations without treating them as HTML",async extension=>{
    const x=learningContextFixture(),s=x.current.artifactSnapshots[0]!,artifact=x.p.sourceArtifacts[0]!;
    artifact.extension=extension;artifact.mimeType="application/octet-stream";artifact.textContent="original native parsed context";
    s.mimeType="application/octet-stream";s.content=extension==="zip"?' {"kind":"codebase","files":[{"path":"app.ts","content":"export const value = 2"}]}':'{"native":"actual tested delta"}';
    s.contentHash=learningContextHash(s.content);s.frozenArtifact!.snapshotHash=s.contentHash;
    rebind(x);
    const out=await buildServerLessonContext(x.p,ports());expect(out.candidateArtifacts[0]!.representation).toBe("snapshot-text");expect(out.candidateArtifacts[0]!.content).toBe(s.content);
  });
  it("forwards only complete native observations bound to the accepted source and ordinary paper",async()=>{
    const x=learningContextFixture(),run=htmlNativeEvidenceFixture(),s=x.current.artifactSnapshots[0]!,ref=x.p.baselineRun.originalReferences![0]!;
    run.testCaseId="H1";run.artifactHash=s.frozenArtifact!.sha256;run.nativeHtmlProof!.testCaseId="H1";run.nativeHtmlProof!.sourceArtifactId="source";run.nativeHtmlProof!.subjectSha256=run.artifactHash;
    run.nativeHtmlProof!.observation.subject.sha256=run.artifactHash;run.nativeHtmlProof!.observation.original.sha256=ref.sha256;
    run.renderedDocumentEvidence!.sourceArtifactId="source";run.renderedDocumentEvidence!.artifactSha256=run.artifactHash;x.p.validationRun.runs=[run];
    const good=await buildServerLessonContext(x.p,ports());expect(good.measuredDocuments.observations[0]!.output).toContain("Synthetic readable document");
    expect(good.measuredDocuments.nativeSummaries[0]).toMatchObject({sourceArtifactId:"source",subjectSha256:run.artifactHash,profilePass:true});
    run.nativeHtmlProof!.sourceArtifactId="foreign";
    const bad=await buildServerLessonContext(x.p,ports());expect(bad.measuredDocuments.observations).toEqual([]);expect(bad.measuredDocuments.nativeSummaries).toEqual([]);
  });
});
