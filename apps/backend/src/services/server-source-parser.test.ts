import {describe,expect,it} from "vitest";
import JSZip from "jszip";
import {parseServerSource,SERVER_SOURCE_PARSE_EXTENSIONS} from "./server-source-parser";

function parse(name:string,mimeType:string,bytes:Uint8Array){
  return parseServerSource({
    artifactId:"artifact-test",
    name,
    mimeType,
    size:bytes.byteLength,
    role:"target",
    blob:new Blob([Uint8Array.from(bytes).buffer],{type:mimeType}),
    storageRef:"artifact-test",
  });
}

describe("server source parser",()=>{
  it("parses server-native JSON and preserves structured value",async()=>{
    const bytes=new TextEncoder().encode('{"goal":"truthful backend","count":2}');
    const artifact=await parse("input.json","application/json",bytes);
    expect(artifact.parseStatus).toBe("ready");
    expect(artifact.textContent).toContain("truthful backend");
    expect(artifact.structuredContent).toMatchObject({kind:"json",value:{count:2}});
    expect(artifact.parsingProfile?.engine).toBe("server-native");
  });

  it("parses RTF without pretending style fidelity",async()=>{
    const bytes=new TextEncoder().encode(String.raw`{\rtf1\ansi Hello \b backend\b0\par Second line}`);
    const artifact=await parse("notes.rtf","application/rtf",bytes);
    expect(artifact.parseStatus).toBe("ready");
    expect(artifact.textContent).toContain("Hello");
    expect(artifact.textContent).toContain("Second line");
    expect(artifact.warnings.join(" ")).toContain("样式");
  });

  it("parses OpenDocument content.xml on the server",async()=>{
    const zip=new JSZip();
    zip.file("mimetype","application/vnd.oasis.opendocument.text");
    zip.file("content.xml",'<?xml version="1.0"?><office:document-content xmlns:office="office" xmlns:text="text"><office:body><office:text><text:p>Durable parser</text:p><text:p>Second paragraph</text:p></office:text></office:body></office:document-content>');
    const bytes=await zip.generateAsync({type:"uint8array"});
    const artifact=await parse("notes.odt","application/vnd.oasis.opendocument.text",bytes);
    expect(artifact.parseStatus).toBe("ready");
    expect(artifact.textContent).toContain("Durable parser");
    expect(artifact.structure).toContain("content.xml");
  });

  it("deep-indexes text inside a ZIP without treating tests as product implementation",async()=>{
    const zip=new JSZip();
    zip.file("package.json",'{"name":"demo"}');
    zip.file("src/index.ts","export const value = 42;");
    zip.file("tests/index.test.ts","expect(value).toBe(42);");
    const bytes=await zip.generateAsync({type:"uint8array"});
    const artifact=await parse("repo.zip","application/zip",bytes);
    expect(artifact.parseStatus).toBe("ready");
    expect(artifact.artifactKind).toBe("codebase");
    expect(artifact.textContent).toContain("src/index.ts");
    const content=artifact.structuredContent as {evidenceOnlyPaths?:string[];semanticPrimaryPaths?:string[]};
    expect(content.semanticPrimaryPaths).toContain("src/index.ts");
    expect(content.evidenceOnlyPaths).toContain("tests/index.test.ts");
  });

  it("keeps unsupported legacy binary formats explicit instead of inventing text",async()=>{
    const bytes=Uint8Array.from([0xd0,0xcf,0x11,0xe0,0,0,0,0,1,2,3,4]);
    const artifact=await parse("legacy.doc","application/msword",bytes);
    expect(artifact.parseStatus).toBe("unsupported");
    expect(artifact.textContent).toBeUndefined();
    expect(artifact.parsingProfile?.limitations.join(" ")).toContain("未识别");
    expect(SERVER_SOURCE_PARSE_EXTENSIONS).not.toContain("doc");
  });
});
