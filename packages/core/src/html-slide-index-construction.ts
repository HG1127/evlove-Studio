import {parse,type DefaultTreeAdapterTypes} from "parse5";

export const HTML_SLIDE_INDEX_CONSTRUCTION_POLICY="known-sop-slide-index-retention-v1";
type Node=DefaultTreeAdapterTypes.Node;
type Issue={section:string;expectedIndex:string;observedIndexes:string[];observedIndexCount:number};
const omitted=new Set(["head","script","style","template","noscript","pre","code"]);
const hasClass=(n:DefaultTreeAdapterTypes.Element,name:string)=>n.attrs.some(a=>a.name==="class"&&a.value.split(/\s+/u).includes(name));
function text(node:Node){
 const pending=[node],parts:string[]=[];
 while(pending.length){const n=pending.pop()!;
  if("tagName" in n&&omitted.has(n.tagName))continue;
  if(n.nodeName==="#text"&&"value" in n)parts.push(n.value);
  else if("childNodes" in n)for(let i=n.childNodes.length-1;i>=0;i--)pending.push(n.childNodes[i]!);
 }
 return parts.join("");
}
function cards(html:string){
 const indexes=new Map<string,string[]>(),duplicates=new Set<string>();let invalid=false;
 const pending:Array<{node:Node;section?:string}>=[{node:parse(html,{scriptingEnabled:false})}];
 while(pending.length){const current=pending.pop()!,node=current.node;let section=current.section;
  if("tagName" in node){
   if(omitted.has(node.tagName))continue;
   if(node.tagName==="article"&&hasClass(node,"slide-card")){
    const id=node.attrs.find(a=>a.name==="id")?.value;
    if(!id||section){invalid=true;continue;}
    if(indexes.has(id)){duplicates.add(id);continue;}
    section=id;indexes.set(id,[]);
   }
   if(section&&hasClass(node,"slide-index"))indexes.get(section)!.push(text(node).replace(/\s+/gu," ").trim());
  }
  if("childNodes" in node)for(let i=node.childNodes.length-1;i>=0;i--)pending.push({node:node.childNodes[i]!,section});
 }
 return {indexes,duplicates,invalid};
}

export class HtmlSlideIndexConstructionError extends Error{
 readonly code="HTML_SLIDE_INDEX_RETENTION_FAILED";
 readonly policy=HTML_SLIDE_INDEX_CONSTRUCTION_POLICY;
 readonly issues:Issue[];
 constructor(issues:Issue[]){
  super("Original slide index labels must stay bound to the same card: "+issues.slice(0,5).map(i=>i.section).join(", "));
  this.name="HtmlSlideIndexConstructionError";this.issues=issues;
 }
}

/** Preserve unambiguous numeric Original labels during construction; no rendering or semantic verdict. */
export function assertHtmlSlideIndexConstruction(originalHtml:string,subjectHtml:string){
 const original=cards(originalHtml),subject=cards(subjectHtml);
 const unsupported=original.invalid||original.duplicates.size>0;
 const references=unsupported?[]:[...original.indexes].filter(([,values])=>values.length===1&&/^\d{1,4}$/u.test(values[0]!));
 const issues=references.flatMap(([section,values])=>{
  const observed=subject.indexes.get(section)??[];
  return !subject.invalid&&!subject.duplicates.has(section)&&observed.length===1&&observed[0]===values[0]?[]:
   [{section,expectedIndex:values[0]!,observedIndexes:observed.slice(0,4).map(value=>value.slice(0,32)),observedIndexCount:observed.length}];
 });
 if(issues.length)throw new HtmlSlideIndexConstructionError(issues);
 return {policy:HTML_SLIDE_INDEX_CONSTRUCTION_POLICY,checkedCards:references.length,
  unboundOriginalCards:original.indexes.size-references.length,originalStructureAmbiguous:unsupported};
}
