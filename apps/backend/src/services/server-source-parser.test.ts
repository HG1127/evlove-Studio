import {describe,expect,it} from "vitest";
import JSZip from "jszip";
import {minimalTextPdf,minimalTextPdfPages} from "./pdf-test-fixture";
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
  it("rejects unsafe ZIP paths while preserving the uploaded original",async()=>{
    const zip=new JSZip();
    zip.file("../escape.ts","export const escaped = true;");
    const bytes=new Uint8Array(await zip.generateAsync({type:"uint8array"}));
    const artifact=await parse("unsafe.zip","application/zip",bytes);
    expect(artifact.parseStatus).toBe("unsupported");
    expect(artifact.storageRef).toBe("artifact-test");
    expect(artifact.warnings.join(" ")).toContain("不安全");
  });

  it("rejects a corrupted ZIP text entry instead of indexing its content",async()=>{
    const zip=new JSZip();
    zip.file("src/config.ts","CRC-BOUND-SOURCE");
    const bytes=new Uint8Array(await zip.generateAsync({type:"uint8array",compression:"STORE"}));
    const needle=new TextEncoder().encode("CRC-BOUND-SOURCE");
    let offset=-1;
    for(let index=0;index<=bytes.length-needle.length;index+=1){
      if(needle.every((byte,pos)=>bytes[index+pos]===byte)){offset=index;break;}
    }
    expect(offset).toBeGreaterThan(0);
    bytes[offset]!^=1;
    const artifact=await parse("corrupt.zip","application/zip",bytes);
    expect(artifact.parseStatus).toBe("unsupported");
    expect(artifact.warnings.join(" ")).toContain("CRC32");
  });

  it("rejects oversized or invalid UTF-8 ZIP text entries before using them",async()=>{
    const large=new JSZip();
    large.file("src/huge.ts","A".repeat(250_001));
    const largeArtifact=await parse("large.zip","application/zip",
      new Uint8Array(await large.generateAsync({type:"uint8array",compression:"DEFLATE"})));
    expect(largeArtifact.parseStatus).toBe("unsupported");
    expect(largeArtifact.warnings.join(" ")).toContain("解压大小");
    const invalid=new JSZip();
    invalid.file("src/broken.ts",Uint8Array.from([0xff,0xfe,0xfd]));
    const invalidArtifact=await parse("invalid.zip","application/zip",
      new Uint8Array(await invalid.generateAsync({type:"uint8array"})));
    expect(invalidArtifact.parseStatus).toBe("unsupported");
    expect(invalidArtifact.warnings.join(" ")).toContain("encoded data");
  });

  it("labels a bounded ZIP preview as incomplete and skips binary dependency bytes",async()=>{
    const zip=new JSZip();
    for(let index=0;index<31;index+=1)zip.file(`src/file-${index}.ts`,`export const value${index} = ${index};`);
    zip.file("node_modules/large.bin",new Uint8Array(1_000_000));
    const bytes=new Uint8Array(await zip.generateAsync({type:"uint8array",compression:"DEFLATE"}));
    const artifact=await parse("preview.zip","application/zip",bytes);
    expect(artifact.parseStatus).toBe("ready");
    expect(artifact.parsingProfile?.parsedEntries).toBe(31);
    expect(artifact.parsingProfile?.limitations.join(" ")).toContain("有界文本预览");
    expect(artifact.textContent!.length).toBeLessThanOrEqual(160_000);
  });
  it("reports incomplete deep-index coverage when a ZIP text file is clipped",async()=>{
    const zip=new JSZip();
    zip.file("src/large.ts","x".repeat(30_000));
    const artifact=await parse("clipped.zip","application/zip",
      new Uint8Array(await zip.generateAsync({type:"uint8array",compression:"DEFLATE"})));
    expect(artifact.parseStatus).toBe("ready");
    expect(artifact.parsingProfile).toMatchObject({parsedEntries:1,eligibleEntries:1,deepIndexedEntries:0,deepIndexCoverage:0,completeness:0});
    expect(artifact.warnings.join(" ")).toContain("有界文本预览");
  });
  it("rejects excessive ZIP entry counts before building the JSZip object",async()=>{
    const zip=new JSZip();
    zip.file("src/index.ts","export const x = 1;");
    const bytes=new Uint8Array(await zip.generateAsync({type:"uint8array",compression:"STORE"}));
    const eocd=bytes.length-22;
    expect(Array.from(bytes.slice(eocd,eocd+4))).toEqual([0x50,0x4b,0x05,0x06]);
    for(const countOffset of [8,10]){
      bytes[eocd+countOffset]=0xd1;
      bytes[eocd+countOffset+1]=0x07;
    }
    const artifact=await parse("too-many.zip","application/zip",bytes);
    expect(artifact.parseStatus).toBe("unsupported");
    expect(artifact.warnings.join(" ")).toContain("文件数量");
  });
  it("parses an actual PDF and records complete text-layer coverage",async()=>{
    const artifact=await parse("guide.pdf","application/pdf",minimalTextPdf("SOURCE PDF TEXT"));
    expect(artifact.parseStatus).toBe("ready");
    expect(artifact.textContent).toContain("SOURCE PDF TEXT");
    expect(artifact.parsingProfile).toMatchObject({totalEntries:1,parsedEntries:1,deepIndexedEntries:1,deepIndexCoverage:1});
  });

  it("reports missing PDF text layers and retains the original file",async()=>{
    const artifact=await parse("scan.pdf","application/pdf",minimalTextPdfPages([""]));
    expect(artifact.parseStatus).toBe("unsupported");
    expect(artifact.storageRef).toBe("artifact-test");
    expect(artifact.parsingProfile).toMatchObject({totalEntries:1,parsedEntries:0,deepIndexedEntries:0,deepIndexCoverage:0});
    expect(artifact.warnings.join(" ")).toContain("OCR");
  });

  it("limits PDF preview to 100 pages and reports actual coverage",async()=>{
    const bytes=minimalTextPdfPages(Array.from({length:101},(_,index)=>`PAGE ${index+1} TEXT`));
    const artifact=await parse("book.pdf","application/pdf",bytes);
    expect(artifact.parseStatus).toBe("ready");
    expect(artifact.structure).toHaveLength(100);
    expect(artifact.textContent).toContain("PAGE 100 TEXT");
    expect(artifact.textContent).not.toContain("PAGE 101 TEXT");
    expect(artifact.parsingProfile?.deepIndexCoverage).toBeCloseTo(100/101);
    expect(artifact.warnings.join(" ")).toContain("有界文本预览");
  });

  it("rejects oversized or corrupt PDFs without discarding uploaded bytes",async()=>{
    const oversized=await parse("oversized.pdf","application/pdf",new Uint8Array(20_000_001));
    expect(oversized.parseStatus).toBe("unsupported");
    expect(oversized.storageRef).toBe("artifact-test");
    expect(oversized.warnings.join(" ")).toContain("超出");
    const corrupt=await parse("corrupt.pdf","application/pdf",new TextEncoder().encode("not a pdf"));
    expect(corrupt.parseStatus).toBe("unsupported");
    expect(corrupt.storageRef).toBe("artifact-test");
  });});
