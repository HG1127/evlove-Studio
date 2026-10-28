import {parse,type DefaultTreeAdapterTypes} from "parse5";

export const HTML_NUMBERED_LIST_CONSTRUCTION_POLICY={version:"known-sop-numbered-list-coherence-v1"} as const;
type Group={section:string;listIndex:number;texts:string[]};
type Issue={section:string;listIndex:number;itemIndex:number;expectedNumber:number;observedNumber?:number};
type ListShape={listIndex:number;itemCount:number;prefixNumbers:Array<number|null>;emptyItemIndexes:number[]};
type ListContext={schemaVersion:"numbered-list-construction-context-v1";groups:Array<ListShape&{section:string;originalSourceLists:ListShape[]}>;omittedGroupCount:number;numberHintsAreNotRenumberingTargets:true};
const omitted=new Set(["head","script","style","template","noscript","pre","code"]);
const text=(node:DefaultTreeAdapterTypes.Node):string=>"tagName" in node&&omitted.has(node.tagName)?"":
  node.nodeName==="#text"&&"value" in node?node.value:"childNodes" in node?node.childNodes.filter(n=>!("tagName" in n&&["ul","ol"].includes(n.tagName))).map(text).join(""):"";
function groups(html:string){
  const result:Group[]=[],counts=new Map<string,number>();
  const visit=(node:DefaultTreeAdapterTypes.Node,section="")=>{
    if("tagName" in node){
      if(omitted.has(node.tagName))return;
      if(node.tagName==="article")section=node.attrs.find(a=>a.name==="id")?.value??section;
      if(node.tagName==="ul"||node.tagName==="ol"){
        const listIndex=(counts.get(section)??0)+1;counts.set(section,listIndex);
        const texts=node.childNodes.filter(n=>"tagName" in n&&n.tagName==="li").map(n=>text(n).replace(/\s+/g," ").trim());
        if(texts.length>=2)result.push({section,listIndex,texts});
      }
    }
    if("childNodes" in node)node.childNodes.forEach(n=>visit(n,section));
  };
  visit(parse(html));return result;
}
const ordinal=(value:string)=>{const match=value.match(/^(?:步骤\s*)?(\d{1,3})(?:[.．](?!\d)\s*|[、)）:：]\s*|\s+|$)/u);return match?Number(match[1]):undefined;};
const shape=(group:Group):ListShape=>({listIndex:group.listIndex,itemCount:group.texts.length,prefixNumbers:group.texts.map(t=>ordinal(t)??null),emptyItemIndexes:group.texts.flatMap((t,i)=>t?[]:[i+1])});
function listContext(failed:Group[],original:Group[]):ListContext{
  const result:ListContext={schemaVersion:"numbered-list-construction-context-v1",groups:[],omittedGroupCount:failed.length,numberHintsAreNotRenumberingTargets:true};
  for(const group of failed){
    if(result.groups.length>=8)break;
    const row={section:group.section,...shape(group),originalSourceLists:original.filter(g=>g.section===group.section).map(shape)};
    const proposed={...result,groups:[...result.groups,row],omittedGroupCount:result.omittedGroupCount-1};
    if(JSON.stringify(proposed).length<=20000)Object.assign(result,proposed);
  }
  return result;
}

export class HtmlNumberedListConstructionError extends Error{
  readonly code="HTML_NUMBERED_LIST_INCOHERENT";
  readonly policy=HTML_NUMBERED_LIST_CONSTRUCTION_POLICY;
  readonly issues:Issue[];
  readonly listContext?:ListContext;
  constructor(issues:Issue[],context?:ListContext){
    super("Changed numbered instruction list is not consecutive: "+issues.slice(0,5).map(i=>`${i.section||"body"} list ${i.listIndex} item ${i.itemIndex}: inferred sequence ${i.expectedNumber}, observed ${i.observedNumber??"missing"}`).join("; "));
    this.name="HtmlNumberedListConstructionError";this.issues=issues;this.listContext=context;
  }
}

/** Static construction only. Does not renumber, delete checks or infer semantic preservation. */
export function assertHtmlNumberedListConstruction(originalHtml:string,subjectHtml:string){
  const unchanged=new Map<string,number>(),key=(g:Group)=>JSON.stringify([g.section,g.texts]);
  const originalGroups=groups(originalHtml);
  for(const group of originalGroups){const k=key(group);unchanged.set(k,(unchanged.get(k)??0)+1);}
  const issues:Issue[]=[],failedGroups:Group[]=[];let checkedLists=0;
  for(const group of groups(subjectHtml)){
    const k=key(group),remaining=unchanged.get(k)??0;
    if(remaining){unchanged.set(k,remaining-1);continue;}
    const numbers=group.texts.map(ordinal),first=numbers.findIndex(n=>n!==undefined);
    if(first===-1)continue; // Normal bullets and native <ol> markers are outside this text-prefix check.
    checkedLists++;const start=numbers[first]!-first,beforeCount=issues.length;
    numbers.forEach((number,index)=>{if(start<0||number!==start+index)issues.push({section:group.section,listIndex:group.listIndex,itemIndex:index+1,expectedNumber:start+index,observedNumber:number});});
    if(issues.length>beforeCount)failedGroups.push(group);
  }
  if(issues.length)throw new HtmlNumberedListConstructionError(issues,listContext(failedGroups,originalGroups));
  return {policy:HTML_NUMBERED_LIST_CONSTRUCTION_POLICY.version,checkedLists};
}
