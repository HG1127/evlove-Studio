import {describe,expect,it} from "vitest";
import JSZip from "jszip";
import * as XLSX from "xlsx";
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
  },15_000);

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
  });  it("indexes real DOCX and PPTX text from checked Office XML",async()=>{
    const docx=new JSZip();
    docx.file("word/document.xml",'<w:document xmlns:w="w"><w:p><w:r><w:t>FINAL DOCX GUIDE</w:t></w:r></w:p></w:document>');
    const document=await parse("guide.docx","application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      new Uint8Array(await docx.generateAsync({type:"uint8array"})));
    expect(document.parseStatus).toBe("ready");
    expect(document.textContent).toContain("FINAL DOCX GUIDE");
    expect(document.structure).toContain("word/document.xml");
    const pptx=new JSZip();
    pptx.file("ppt/slides/slide1.xml",'<p:sld xmlns:a="a"><a:t xml:space="preserve">FINAL SLIDE TEXT</a:t></p:sld>');
    const presentation=await parse("slides.pptx","application/vnd.openxmlformats-officedocument.presentationml.presentation",
      new Uint8Array(await pptx.generateAsync({type:"uint8array"})));
    expect(presentation.parseStatus).toBe("ready");
    expect(presentation.textContent).toContain("FINAL SLIDE TEXT");
    expect(presentation.structure).toContain("ppt/slides/slide1.xml");
    expect((presentation.structuredContent as {slides:Array<{textRuns:Array<{index:number;text:string}>}>}).slides[0]?.textRuns)
      .toEqual([{index:0,text:"FINAL SLIDE TEXT"}]);
  });

  it("rejects oversized Office XML before decompression while retaining the original",async()=>{
    const docx=new JSZip();
    docx.file("word/document.xml",`<w:document><w:t>${"A".repeat(2_000_001)}</w:t></w:document>`);
    const artifact=await parse("huge.docx","application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      new Uint8Array(await docx.generateAsync({type:"uint8array",compression:"DEFLATE"})));
    expect(artifact.parseStatus).toBe("unsupported");
    expect(artifact.storageRef).toBe("artifact-test");
    expect(artifact.warnings.join(" ")).toContain("解压大小");
  });

  it("rejects unsafe Office paths and missing PPTX slides",async()=>{
    const unsafe=new JSZip();
    unsafe.file("word/document.xml","<w:t>GOOD</w:t>");
    unsafe.file("../outside.xml","<w:t>BAD</w:t>");
    const artifact=await parse("unsafe.docx","application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      new Uint8Array(await unsafe.generateAsync({type:"uint8array"})));
    expect(artifact.parseStatus).toBe("unsupported");
    expect(artifact.warnings.join(" ")).toContain("不安全");
    const missing=new JSZip();missing.file("ppt/presentation.xml","<p:presentation/>");
    const empty=await parse("empty.pptx","application/vnd.openxmlformats-officedocument.presentationml.presentation",
      new Uint8Array(await missing.generateAsync({type:"uint8array"})));
    expect(empty.parseStatus).toBe("unsupported");
    expect(empty.warnings.join(" ")).toContain("幻灯片数量");
  });  it("rejects changed Office XML bytes by CRC before reporting usable content",async()=>{
    const pptx=new JSZip();
    pptx.file("ppt/slides/slide1.xml","<a:t>CRC OFFICE TEXT</a:t>");
    const bytes=new Uint8Array(await pptx.generateAsync({type:"uint8array",compression:"STORE"}));
    const needle=new TextEncoder().encode("CRC OFFICE TEXT");
    let offset=-1;
    for(let index=0;index<=bytes.length-needle.length;index+=1){
      if(needle.every((byte,pos)=>bytes[index+pos]===byte)){offset=index;break;}
    }
    expect(offset).toBeGreaterThan(0);
    bytes[offset]!^=1;
    const artifact=await parse("changed.pptx","application/vnd.openxmlformats-officedocument.presentationml.presentation",bytes);
    expect(artifact.parseStatus).toBe("unsupported");
    expect(artifact.storageRef).toBe("artifact-test");
    expect(artifact.warnings.join(" ")).toContain("CRC32");
  });  it("indexes a small XLSX workbook and a legacy XLS workbook",async()=>{
    const workbook=XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook,XLSX.utils.aoa_to_sheet([["Name","Score"],["Alice",42]]),"Metrics");
    const xlsx=await parse("metrics.xlsx","application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      new Uint8Array(XLSX.write(workbook,{type:"array",bookType:"xlsx"}) as ArrayBuffer));
    expect(xlsx.parseStatus).toBe("ready");
    expect(xlsx.textContent).toContain("Alice");
    expect(xlsx.parsingProfile).toMatchObject({totalEntries:1,parsedEntries:1,deepIndexedEntries:1,deepIndexCoverage:1});
    const xls=await parse("metrics.xls","application/vnd.ms-excel",
      new Uint8Array(XLSX.write(workbook,{type:"array",bookType:"biff8"}) as ArrayBuffer));
    expect(xls.parseStatus).toBe("ready");
    expect(xls.textContent).toContain("Alice");
  });

  it("indexes uploaded CSV and TSV as native Sheet/A1 cells without losing leading zeros",async()=>{
    for(const [name,mime,textInput] of [
      ["clients.csv","text/csv","code,amount\n000123,5\n000124,9\n"],
      ["clients.tsv","text/tab-separated-values","code\tamount\n000123\t5\n000124\t9\n"],
    ] as const){
      const parsed=await parse(name,mime,new TextEncoder().encode(textInput));
      expect(parsed.parseStatus,name).toBe("ready");
      const structure=parsed.structuredContent as {kind:string;sheets:Array<{
        name:string;cells:Array<{address:string;value:unknown}>,
      }>};
      expect(structure.kind,name).toBe("spreadsheet");
      expect(structure.sheets[0]?.name,name).toBe("Sheet1");
      expect(structure.sheets[0]?.cells.find(cell=>cell.address==="A2")?.value,name).toBe("000123");
      expect(structure.sheets[0]?.cells.find(cell=>cell.address==="A3")?.value,name).toBe("000124");
      expect(parsed.parsingProfile?.totalEntries).toBe(1);
    }
  });

  it("limits workbook rows before preview conversion and reports partial coverage",async()=>{
    const workbook=XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook,XLSX.utils.aoa_to_sheet(
      Array.from({length:900},(_,index)=>[`ROW-${index+1}`,index])),"Large");
    const artifact=await parse("large.xlsx","application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      new Uint8Array(XLSX.write(workbook,{type:"array",bookType:"xlsx"}) as ArrayBuffer));
    expect(artifact.parseStatus).toBe("ready");
    const structured=artifact.structuredContent as {sheets:Array<{rows:unknown[]}>};
    expect(structured.sheets[0]?.rows.length).toBeLessThanOrEqual(600);
    expect(artifact.textContent).not.toContain("ROW-900");
    expect(artifact.parsingProfile).toMatchObject({parsedEntries:1,eligibleEntries:1,deepIndexedEntries:0,deepIndexCoverage:0});
    expect(artifact.warnings.join(" ")).toContain("有界预览");
  });

  it("limits workbook sheet count and rejects an XML expansion bomb",async()=>{
    const workbook=XLSX.utils.book_new();
    for(let index=0;index<31;index+=1){
      XLSX.utils.book_append_sheet(workbook,XLSX.utils.aoa_to_sheet([[`SHEET-${index+1}`]]),`S${index+1}`);
    }
    const artifact=await parse("many.xlsx","application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      new Uint8Array(XLSX.write(workbook,{type:"array",bookType:"xlsx"}) as ArrayBuffer));
    expect(artifact.parseStatus).toBe("ready");
    expect(artifact.parsingProfile?.totalEntries).toBe(31);
    expect(artifact.parsingProfile?.parsedEntries).toBe(30);
    expect(artifact.parsingProfile?.deepIndexCoverage).toBeLessThan(1);
    const bomb=new JSZip();bomb.file("xl/worksheets/sheet1.xml","A".repeat(2_000_001));
    const rejected=await parse("bomb.xlsx","application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      new Uint8Array(await bomb.generateAsync({type:"uint8array",compression:"DEFLATE"})));
    expect(rejected.parseStatus).toBe("unsupported");
    expect(rejected.storageRef).toBe("artifact-test");
    expect(rejected.warnings.join(" ")).toContain("解压大小");
  });  it("reports a large text Source as a bounded preview",async()=>{
    const artifact=await parse("large.txt","text/plain",new TextEncoder().encode("A".repeat(160_001)));
    expect(artifact.parseStatus).toBe("ready");
    expect(artifact.textContent).toHaveLength(160_000);
    expect(artifact.storageRef).toBe("artifact-test");
    expect(artifact.parsingProfile).toMatchObject({eligibleEntries:1,deepIndexedEntries:0,deepIndexCoverage:0,completeness:0});
    expect(artifact.warnings.join(" ")).toContain("有界文本预览");
  });

  it("does not confuse UTF-8 byte length with text preview truncation",async()=>{
    const artifact=await parse("chinese.txt","text/plain",new TextEncoder().encode("中".repeat(160_000)));
    expect(artifact.parseStatus).toBe("ready");
    expect(artifact.textContent).toHaveLength(160_000);
    expect(artifact.parsingProfile?.deepIndexCoverage).toBe(1);
    expect(artifact.warnings.join(" ")).not.toContain("有界文本预览");
  });

  it("retains bounded structured JSON while reporting a truncated text preview",async()=>{
    const artifact=await parse("large.json","application/json",
      new TextEncoder().encode(JSON.stringify({content:"A".repeat(160_001)})));
    expect(artifact.parseStatus).toBe("ready");
    expect(artifact.structuredContent).toMatchObject({kind:"json",value:{content:"A".repeat(160_001)}});
    expect(artifact.parsingProfile?.deepIndexCoverage).toBe(0);
    expect(artifact.warnings.join(" ")).toContain("有界文本预览");
  });

  it("rejects invalid UTF-8 in a named text Source without losing the upload",async()=>{
    const artifact=await parse("broken.txt","text/plain",Uint8Array.from([0xff,0xfe,0xfd]));
    expect(artifact.parseStatus).toBe("unsupported");
    expect(artifact.storageRef).toBe("artifact-test");
    expect(artifact.warnings.join(" ")).toContain("encoded data");
  });

  it("marks a large Office text extraction as a preview",async()=>{
    const zip=new JSZip();zip.file("word/document.xml",`<w:document><w:t>${"A".repeat(160_001)}</w:t></w:document>`);
    const artifact=await parse("large.docx","application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      new Uint8Array(await zip.generateAsync({type:"uint8array",compression:"DEFLATE"})));
    expect(artifact.parseStatus).toBe("ready");
    expect(artifact.textContent).toHaveLength(160_000);
    expect(artifact.parsingProfile?.deepIndexCoverage).toBe(0);
    expect(artifact.warnings.join(" ")).toContain("有界文本预览");
  });  it("skips unbounded JSON structure but retains a text preview and raw bytes",async()=>{
    const artifact=await parse("huge.json","application/json",
      new TextEncoder().encode(JSON.stringify({content:"A".repeat(1_000_001)})));
    expect(artifact.parseStatus).toBe("ready");
    expect(artifact.structuredContent).toBeUndefined();
    expect(artifact.storageRef).toBe("artifact-test");
    expect(artifact.parsingProfile?.deepIndexCoverage).toBe(0);
    expect(artifact.warnings.join(" ")).toContain("结构化解析上限");
  });});
