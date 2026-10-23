import {createHash} from "node:crypto";
import {readFile} from "node:fs/promises";
import JSZip from "jszip";
import * as XLSX from "xlsx";
import {expect,test} from "@playwright/test";

type Input={extension:string;mimeType:string;original:string;patch:string};
async function inputs():Promise<Input[]>{
  const result:Input[]=[];
  const add=(extension:string,bytes:Uint8Array|string,patch:string,mimeType="text/plain")=>{
    result.push({extension,mimeType,original:Buffer.from(bytes).toString("base64"),patch});
  };
  for(const [extension,before,after] of [
    ["ts","export const value = 1;","export const value = 2;"],["py","value = 1\n","value = 2\n"],
    ["jsonl",'{"value":1}\n','{"value":2}\n'],["toml","value = 1\n","value = 2\n"],
    ["yaml","value: 1\n","value: 2\n"],["xml","<value>1</value>","<value>2</value>"],
    ["svg",'<svg xmlns="http://www.w3.org/2000/svg"><text>1</text></svg>','<svg xmlns="http://www.w3.org/2000/svg"><text>2</text></svg>'],
  ])add(extension!,before!,after!,extension==="svg"?"image/svg+xml":"text/plain");
  for(const extension of ["csv","tsv"]){
    const separator=extension==="tsv"?"\t":",";
    add(extension,"Code"+separator+"Value\n000123"+separator+"5\n",
      JSON.stringify({kind:"spreadsheet",sheets:[{name:"Sheet1",cells:[{address:"B2",value:15}]}]}));
  }
  for(const extension of ["xlsx","xls","ods"] as const){
    const book=XLSX.utils.book_new();XLSX.utils.book_append_sheet(book,XLSX.utils.aoa_to_sheet([["Code","Value"],["000123",5]]),"Data");
    add(extension,new Uint8Array(XLSX.write(book,{type:"array",bookType:extension})),
      JSON.stringify({kind:"spreadsheet",sheets:[{name:"Data",cells:[{address:"B2",value:15}]}]}),"application/octet-stream");
  }
  for(const extension of ["docx","pptx"]){
    const zip=new JSZip();
    const docx=extension==="docx";
    const main=docx?"word/document.xml":"ppt/presentation.xml";
    zip.file("[Content_Types].xml",'<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="bin" ContentType="application/octet-stream"/><Override PartName="/'+main+'" ContentType="application/vnd.openxmlformats-officedocument.'+(docx?"wordprocessingml.document":"presentationml.presentation")+'.main+xml"/></Types>');
    zip.file("_rels/.rels",'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="'+main+'"/></Relationships>');
    if(docx)zip.file(main,'<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Original</w:t></w:r></w:p></w:body></w:document>');
    else {
      zip.file(main,'<p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><p:sldIdLst><p:sldId id="256" r:id="rId1"/></p:sldIdLst></p:presentation>');
      zip.file("ppt/_rels/presentation.xml.rels",'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide1.xml"/></Relationships>');
      zip.file("ppt/slides/slide1.xml",'<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/><p:sp><p:nvSpPr><p:cNvPr id="2" name="Text"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:t>Original</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>');
      const contentTypes=await zip.file("[Content_Types].xml")!.async("string");
      zip.file("[Content_Types].xml",contentTypes.replace("</Types>",'<Override PartName="/ppt/slides/slide1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/></Types>'));
    }
    zip.file("assets/kept.bin",new Uint8Array([1,0,255]));
    add(extension,await zip.generateAsync({type:"uint8array"}),JSON.stringify(extension==="docx"
      ?{kind:"document",parts:[{path:"word/document.xml",textRuns:[{index:0,text:"Updated"}]}]}
      :{kind:"presentation",slides:[{number:1,textRuns:[{index:0,text:"Updated"}]}]}),docx?"application/vnd.openxmlformats-officedocument.wordprocessingml.document":"application/vnd.openxmlformats-officedocument.presentationml.presentation");
  }
  const zip=new JSZip();zip.file("src/app.ts","export const value = 1;");zip.file("assets/kept.bin",new Uint8Array([1,0,255]));
  add("zip",await zip.generateAsync({type:"uint8array"}),JSON.stringify({kind:"codebase",files:[{path:"src/app.ts",content:"export const value = 2;"}]}),"application/zip");
  return result;
}

let allInputs:Input[]=[];
test.beforeAll(async()=>{allInputs=await inputs();});
for(const extension of ["ts","py","jsonl","toml","yaml","xml","svg","csv","tsv","xlsx","xls","ods","docx","pptx","zip"]){
test(extension+" parses, materializes and downloads the exact checked bytes in Chromium",async({page},testInfo)=>{
  await page.goto("/");
    const input=allInputs.find(item=>item.extension===extension)!;
    const prepared=await page.evaluate(async input=>{
      const extractPath="/src/features/evolve/sources/extract.ts";
      const builderPath="/src/features/evolve/runtime/artifact-output-builders.ts";
      const blobPath="/src/features/evolve/runtime/artifact-blob-store.ts";
      const contractPath="/packages/contracts/src/index.ts";
      const {extractSource}=await import(/* @vite-ignore */extractPath) as typeof import("../src/features/evolve/sources/extract");
      const {buildDownloadBlob,verifyGeneratedArtifact}=await import(/* @vite-ignore */builderPath) as typeof import("../src/features/evolve/runtime/artifact-output-builders");
      const {putArtifactBlob}=await import(/* @vite-ignore */blobPath) as typeof import("../src/features/evolve/runtime/artifact-blob-store");
      const {SourceArtifactSchema,CandidateArtifactSnapshotSchema}=await import(/* @vite-ignore */contractPath) as typeof import("@evolution/contracts");
      const bytes=Uint8Array.from(atob(input.original),char=>char.charCodeAt(0));
      const parsed=await extractSource({name:"sample."+input.extension,mimeType:input.mimeType,buffer:bytes});
      const source=SourceArtifactSchema.parse({id:"browser-"+input.extension,name:"sample."+input.extension,
        role:"target",inputMode:"upload",parseStatus:"ready",size:bytes.length,mimeType:input.mimeType,
        extension:input.extension,artifactKind:parsed.artifactKind,artifactDescriptor:parsed.artifactDescriptor,
        textContent:parsed.extractedText,structure:parsed.structure,structuredContent:parsed.structuredContent,createdAt:new Date().toISOString()});
      await putArtifactBlob(source.id,new Blob([bytes],{type:input.mimeType}));
      const snapshot=CandidateArtifactSnapshotSchema.parse({id:"snapshot-"+source.id,sourceArtifactId:source.id,
        name:source.name,mimeType:source.mimeType,content:input.patch,createdAt:new Date().toISOString()});
      const result=await buildDownloadBlob(source,snapshot);
      await verifyGeneratedArtifact(source,snapshot,result.blob);
      const digest=await crypto.subtle.digest("SHA-256",await result.blob.arrayBuffer());
      const sha256=[...new Uint8Array(digest)].map(byte=>byte.toString(16).padStart(2,"0")).join("");
      document.getElementById("format-download")?.remove();
      const link=document.createElement("a");link.id="format-download";link.download=result.name;
      link.href=URL.createObjectURL(result.blob);
      // App layouts can clip body siblings below their full-height root. Keep this test control visible.
      Object.assign(link.style,{position:"fixed",top:"12px",left:"12px",zIndex:"2147483647",background:"white",color:"black",padding:"8px"});
      link.textContent="Download checked format";document.body.append(link);
      return{name:result.name,sha256,size:result.blob.size};
    },input);
    await expect(page.locator("#format-download")).toBeInViewport();
    const [download]=await Promise.all([page.waitForEvent("download",{timeout:15000}),page.locator("#format-download").click()]);
    expect(download.suggestedFilename()).toBe(prepared.name);
    const path=await download.path();if(!path)throw Error("Download missing for "+input.extension);
    const bytes=await readFile(path);
    expect(bytes.length).toBe(prepared.size);
    expect(createHash("sha256").update(bytes).digest("hex")).toBe(prepared.sha256);
  await testInfo.attach("checked-format-download.json",{body:Buffer.from(JSON.stringify({extension,sha256:prepared.sha256,size:prepared.size},null,2)),contentType:"application/json"});
});
}
