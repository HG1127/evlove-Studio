import {parse,type DefaultTreeAdapterTypes} from "parse5";

type Node=DefaultTreeAdapterTypes.Node;
type Element=DefaultTreeAdapterTypes.Element;
type Slot={key:string;section:string;end:number;rawCode:string;text:string;paragraphs:number};
export const HTML_TOOL_TEXT_PROJECTION_POLICY="known-tool-card-code-text-projection-v1";
const attr=(node:Element,name:string)=>node.attrs.find(a=>a.name===name)?.value;
const cls=(node:Element,name:string)=>attr(node,"class")?.split(/\s+/).includes(name);
const excluded=new Set(["head","script","style","template","noscript","svg"]);
function slots(html:string){
  const rows:Slot[]=[],sections=new Set<string>();let valid=true,body=false;
  const grids=(node:Node):Element[]=>"tagName" in node&&excluded.has(node.tagName)?[]:
    "tagName" in node&&cls(node,"mini-grid")?[node]:"childNodes" in node?node.childNodes.flatMap(grids):[];
  const countParagraphs=(node:Node):number=>"tagName" in node&&excluded.has(node.tagName)?0:
    ("tagName" in node&&node.tagName==="p"?1:0)+("childNodes" in node?node.childNodes.reduce((n,c)=>n+countParagraphs(c),0):0);
  const visit=(node:Node,section="",toolBody=false)=>{
    if("tagName" in node){
      if(excluded.has(node.tagName))return;
      if(["a","button","input","textarea","select","label"].includes(node.tagName)||node.attrs.some(a=>/^on/i.test(a.name)||a.name==="contenteditable"&&a.value!=="false"))return;
      if(node.tagName==="body")body=Boolean(node.sourceCodeLocation?.startTag&&node.sourceCodeLocation.endTag);
      if(node.tagName==="article"){
        section=attr(node,"id")??"";toolBody=false;
        if(sections.has(section))valid=false;sections.add(section);
        if(!cls(node,"slide-card")||attr(node,"data-kind")!=="tool"||!/^slide-\d+$/.test(section))section="";
      }
      if(section&&cls(node,"slide-body")){
        const groups=grids(node);toolBody=!(groups.length>=3&&groups.every(g=>cls(g,"cols-3")));
      }
      if(toolBody&&section&&cls(node,"mini-card")&&node.parentNode&&"tagName" in node.parentNode&&cls(node.parentNode,"mini-grid")){
        // Only a physical, noninteractive code-only card. Other layouts remain unmodified.
        const children=node.childNodes.filter(n=>!(n.nodeName==="#text"&&"value" in n&&!n.value.trim()));
        const pre=children.length===1?children[0]:undefined;
        const code=pre&&"tagName" in pre&&pre.tagName==="pre"&&cls(pre,"code-block")&&pre.attrs.length===1&&pre.childNodes.length===1?pre.childNodes[0]:undefined;
        const loc=node.sourceCodeLocation,codeLoc=pre?.sourceCodeLocation;
        if(code&&"tagName" in code&&code.tagName==="code"&&!code.attrs.length&&code.childNodes.every(c=>c.nodeName==="#text")
          &&node.attrs.length===1&&attr(node,"class")==="mini-card"&&loc?.endTag&&codeLoc){
          const text=code.childNodes.map(c=>"value" in c?c.value:"").join("");
          // The known renderer interpolates paragraph text into HTML: never project markup into it.
          if(text.trim()&&!/[<>]/.test(text)&&text.length<=240)rows.push({key:section+":"+html.slice(codeLoc.startOffset,codeLoc.endOffset),section,end:loc.endTag.startOffset,
            rawCode:html.slice(codeLoc.startOffset,codeLoc.endOffset),text,paragraphs:countParagraphs(node)});
        }
      }
    }
    if("childNodes" in node)node.childNodes.forEach(child=>visit(child,section,toolBody));
  };
  visit(parse(html,{sourceCodeLocationInfo:true}));return valid&&body?rows:[];
}
const escaped=(value:string)=>value.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");

/** Adapter must first bind the known renderer. Add one text slot; preserve every existing byte. */
export function projectHtmlToolCodeText(originalHtml:string,subjectHtml:string){
  const unchanged={html:subjectHtml,projectedToolCardIds:[] as string[]};
  if(originalHtml===subjectHtml)return unchanged;
  const source=slots(originalHtml),target=slots(subjectHtml),edits:Slot[]=[];
  for(const row of target){
    if(row.paragraphs||source.filter(s=>s.key===row.key&&s.rawCode===row.rawCode&&!s.paragraphs).length!==1||target.filter(s=>s.key===row.key).length!==1)continue;
    edits.push(row);
  }
  let html=subjectHtml;
  for(const edit of edits.sort((a,b)=>b.end-a.end))html=html.slice(0,edit.end)+"<p>"+escaped(edit.text)+"</p>"+html.slice(edit.end);
  return {html,projectedToolCardIds:[...new Set(edits.map(e=>e.section))]};
}
