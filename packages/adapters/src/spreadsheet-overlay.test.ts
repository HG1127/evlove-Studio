// @vitest-environment node
import {describe,expect,it} from "vitest";
import * as XLSX from "xlsx";
import {renderSpreadsheetOverlay} from "./spreadsheet-overlay";

function asBlob(value:Uint8Array|ArrayBuffer|string,mime="application/octet-stream"){
  if(typeof value==="string")return new Blob([value],{type:mime});
  // SheetJS 'array' produces an ArrayBuffer in this runtime, not only Uint8Array.
  const source=value instanceof ArrayBuffer?new Uint8Array(value):value;
  const bytes=new Uint8Array(source.byteLength);
  bytes.set(source);
  return new Blob([bytes.buffer],{type:mime});
}
describe("native spreadsheet evolution overlays",()=>{
  it("edits one XLSX cell and formula while keeping unmodified sheets and data",async()=>{
    const wb=XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet([
      ["Code","Amount","Double"],["00123",10,20],["keep",3,6],
    ]),"Sales");
    XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet([["Policy"],["untouched"]]),"Reference");
    const original=asBlob(XLSX.write(wb,{type:"array",bookType:"xlsx"}));
    const blueprint=JSON.stringify({kind:"spreadsheet",sheets:[
      {name:"Sales",cells:[{address:"B2",value:12},{address:"C2",formula:"B2*2"}]},
    ]});
    const materialized=await renderSpreadsheetOverlay({name:"book.xlsx",extension:"xlsx",mimeType:original.type},blueprint,original);
    const reopened=XLSX.read(await materialized.blob.arrayBuffer(),{type:"array",cellFormula:true});
    expect(reopened.SheetNames).toEqual(["Sales","Reference"]);
    expect(reopened.Sheets.Sales?.B2?.v).toBe(12);
    expect(reopened.Sheets.Sales?.C2?.f).toBe("B2*2");
    expect(reopened.Sheets.Sales?.C2?.v).not.toBe(0); // never fake recalculated formula cache
    expect(reopened.Sheets.Sales?.A2?.v).toBe("00123");
    expect(reopened.Sheets.Sales?.A3?.v).toBe("keep");
    expect(reopened.Sheets.Reference?.A2?.v).toBe("untouched");
  });

  it("preserves unrelated CSV rows/columns and leading-zero codes",async()=>{
    const original=asBlob("code,total,note\n000123,5,keep\n000124,9,untouched\n", "text/csv");
    const blueprint=JSON.stringify({kind:"spreadsheet",sheets:[{name:"Sheet1",
      cells:[{address:"B2",value:15}]}]});
    const {blob}=await renderSpreadsheetOverlay({name:"data.csv",extension:"csv",mimeType:"text/csv"},blueprint,original);
    const text=await blob.text();
    const reopened=XLSX.read(text,{type:"string",raw:true});
    expect(reopened.Sheets.Sheet1?.A2?.v).toBe("000123");
    expect(String(reopened.Sheets.Sheet1?.B2?.v)).toBe("15");
    expect(reopened.Sheets.Sheet1?.C2?.v).toBe("keep");
    expect(reopened.Sheets.Sheet1?.A3?.v).toBe("000124");
    expect(reopened.Sheets.Sheet1?.C3?.v).toBe("untouched");
  });

  it("supports explicit TSV cell edits without losing extra rows",async()=>{
    const original=asBlob("id\tresult\nA\t1\nB\t2\n","text/tab-separated-values");
    const {blob}=await renderSpreadsheetOverlay({name:"data.tsv",extension:"tsv",mimeType:"text/tab-separated-values"},
      JSON.stringify({kind:"spreadsheet",sheets:[{name:"Sheet1",cells:[{address:"B2",value:"ok"}]}]}),original);
    const result=await blob.text();
    expect(result).toContain("A\tok");
    expect(result).toContain("B\t2");
  });

  it("refuses partial rows as full data, empty/no-op edits, missing sheet and invented cached formulas",async()=>{
    const original=asBlob(XLSX.write((()=>{
      const wb=XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet([[1,2]]),"Actual");return wb;
    })(),{type:"array",bookType:"xlsx"}));
    const source={name:"book.xlsx",extension:"xlsx",mimeType:"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"};
    for(const [blueprint,pattern] of [
      [{kind:"spreadsheet",sheets:[{name:"Actual",rows:[[3]]}]},/cells/],
      [{kind:"spreadsheet",sheets:[{name:"Actual",cells:[{address:"A1",value:1}]}]},/没有产生真实|没有产生|没有真实/],
      [{kind:"spreadsheet",sheets:[{name:"Unknown",cells:[{address:"A1",value:2}]}]},/不存在/],
      [{kind:"spreadsheet",sheets:[{name:"Actual",cells:[{address:"C1",formula:"A1+B1",value:999}]}]},/公式缓存/],
    ] as const){
      await expect(renderSpreadsheetOverlay(source,JSON.stringify(blueprint),original)).rejects.toThrow(pattern);
    }
  });

  it("refuses to invent executable formulas in CSV files",async()=>{
    const original=asBlob("col\n1\n","text/csv");
    await expect(renderSpreadsheetOverlay({name:"a.csv",extension:"csv",mimeType:"text/csv"},
      JSON.stringify({kind:"spreadsheet",sheets:[{name:"Sheet1",cells:[{address:"A2",formula:"2*2"}]}]}),original))
      .rejects.toThrow(/公式/);
  });
});
