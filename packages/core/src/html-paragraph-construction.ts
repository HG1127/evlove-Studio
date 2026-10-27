import {parse,type DefaultTreeAdapterTypes} from "parse5";

/** A construction budget for new prose in the known SOP renderer, not a UX verdict. */
export const HTML_PARAGRAPH_CONSTRUCTION_POLICY={version:"known-sop-paragraph-budget-v1",maxChangedParagraphChars:240} as const;
type Row={section:string;role:"introductory"|"card-detail"|"paragraph";text:string};
type Issue=Omit<Row,"text">&{chars:number;maxChars:number};
const hasClass=(node:DefaultTreeAdapterTypes.Element,name:string)=>node.attrs.some(a=>a.name==="class"&&a.value.split(/\s+/).includes(name));
const text=(node:DefaultTreeAdapterTypes.Node):string=>node.nodeName==="#text"&&"value" in node?node.value:
  "tagName" in node&&["script","style","template","noscript"].includes(node.tagName)?"":"childNodes" in node?node.childNodes.map(text).join(""):"";
function rows(html:string){
  const found:Row[]=[];
  const visit=(node:DefaultTreeAdapterTypes.Node,section="",inSlideBody=false,inCard=false,inBlock=false)=>{
    if("tagName" in node){
      if(["head","script","style","template","noscript"].includes(node.tagName))return;
      if(node.tagName==="article"&&hasClass(node,"slide-card")){
        section=node.attrs.find(a=>a.name==="id")?.value??"";inSlideBody=false;inCard=false;inBlock=false;
      }
      inSlideBody=inSlideBody||hasClass(node,"slide-body");
      inCard=inCard||hasClass(node,"mini-card");inBlock=inBlock||hasClass(node,"content-block");
      if(/^slide-\d+$/.test(section)&&inSlideBody&&node.tagName==="p")found.push({section,
        role:inCard?"card-detail":inBlock?"introductory":"paragraph",text:text(node).replace(/\s+/g," ").trim()});
    }
    if("childNodes" in node)node.childNodes.forEach(child=>visit(child,section,inSlideBody,inCard,inBlock));
  };
  visit(parse(html));return found;
}

export class HtmlParagraphConstructionError extends Error{
  readonly code="HTML_PARAGRAPH_CONSTRUCTION_BUDGET_EXCEEDED";
  readonly policy=HTML_PARAGRAPH_CONSTRUCTION_POLICY;
  readonly issues:Issue[];
  constructor(issues:Issue[]){
    super("New or edited known-SOP paragraphs exceed the declared construction budget");this.name="HtmlParagraphConstructionError";this.issues=issues;
  }
}

/** Static body-text projection only. Never splits/truncates prose or claims rendered readability. */
export function assertHtmlParagraphConstruction(originalHtml:string,subjectHtml:string){
  const original=rows(originalHtml),subject=rows(subjectHtml),unchanged=new Map<string,number>();
  for(const row of original){const key=JSON.stringify(row);unchanged.set(key,(unchanged.get(key)??0)+1);}
  const changed=subject.filter(row=>{
    const key=JSON.stringify(row),remaining=unchanged.get(key)??0;
    if(!remaining)return true;
    unchanged.set(key,remaining-1);return false;
  });
  const issues=changed.filter(row=>row.text.length>HTML_PARAGRAPH_CONSTRUCTION_POLICY.maxChangedParagraphChars)
    .map(({section,role,text})=>({section,role,chars:text.length,maxChars:HTML_PARAGRAPH_CONSTRUCTION_POLICY.maxChangedParagraphChars}));
  if(issues.length)throw new HtmlParagraphConstructionError(issues);
  return {policy:HTML_PARAGRAPH_CONSTRUCTION_POLICY.version,checkedParagraphs:changed.length};
}
