import {parse,type DefaultTreeAdapterTypes} from "parse5";

const POLICY="original-text-with-numbered-instruction-append-v1" as const;
type Block={tag:string;text:string;anchor:string;declaredCode:boolean};
const text=(node:DefaultTreeAdapterTypes.Node):string=>node.nodeName==="#text"&&"value" in node?node.value
  :"childNodes" in node?node.childNodes.map(text).join(""):"";
const declaresCode=(node:DefaultTreeAdapterTypes.Node):boolean=>"tagName" in node&&["pre","code"].includes(node.tagName)
  &&node.attrs.some(attr=>attr.name==="class"&&attr.value.split(/\s+/).some(value=>/^language-/i.test(value)&&!/^language-(?:text|plaintext)$/i.test(value))
    ||["lang","type"].includes(attr.name)&&!/^text(?:\/plain)?$/i.test(attr.value));
const typedDescendant=(node:DefaultTreeAdapterTypes.Node):boolean=>declaresCode(node)
  ||"childNodes" in node&&node.childNodes.some(typedDescendant);

function blocks(html:string){
  const result:Block[]=[];
  const visit=(node:DefaultTreeAdapterTypes.Node,anchor:string,declaredCode:boolean)=>{
    if("tagName" in node){
      anchor=node.attrs.find(attr=>attr.name==="id")?.value??anchor;
      declaredCode=declaredCode||declaresCode(node)||(node.tagName==="pre"&&typedDescendant(node));
      if(node.tagName==="pre"||node.tagName==="code")result.push({tag:node.tagName,text:text(node),anchor,declaredCode});
    }
    if("childNodes" in node)for(const child of node.childNodes)visit(child,anchor,declaredCode);
    if("content" in node&&node.content)visit(node.content,anchor,declaredCode);
  };
  visit(parse(html),"",false);return result;
}

const prose=(value:string)=>/\p{L}/u.test(value)&&!/[<>{};=()[\]`\\]/.test(value);
function numberedInstructions(value:string){
  const lines=value.split("\n");
  if(lines.length<2||lines.some(line=>!prose(line)))return false;
  const steps=lines.map(line=>/^(\d+)[.、]\s+\p{L}/u.exec(line));
  return steps.every(Boolean)&&steps.every((step,index)=>index===0||Number(step![1])===Number(steps[index-1]![1])+1);
}

/** Exact original text must survive. Only an untyped numbered prose list can gain trailing prose. */
export function htmlNativeCodeRetention(originalHtml:string,subjectHtml:string){
  const original=blocks(originalHtml),subject=blocks(subjectHtml);
  let cursor=0,exactCount=0,extendedInstructionCount=0;
  for(const source of original){
    for(let index=cursor;index<subject.length;index++){
      const next=subject[index]!;
      if(next.tag!==source.tag)continue;
      const exact=next.text===source.text;
      const suffix=next.text.slice(source.text.length);
      const extended=!exact&&!source.declaredCode&&!next.declaredCode&&source.anchor.length>0&&source.anchor===next.anchor
        &&numberedInstructions(source.text)&&next.text.startsWith(source.text+"\n")
        &&suffix.slice(1).split("\n").every(line=>line.trim().length>0&&prose(line));
      if(!exact&&!extended)continue;
      if(exact)exactCount++;else extendedInstructionCount++;
      cursor=index+1;break;
    }
  }
  const retainedCount=exactCount+extendedInstructionCount;
  return {policy:POLICY,originalCount:original.length,retainedCount,exactCount,extendedInstructionCount,
    retained:retainedCount===original.length};
}

export class HtmlOriginalCodeRetentionError extends Error {
  readonly code="HTML_ORIGINAL_CODE_RETENTION_FAILED";
  readonly retention:ReturnType<typeof htmlNativeCodeRetention>;
  constructor(retention:ReturnType<typeof htmlNativeCodeRetention>){
    super(`原始代码／指令块未按既有策略保留：${retention.retainedCount}/${retention.originalCount}`);
    this.name="HtmlOriginalCodeRetentionError";this.retention=retention;
  }
}

/** Construction preflight only; the same unchanged policy remains required in native validation. */
export function assertHtmlOriginalCodeRetention(originalHtml:string,subjectHtml:string){
  const retention=htmlNativeCodeRetention(originalHtml,subjectHtml);
  if(!retention.retained)throw new HtmlOriginalCodeRetentionError(retention);
  return retention;
}
