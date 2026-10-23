import {describe,expect,it} from "vitest";
import {describeArtifact} from "./artifact-strategy";
import type {SourceArtifact} from "@evolution/contracts";

function format(filename:string,mimeType="application/octet-stream",kind:SourceArtifact["artifactKind"]="generic"){
  const extension=filename.split(".").at(-1)??"";
  return describeArtifact({name:filename,extension,mimeType,artifactKind:kind,structure:[],structuredContent:undefined});
}
describe("format capability must match real native renderers",()=>{
  it("allows native structured DOCX/PPTX/XLSX, not invented format renderers",()=>{
    expect(format("report.docx").capabilities.materialize).toBe(true);
    expect(format("pitch.pptx").capabilities.materialize).toBe(true);
    expect(format("sales.xlsx").capabilities.materialize).toBe(true);
  });
  it("keeps old Office / OpenDocument / RTF read-only until a renderer exists",()=>{
    for(const name of ["legacy.doc","legacy.ppt","deck.odp","notes.odt","memo.rtf"]){
      const value=format(name);
      expect(value.capabilities.materialize,name).toBe(false);
      expect(value.editable,name).toBe(false);
      expect(value.preservationMode,name).toBe("external-required");
    }
  });
  it("does not claim PDF, raster images or media are editable without plugins",()=>{
    for(const [name,mime] of [
      ["report.pdf","application/pdf"],["scan.png","image/png"],["video.mp4","video/mp4"],["sound.wav","audio/wav"],
    ] as const){
      const value=format(name,mime);
      expect(value.capabilities.materialize,name).toBe(false);
      expect(value.capabilities.mutate,name).toBe(false);
    }
  });
  it("fails closed on unknown binary yet retains explicitly recognized text",()=>{
    const binary=format("mystery.bin");
    expect(binary.preservationMode).toBe("external-required");
    expect(binary.capabilities.materialize).toBe(false);
    for(const filename of ["settings.toml","config.ini","notes.log","schema.graphql","workflow.json","readme.txt"]){
      expect(format(filename,"text/plain").capabilities.materialize,filename).toBe(true);
    }
  });
});