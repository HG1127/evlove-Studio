import {parse,type DefaultTreeAdapterTypes} from "parse5";
import {HtmlBodyParagraphSchema} from "@evolution/contracts";

/** A construction budget for new prose in the known SOP renderer, not a UX verdict. */
export const HTML_PARAGRAPH_CONSTRUCTION_POLICY={version:"known-sop-paragraph-budget-v1",maxChangedParagraphChars:240} as const;
type Row={section:string;role:"introductory"|"card-detail"|"paragraph";text:string;paragraphIndex:number;start?:number;end?:number};
type Issue=Pick<Row,"section"|"role">&{chars:number;maxChars:number;paragraphIndex?:number;textExcerpt?:string};
const hasClass=(node:DefaultTreeAdapterTypes.Element,name:string)=>node.attrs.some(a=>a.name==="class"&&a.value.split(/\s+/).includes(name));
const text=(node:DefaultTreeAdapterTypes.Node):string=>node.nodeName==="#text"&&"value" in node?node.value:
  "tagName" in node&&["script","style","template","noscript"].includes(node.tagName)?"":"childNodes" in node?node.childNodes.map(text).join(""):"";
function rows(html:string,physical=false){
  const found:Row[]=[];
  const counts=new Map<string,number>();
  const visit=(node:DefaultTreeAdapterTypes.Node,section="",inSlideBody=false,inCard=false,inBlock=false)=>{
    if("tagName" in node){
      if(["head","script","style","template","noscript"].includes(node.tagName))return;
      if(node.tagName==="article"&&hasClass(node,"slide-card")){
        section=node.attrs.find(a=>a.name==="id")?.value??"";inSlideBody=false;inCard=false;inBlock=false;
      }
      inSlideBody=inSlideBody||hasClass(node,"slide-body");
      inCard=inCard||hasClass(node,"mini-card");inBlock=inBlock||hasClass(node,"content-block");
      if(/^slide-\d+$/.test(section)&&inSlideBody&&node.tagName==="p"){
        const paragraphIndex=(counts.get(section)??0)+1;counts.set(section,paragraphIndex);
        const loc=node.sourceCodeLocation;
        if(physical&&!loc)throw new Error("Complete paragraph context requires physical paragraph locations");
        found.push({section,paragraphIndex,role:inCard?"card-detail":inBlock?"introductory":"paragraph",
          text:text(node).replace(/\s+/g," ").trim(),...(physical?{start:loc!.startOffset,end:loc!.endOffset}:{})});
      }
    }
    if("childNodes" in node)node.childNodes.forEach(child=>visit(child,section,inSlideBody,inCard,inBlock));
  };
  visit(parse(html,{sourceCodeLocationInfo:physical}));return found;
}

/** Supplement complete body anchors where inline nodes obscure the whole paragraph; no extra edit permission. */
export function htmlParagraphConstructionContext(html:string,parentSha256:string,anchors:ReadonlyArray<{anchorId:string;start:number;end:number;element:string}>){
  if(!/^[a-f0-9]{64}$/.test(parentSha256))throw new Error("Paragraph context needs the complete parent SHA-256");
  if(anchors.some(a=>a.anchorId!==`t${a.start.toString(36)}_${a.end.toString(36)}-${parentSha256.slice(0,16)}`))throw new Error("Paragraph anchors differ from the bound physical parent");
  const paragraphs=HtmlBodyParagraphSchema.array().max(4096).parse(rows(html,true).flatMap(row=>{
    const members=anchors.filter(a=>a.start>=row.start!&&a.end<=row.end!);
    if(members.length===0||members.length===1&&members[0]!.element==="p")return [];
    return [{section:row.section,paragraphIndex:row.paragraphIndex,role:row.role,text:row.text,chars:row.text.length,anchorIds:members.map(a=>a.anchorId)}];
  }));
  const size=JSON.stringify(paragraphs).length;
  if(size>160_000)throw new Error(`Complete HTML paragraph grouping supplement exceeds capacity (${size} characters); no groups were truncated`);
  return paragraphs;
}

export class HtmlParagraphConstructionError extends Error{
  readonly code="HTML_PARAGRAPH_CONSTRUCTION_BUDGET_EXCEEDED";
  readonly policy=HTML_PARAGRAPH_CONSTRUCTION_POLICY;
  readonly issues:Issue[];
  constructor(issues:Issue[]){
    const locations=issues.slice(0,5).map(i=>`${i.section.slice(0,80)} paragraph ${i.paragraphIndex??"?"}: ${i.chars}/${i.maxChars}`).join("; ");
    super("New or edited known-SOP paragraphs exceed the declared construction budget"+(locations?": "+locations:"")
      +(issues.length>5?`; ${issues.length-5} more paragraphs`:""));
    this.name="HtmlParagraphConstructionError";this.issues=issues;
  }
}

/** Static body-text projection only. Never splits/truncates prose or claims rendered readability. */
export function assertHtmlParagraphConstruction(originalHtml:string,subjectHtml:string){
  const original=rows(originalHtml),subject=rows(subjectHtml),unchanged=new Map<string,number>();
  const keyOf=({section,role,text}:Row)=>JSON.stringify({section,role,text});
  for(const row of original){const key=keyOf(row);unchanged.set(key,(unchanged.get(key)??0)+1);}
  const changed=subject.filter(row=>{
    const key=keyOf(row),remaining=unchanged.get(key)??0;
    if(!remaining)return true;
    unchanged.set(key,remaining-1);return false;
  });
  const issues=changed.filter(row=>row.text.length>HTML_PARAGRAPH_CONSTRUCTION_POLICY.maxChangedParagraphChars)
    .map(({section,role,text,paragraphIndex})=>({section,role,paragraphIndex,textExcerpt:text.slice(0,320),chars:text.length,maxChars:HTML_PARAGRAPH_CONSTRUCTION_POLICY.maxChangedParagraphChars}));
  if(issues.length)throw new HtmlParagraphConstructionError(issues);
  return {policy:HTML_PARAGRAPH_CONSTRUCTION_POLICY.version,checkedParagraphs:changed.length};
}
