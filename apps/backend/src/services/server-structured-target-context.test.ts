// @vitest-environment node
import {describe,expect,it,vi} from "vitest";
import {CandidateSchema,type EvolveProject,type SourceArtifact} from "@evolution/contracts";
import {experimentRecoveryFixture} from "@evolution/testkit";
import {buildServerCandidateTargetContext,buildServerExactCandidateArtifacts} from "./server-candidate-context";
import {serverStructuredTargetContext} from "./server-structured-target-context";

const candidate=CandidateSchema.parse({id:"C1",name:"优化目标位置",change:"把重要段落或单元格改为明确的要求"});
function source(extension:string,structuredContent?:unknown):SourceArtifact{
  const {project}=experimentRecoveryFixture();
  const original=project.sourceArtifacts[0]!;
  const mimeType=extension==="docx"?"application/vnd.openxmlformats-officedocument.wordprocessingml.document":
    extension==="pptx"?"application/vnd.openxmlformats-officedocument.presentationml.presentation":
      extension==="xlsx"?"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet":"text/csv";
  return {...original,id:"native-file",name:"original."+extension,extension,mimeType,
    artifactKind:extension==="pptx"?"presentation":extension==="xlsx"||extension==="csv"?"spreadsheet":"document",
    role:"target",textContent:"提取的摘要不是可编辑地址",structuredContent,
    artifactDescriptor:undefined};
}
function projectWith(artifact:SourceArtifact):EvolveProject{
  const project=experimentRecoveryFixture().project;
  return {...project,sourceArtifacts:[artifact],searchChampion:undefined};
}
describe("indexed Office/spreadsheet context for actual Candidate mutations",()=>{
  it("supplies DOCX part paths and exact run positions, including prior Champion edits",async()=>{
    const doc=source("docx",{kind:"document",parts:[{
      path:"word/document.xml",textRuns:[{index:0,text:"原内容"},{index:1,text:"受保护内容"}],
    }]});
    const parent=JSON.stringify({kind:"document",parts:[{
      path:"word/document.xml",textRuns:[{index:0,text:"上轮 Champion 已修改内容"}],
    }]});
    const direct=serverStructuredTargetContext(doc,candidate,parent);
    expect(direct).toMatchObject({kind:"document",parts:[{path:"word/document.xml",textRuns:[
      {index:0,text:"上轮 Champion 已修改内容"},{index:1,text:"受保护内容"},
    ]}]});
    const context=await buildServerCandidateTargetContext(projectWith(doc),candidate,async()=>{throw Error("no text flatten");});
    expect(context[0]!.structuredContext).toMatchObject({kind:"document",parts:[{
      path:"word/document.xml",textRuns:[{index:0,text:"原内容"},{index:1,text:"受保护内容"}],
    }]});
    expect(context[0]!.mutationMode).toBe("full");
  });

  it("passes PPTX slide number and a:t textRun indexes to the AI",async()=>{
    const ppt=source("pptx",{kind:"presentation",slides:[
      {number:1,textRuns:[{index:0,text:"第1页"},{index:1,text:"不能删除"}]},
      {number:2,textRuns:[{index:0,text:"需要修改的第2页"}]},
    ]});
    const result=await buildServerCandidateTargetContext(projectWith(ppt),candidate,async()=>"no");
    expect(result[0]!.structuredContext).toMatchObject({kind:"presentation",totalSlides:2});
    const slides=(result[0]!.structuredContext as {slides:Array<{number:number;textRuns:Array<{index:number;text:string}>}>}).slides;
    expect(slides.find(s=>s.number===2)?.textRuns[0]).toEqual({index:0,text:"需要修改的第2页"});
  });

  it("treats CSV as a structured spreadsheet (not text-edits that could replace partial preview)",async()=>{
    const csv=source("csv",{kind:"spreadsheet",sheets:[{name:"Sheet1",
      cells:[{address:"A1",value:"Code"},{address:"A2",value:"00001"},{address:"B2",value:2}]}]});
    const read=vi.fn(async()=>{throw new Error("CSV cannot use text-edits fast path");});
    const results=await buildServerCandidateTargetContext(projectWith(csv),candidate,read);
    expect(read).not.toHaveBeenCalled();
    expect(results[0]!.mutationMode).toBe("full");
    const context=results[0]!.structuredContext as {kind:string;sheets:Array<{name:string;cells:Array<{address:string;value?:unknown}>}>};
    expect(context.kind).toBe("spreadsheet");
    expect(context.sheets[0]?.name).toBe("Sheet1");
    expect(context.sheets[0]?.cells.find(cell=>cell.address==="A2")).toMatchObject({value:"00001"});
  });

  it("uses accepted previous-round Spreadsheet cells, not stale V1 values or cached formula results",async()=>{
    const workbook=source("xlsx",{kind:"spreadsheet",sheets:[{name:"Sales",cells:[
      {address:"A1",value:"Revenue"},
      {address:"B2",value:10},
      {address:"C2",value:20,formula:"B2*2"},
    ]}]});
    const parent=JSON.stringify({kind:"spreadsheet",sheets:[{name:"Sales",cells:[
      {address:"B2",value:12},
      {address:"C2",formula:"B2*3"},
      {address:"D2",value:"created-last-round"},
    ]}]});
    const context=serverStructuredTargetContext(workbook,candidate,parent);
    expect(context).toMatchObject({kind:"spreadsheet",totalSheets:1});
    const sheet=(context as {sheets:Array<{cells:Array<{address:string;value?:unknown;formula?:string}>}>}).sheets[0]!;
    expect(sheet.cells.find(cell=>cell.address==="A1")).toMatchObject({value:"Revenue"});
    expect(sheet.cells.find(cell=>cell.address==="B2")).toMatchObject({value:12});
    expect(sheet.cells.find(cell=>cell.address==="C2")).toMatchObject({formula:"B2*3"});
    expect(sheet.cells.find(cell=>cell.address==="C2")?.value).toBeUndefined();
    expect(sheet.cells.find(cell=>cell.address==="D2")).toMatchObject({value:"created-last-round"});
    // Source metadata must not be mutated while compiling next-round context.
    expect((workbook.structuredContent as {sheets:Array<{cells:Array<{address:string;value?:unknown}>}>}).sheets[0]?.cells[1]?.value).toBe(10);
  });
  it("never applies a raw CSV/TSV text patch as a native spreadsheet Candidate",async()=>{
    for(const extension of ["csv","tsv"]){
      const original=source(extension,{kind:"spreadsheet",sheets:[{name:"Sheet1",cells:[
        {address:"A1",value:"Title"},{address:"A2",value:"Original"},
      ]}]});
      const proposed=CandidateSchema.parse({id:"C-spreadsheet",name:"修改表格",change:"更正标题",patches:[{
        id:"patch-a",component:"code",operation:"update",target:"Original",artifactId:original.id,
        content:"Updated",rationale:"字段更正",
      }]});
      const read=vi.fn(async()=>"Title,Original");
      expect(await buildServerExactCandidateArtifacts(projectWith(original),proposed,read)).toBeUndefined();
      expect(read).not.toHaveBeenCalled();
    }
  });
  it("fails before AI when no editable Office/Spreadsheet positions survived parsing",async()=>{
    for(const extension of ["docx","pptx","xlsx","csv"]){
      await expect(buildServerCandidateTargetContext(projectWith(source(extension)),candidate,async()=>"flattened"))
        .rejects.toThrow(/缺少可编辑/);
    }
  });
});
