import {parse,type DefaultTreeAdapterTypes} from "parse5";

export const HTML_NUMBERED_LIST_CONSTRUCTION_POLICY={version:"known-sop-numbered-list-coherence-v1"} as const;
type Group={section:string;listIndex:number;texts:string[]};
type Issue={section:string;listIndex:number;itemIndex:number;expectedNumber:number;observedNumber?:number};
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

export class HtmlNumberedListConstructionError extends Error{
  readonly code="HTML_NUMBERED_LIST_INCOHERENT";
  readonly policy=HTML_NUMBERED_LIST_CONSTRUCTION_POLICY;
  readonly issues:Issue[];
  constructor(issues:Issue[]){
    super("Changed numbered instruction list is not consecutive: "+issues.slice(0,5).map(i=>`${i.section||"body"} list ${i.listIndex} item ${i.itemIndex}: expected ${i.expectedNumber}, observed ${i.observedNumber??"missing"}`).join("; "));
    this.name="HtmlNumberedListConstructionError";this.issues=issues;
  }
}

/** Static construction only. Does not renumber, delete checks or infer semantic preservation. */
export function assertHtmlNumberedListConstruction(originalHtml:string,subjectHtml:string){
  const unchanged=new Map<string,number>(),key=(g:Group)=>JSON.stringify([g.section,g.texts]);
  for(const group of groups(originalHtml)){const k=key(group);unchanged.set(k,(unchanged.get(k)??0)+1);}
  const issues:Issue[]=[];let checkedLists=0;
  for(const group of groups(subjectHtml)){
    const k=key(group),remaining=unchanged.get(k)??0;
    if(remaining){unchanged.set(k,remaining-1);continue;}
    const numbers=group.texts.map(ordinal),first=numbers.findIndex(n=>n!==undefined);
    if(first===-1)continue; // Normal bullets and native <ol> markers are outside this text-prefix check.
    checkedLists++;const start=numbers[first]!-first;
    numbers.forEach((number,index)=>{if(start<0||number!==start+index)issues.push({section:group.section,listIndex:group.listIndex,itemIndex:index+1,expectedNumber:start+index,observedNumber:number});});
  }
  if(issues.length)throw new HtmlNumberedListConstructionError(issues);
  return {policy:HTML_NUMBERED_LIST_CONSTRUCTION_POLICY.version,checkedLists};
}
