import {z} from "zod";
import type {CellObject,WorkSheet} from "xlsx";

/**
 * Shared browser/server spreadsheet overlay. A model supplies ONLY cell
 * changes, never a partial "rows" preview masquerading as a full workbook.
 * All original worksheets/other cells are retained and checked after reopen.
 */
const Scalar=z.union([z.string(),z.number().finite(),z.boolean(),z.null()]);
export const SpreadsheetCellMutationSchema=z.object({
  address:z.string().regex(/^[A-Z]{1,3}[1-9][0-9]{0,6}$/),
  value:Scalar.optional(),formula:z.string().min(1).optional(),
  type:z.string().optional(),format:z.string().optional(),
}).refine(cell=>cell.value!==undefined||cell.formula!==undefined||cell.format!==undefined,
  "cell needs a value, formula, or format");
export const SpreadsheetOverlaySchema=z.object({
  kind:z.literal("spreadsheet").optional(),
  sheets:z.array(z.object({
    name:z.string().min(1).max(31),
    cells:z.array(SpreadsheetCellMutationSchema).min(1),
    rows:z.unknown().optional(),
  })).min(1),
});
export type SpreadsheetOverlay=z.infer<typeof SpreadsheetOverlaySchema>;

type SourceFile={name:string;extension:string;mimeType:string};
function sheetRange(ws:WorkSheet,address:string,xlsx:typeof import("xlsx")){
  const cell=xlsx.utils.decode_cell(address);
  if(cell.c>=16_384||cell.r>=1_048_576)throw new Error("单元格超出 Excel 容量："+address);
  const range=ws["!ref"]?xlsx.utils.decode_range(ws["!ref"]!):{s:{...cell},e:{...cell}};
  range.s.r=Math.min(range.s.r,cell.r);range.s.c=Math.min(range.s.c,cell.c);
  range.e.r=Math.max(range.e.r,cell.r);range.e.c=Math.max(range.e.c,cell.c);
  ws["!ref"]=xlsx.utils.encode_range(range);
}
function valueFingerprint(cell:CellObject|undefined){
  return JSON.stringify({v:cell?.v??null,f:cell?.f??null,t:cell?.t??null,z:cell?.z??null});
}
export async function renderSpreadsheetOverlay(source:SourceFile,blueprintText:string,original:Blob){
  const xlsx=await import("xlsx");
  let parsed:unknown;
  try{parsed=JSON.parse(blueprintText);}catch{throw new Error("Spreadsheet Candidate 必须是合法的 Sheet/Cell JSON 修改方案。");}
  const blueprint=SpreadsheetOverlaySchema.safeParse(parsed);
  if(!blueprint.success)throw new Error("Spreadsheet Candidate 缺少真实 Sheet/cells 修改指令；不能使用截断表格或虚构单元格。");
  const ext=source.extension.toLowerCase();
  const delimited=ext==="csv"||ext==="tsv";
  const workbook=delimited
    ?xlsx.read(await original.text(),{type:"string",raw:true,FS:ext==="tsv"?"\t":","})
    :xlsx.read(await original.arrayBuffer(),{type:"array",cellFormula:true,cellStyles:true,cellDates:true,bookVBA:true});
  if(!workbook.SheetNames.length)throw new Error("原表格没有可读取的工作表。");
  const originals=new Map(workbook.SheetNames.map(name=>[
    name,new Map(Object.entries(workbook.Sheets[name]??{})
      .filter(([address])=>!address.startsWith("!"))
      .map(([address,cell])=>[address,{...cell as CellObject}]))
  ]));
  const affected=new Set<string>();
  let realChanges=0;
  for(const sheet of blueprint.data.sheets){
    if(sheet.rows!==undefined)throw new Error("不能用只展示部分数据的 rows 覆盖原表格，请用 cells 精确定位修改。");
    const sheetName=delimited?workbook.SheetNames[0]!:sheet.name;
    if(delimited&&sheet.name!==sheetName)throw new Error("CSV/TSV 目标工作表名称不匹配："+sheet.name);
    const ws=workbook.Sheets[sheetName];
    if(!ws)throw new Error("原文件不存在工作表："+sheet.name+"；新增 Sheet 需独立授权。");
    for(const cell of sheet.cells){
      const key=sheetName+"!"+cell.address;
      if(affected.has(key))throw new Error("重复的单元格修改："+key);
      affected.add(key);
      const coordinate=xlsx.utils.decode_cell(cell.address);
      if(coordinate.r>=1_048_576||coordinate.c>=16_384)throw new Error("无效单元格位置："+key);
      if(delimited&&cell.formula!==undefined)throw new Error("CSV/TSV 不能保存可执行公式；请改为独立核验的数值。");
      if(cell.formula!==undefined&&cell.value!==undefined)throw new Error("公式缓存不能由 AI 猜测，请只写公式并由 Office 重算验收。");
      const prior=ws[cell.address] as CellObject|undefined;
      const next:CellObject={...(prior??{}),t:prior?.t??"z"};
      if(cell.formula!==undefined){
        if(prior?.f!==cell.formula){
          // SheetJS 0.18 silently drops formula-only cells without a cached v.
          // An empty *string* cache preserves the formula without pretending
          // the spreadsheet engine computed a numeric result (0 is NOT safe).
          next.v="";
          next.t="s";
        }
        next.f=cell.formula;
        if(!cell.type&&prior?.f===cell.formula)next.t=prior?.t??"n";
      }
      if(cell.value!==undefined){
        if(cell.value===null){delete next.v;next.t="z";}
        else{
          next.v=cell.value as CellObject["v"];
          if(!cell.type)next.t=typeof cell.value==="number"?"n":typeof cell.value==="boolean"?"b":"s";
        }
        if(cell.formula===undefined)delete next.f; // explicit value replaces formula
      }
      if(cell.type&&!(cell.formula!==undefined&&prior?.f!==cell.formula))next.t=cell.type as CellObject["t"];
      if(cell.format)next.z=cell.format;
      if(valueFingerprint(prior)!==valueFingerprint(next))realChanges++;
      ws[cell.address]=next;
      sheetRange(ws,cell.address,xlsx);
    }
  }
  if(!realChanges)throw new Error("Spreadsheet 修改方案没有产生真实单元格/公式变化，禁止伪造进化。");
  const data=delimited
    ?xlsx.utils.sheet_to_csv(workbook.Sheets[workbook.SheetNames[0]!]!,{FS:ext==="tsv"?"\t":","})
    :xlsx.write(workbook,{type:"array",bookType:(ext==="xls"?"xls":ext==="ods"?"ods":"xlsx"),bookVBA:true});
  const blob=typeof data==="string"
    ?new Blob([data],{type:ext==="tsv"?"text/tab-separated-values":"text/csv"})
    :new Blob([data],{type:source.mimeType||"application/octet-stream"});
  const reopened=delimited
    ?xlsx.read(await blob.text(),{type:"string",raw:true,FS:ext==="tsv"?"\t":","})
    :xlsx.read(await blob.arrayBuffer(),{type:"array",cellFormula:true,cellDates:true});
  for(const name of workbook.SheetNames){
    if(!reopened.SheetNames.includes(name))throw new Error("导出丢失工作表："+name);
    const after=reopened.Sheets[name];
    for(const [address,prior] of originals.get(name)??[]){
      if(affected.has(name+"!"+address))continue;
      const current=after?.[address] as CellObject|undefined;
      const unchanged=delimited
        ?String(prior.v??"")===String(current?.v??"")
        :prior.v===current?.v&&prior.f===current?.f;
      if(!unchanged)throw new Error("原始单元格内容丢失："+name+"!"+address);
    }
  }
  return {blob,
    note:delimited?"基于原 CSV/TSV 全表，仅精确修改指定单元格；其他字段逐项回读核对。"
      :"基于原工作簿回写指定 Sheet/Cell/Formula，未修改数据逐项回读核对；公式需真实 Office 重算。"};
}
