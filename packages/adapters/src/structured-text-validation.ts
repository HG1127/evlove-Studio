import {z} from "zod";
import {parseAllDocuments} from "yaml";
import {SaxesParser} from "saxes";

const Input=z.object({extension:z.string(),content:z.string().min(1).max(2_000_000)});
/** Syntax only. This never certifies workflow execution, SVG rendering or product behavior. */
export function validateStructuredTextFormat(input:{extension:string;content:string}):string|undefined{
  const ext=input.extension.trim().replace(/^\./,"").toLowerCase();
  if(!["json","jsonl","yaml","yml","xml","svg"].includes(ext))return undefined;
  const {content}=Input.parse(input);
  if(ext==="json"){
    try{JSON.parse(content);}catch{throw Error("JSON 语法解析失败");}
    return "JSON 语法解析通过";
  }
  if(ext==="jsonl"){
    const lines=content.split(/\r?\n/).filter(line=>line.trim());
    if(!lines.length)throw Error("JSONL 没有有效记录");
    for(const [index,line] of lines.entries())try{JSON.parse(line);}catch{
      throw Error("JSONL 第 "+(index+1)+" 条记录无法解析");
    }
    return "JSONL 逐行语法解析通过，共 "+lines.length+" 条记录";
  }
  if(ext==="yaml"||ext==="yml"){
    const docs=parseAllDocuments(content,{strict:true,uniqueKeys:true});
    if(!docs.length||docs.length>100)throw Error("YAML 文档为空或超过解析上限");
    for(const doc of docs){
      if(doc.errors.length)throw Error("YAML 语法解析失败："+doc.errors[0]!.message);
      doc.toJS({maxAliasCount:100});
    }
    return "YAML 语法及别名引用解析通过";
  }
  const parser=new SaxesParser({xmlns:true});
  let root:string|undefined;
  parser.on("error",error=>{throw error;});
  parser.on("doctype",()=>{throw Error("XML/SVG 格式验证不加载 DTD 或外部实体");});
  parser.on("opentag",tag=>{root??=tag.local;});
  parser.write(content).close();
  if(!root||(ext==="svg"&&root!=="svg"))throw Error("XML/SVG 根元素无效");
  return ext.toUpperCase()+" XML 结构、命名空间与实体语法解析通过（不含渲染验证）";
}
