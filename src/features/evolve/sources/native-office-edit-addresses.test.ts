// @vitest-environment node
import {describe,expect,it} from "vitest";
import JSZip from "jszip";
import * as XLSX from "xlsx";
import {extractSource} from "./extract";

const bytes=async(zip:JSZip)=>new Uint8Array(await zip.generateAsync({type:"uint8array"}));

describe("real upload to native editable coordinates",()=>{
  it("extracts DOCX run identities rather than just summarizing text",async()=>{
    const zip=new JSZip();
    zip.file("word/document.xml",'<w:document xmlns:w="urn:w"><w:p><w:t xml:space="preserve"> Preserve me </w:t><w:t>Replace me</w:t></w:p></w:document>');
    const parsed=await extractSource({name:"report.docx",
      mimeType:"application/vnd.openxmlformats-officedocument.wordprocessingml.document",buffer:await bytes(zip)});
    const structured=parsed.structuredContent as {parts:Array<{path:string;textRuns:Array<{index:number;text:string}>}>};
    expect(structured.parts[0]?.path).toBe("word/document.xml");
    expect(structured.parts[0]?.textRuns).toEqual([{index:0,text:" Preserve me "},{index:1,text:"Replace me"}]);
  });
  it("matches server native indexes for attributed PPTX a:t runs",async()=>{
    const zip=new JSZip();
    zip.file("ppt/slides/slide2.xml",'<p:sld xmlns:a="urn:a"><a:t xml:space="preserve"> Slide two </a:t><a:t>Second run</a:t></p:sld>');
    const parsed=await extractSource({name:"slides.pptx",
      mimeType:"application/vnd.openxmlformats-officedocument.presentationml.presentation",buffer:await bytes(zip)});
    const structured=parsed.structuredContent as {slides:Array<{number:number;textRuns:Array<{index:number;text:string}>}>};
    expect(structured.slides[0]?.number).toBe(2);
    expect(structured.slides[0]?.textRuns).toEqual([{index:0,text:" Slide two "},{index:1,text:"Second run"}]);
  });
  it("extracts spreadsheet sheet names and formula addresses for precise mutations",async()=>{
    const book=XLSX.utils.book_new();
    const sheet=XLSX.utils.aoa_to_sheet([["ID","Total"],["0001",10]]);
    sheet.B3={t:"n",f:"B2*2",v:20};
    sheet["!ref"]="A1:B3";
    XLSX.utils.book_append_sheet(book,sheet,"Sales");
    const raw=XLSX.write(book,{type:"array",bookType:"xlsx"}) as Uint8Array;
    const parsed=await extractSource({name:"sales.xlsx",
      mimeType:"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",buffer:new Uint8Array(raw)});
    const structured=parsed.structuredContent as {sheets:Array<{name:string;cells:Array<{address:string;formula?:string}>}>};
    expect(structured.sheets[0]?.name).toBe("Sales");
    expect(structured.sheets[0]?.cells.find(cell=>cell.address==="B3")?.formula).toBe("B2*2");
  });
  it.each(["csv","tsv","ods"])("extracts %s Sheet/A1 positions while preserving leading-zero IDs",async extension=>{
    const separator=extension==="tsv"?"\t":",";
    const book=XLSX.utils.book_new();XLSX.utils.book_append_sheet(book,XLSX.utils.aoa_to_sheet([["ID","Value"],["000123",5]]),"Data");
    const buffer=extension==="ods"?new Uint8Array(XLSX.write(book,{type:"array",bookType:"ods"}))
      :new TextEncoder().encode("ID"+separator+"Value\n000123"+separator+"5\n");
    const parsed=await extractSource({name:"data."+extension,mimeType:extension==="ods"?"application/vnd.oasis.opendocument.spreadsheet":"text/plain",buffer});
    const structured=parsed.structuredContent as {sheets:Array<{cells:Array<{address:string;value:unknown}>}>};
    expect(structured.sheets[0]?.cells.find(cell=>cell.address==="A2")?.value).toBe("000123");
    expect(parsed.artifactKind).toBe("spreadsheet");
  });
  it("treats SVG as editable structured text with a separate visual requirement",async()=>{
    const parsed=await extractSource({name:"icon.svg",mimeType:"image/svg+xml",buffer:new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><text>Example</text></svg>')});
    expect(parsed.artifactKind).toBe("generic");expect(parsed.artifactDescriptor.capabilities.materialize).toBe(true);
  });
});
