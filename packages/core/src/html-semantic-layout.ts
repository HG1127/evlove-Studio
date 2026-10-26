import {parse,type DefaultTreeAdapterTypes} from "parse5";
import {HtmlSemanticComponentSchema,HtmlSemanticLayoutIssueSchema} from "@evolution/contracts";

type Node=DefaultTreeAdapterTypes.Node;
type Element=DefaultTreeAdapterTypes.Element;
const classes=(node:Element)=>node.attrs.find(attr=>attr.name==="class")?.value.split(/\s+/)??[];
const text=(node:Node):string=>node.nodeName==="#text"&&"value" in node?node.value:"childNodes" in node?node.childNodes.map(text).join(""):"";
const normalize=(value:string)=>value.replace(/\s+/g,"").trim();
// These tokens belong to the program/style-hash-bound profile. Unknown renderers must not use this policy.
const labels=["非常适合","最适合","优先适合","需要技术负责人介入","需技术负责人介入","建议技术负责人介入",
  "不建议小白单独做","不建议单独做","高风险不建议","禁止事项","红线","禁止","重点提醒","核心结论","关键要点",
  "注意事项","常见错误","易错点","推荐工具","推荐理由"];
const paragraphs=(node:Node):Element[]=>"tagName" in node&&node.tagName==="p"?[node]:"childNodes" in node?node.childNodes.flatMap(paragraphs):[];

function boxes(html:string){
  const found:Array<{section:string;label:string;paragraphs:Element[];box:Element;block:Element}>=[];
  let complete=false;
  const visit=(node:Node,section="",inSlideBody=false)=>{
    if("tagName" in node){
      if(["head","script","style","template","noscript"].includes(node.tagName))return;
      if(node.tagName==="body")complete=Boolean(node.sourceCodeLocation?.startTag&&node.sourceCodeLocation.endTag);
      if(node.tagName==="article"&&classes(node).includes("slide-card")){section=node.attrs.find(attr=>attr.name==="id")?.value??"";inSlideBody=false;}
      if(section&&classes(node).includes("slide-body"))inSlideBody=true;
      const parent=node.parentNode;
      if(inSlideBody&&/^slide-\d+$/.test(section)&&classes(node).includes("text-lines")&&parent&&"tagName" in parent&&classes(parent).includes("content-block")){
        const ps=paragraphs(node),label=(ps[0]?text(ps[0]):"").trim();
        found.push({section,label,paragraphs:ps,box:node,block:parent});
      }
    }
    if("childNodes" in node)for(const child of node.childNodes)visit(child,section,inSlideBody);
  };
  visit(parse(html,{sourceCodeLocationInfo:true}));
  return complete?found:undefined;
}
const eligible=(box:NonNullable<ReturnType<typeof boxes>>[number])=>box.paragraphs.length===2&&labels.some(label=>normalize(box.label).includes(label));
const outsideText=(node:Node,slots:Node[]):string=>slots.includes(node)?"":"childNodes" in node?node.childNodes.map(child=>outsideText(child,slots)).join(""):text(node);

export function htmlKnownSemanticComponents(html:string){
  return (boxes(html)??[]).filter(eligible).map(box=>HtmlSemanticComponentSchema.parse({section:box.section,label:box.label,paragraphCount:2}));
}

export class HtmlSemanticLayoutError extends Error{
  readonly code="HTML_SEMANTIC_LAYOUT_INVALID";
  readonly issues;
  constructor(issues:unknown){
    super("Known HTML renderer components no longer retain their two-paragraph source contract");this.name="HtmlSemanticLayoutError";
    this.issues=HtmlSemanticLayoutIssueSchema.array().min(1).max(1000).parse(issues);
  }
}

/** Pre-freeze structural check only. It never infers computed-style, semantic quality or acceptance success. */
export function assertHtmlKnownSemanticLayout(originalHtml:string,subjectHtml:string){
  const original=boxes(originalHtml),subject=boxes(subjectHtml);
  if(!original||!subject)throw new Error("Known HTML layout requires complete physical body boundaries");
  const issues=[];
  const sourceGroups=new Map<string,typeof original>();
  for(const source of original.filter(eligible)){
    const key=JSON.stringify([source.section,normalize(source.label)]),group=sourceGroups.get(key)??[];
    group.push(source);sourceGroups.set(key,group);
  }
  for(const sources of sourceGroups.values())for(const [index,source] of sources.entries()){
    const targets=subject.filter(box=>box.section===source.section&&normalize(box.label)===normalize(source.label));
    const base={section:source.section,label:source.label,expectedParagraphs:2 as const};
    if(targets.length!==sources.length){if(index===0)issues.push({...base,code:"missing-or-ambiguous-component" as const});continue;}
    const target=targets[index]!;
    if(target.paragraphs.length!==2){issues.push({...base,code:"paragraph-count-changed" as const,actualParagraphs:target.paragraphs.length});continue;}
    // The program discards the whole block and renders only the two paragraph text slots.
    // New text beside those slots would disappear even though the component still gets styled.
    if(normalize(outsideText(source.block,source.paragraphs))!==normalize(outsideText(target.block,target.paragraphs)))
      issues.push({...base,code:"new-content-outside-rendered-slots" as const,actualParagraphs:2});
  }
  if(issues.length)throw new HtmlSemanticLayoutError(issues);
}
