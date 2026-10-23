import {parse,type DefaultTreeAdapterTypes} from "parse5";

export const HTML_READABLE_BODY_VERSION="html-readable-body-v1";
const excluded=new Set(["head","script","style","template","svg","noscript"]);
const blocks=new Set(["article","section","div","p","li","ul","ol","pre","blockquote","table","tr","h1","h2","h3","h4","h5","h6"]);

/** Source-order body text with logical boundaries; it never executes or emits raw code/style markup. */
export function htmlReadableBody(html:string){
  const document=parse(html,{sourceCodeLocationInfo:true});
  let body:DefaultTreeAdapterTypes.Element|undefined;
  const find=(node:DefaultTreeAdapterTypes.Node)=>{
    if("tagName" in node&&node.tagName==="body")body=node;
    if("childNodes" in node)for(const child of node.childNodes)find(child);
  };
  find(document);
  if(!body?.sourceCodeLocation?.startTag||!body.sourceCodeLocation.endTag)return undefined;
  const textOf=(node:DefaultTreeAdapterTypes.Node):string=>{
    if("tagName" in node&&excluded.has(node.tagName))return "";
    if(node.nodeName==="#text"&&"value" in node)return node.value;
    return "childNodes" in node?node.childNodes.map(textOf).join(""):"";
  };
  const pieces:Array<{text:string;preserve:boolean}>=[];
  const emit=(text:string,preserve=false)=>pieces.push({text,preserve});
  const paragraphs:Array<{section:string;role:"card-detail"|"introductory"|"paragraph";chars:number}> = [];
  const cards:Array<{section:string;chars:number}> = [];
  const visit=(node:DefaultTreeAdapterTypes.Node,section="",inCard=false,inIntro=false,inPre=false)=>{
    if("tagName" in node){
      if(excluded.has(node.tagName))return;
      const classes=new Set((node.attrs.find(attr=>attr.name==="class")?.value??"").split(/\s+/));
      if(node.tagName==="article")section=node.attrs.find(attr=>attr.name==="id")?.value??section;
      inCard ||= classes.has("mini-card");inIntro ||= classes.has("content-block");
      if(classes.has("mini-card"))cards.push({section,chars:textOf(node).replace(/\s+/g," ").trim().length});
      if(node.tagName==="p")paragraphs.push({section,role:inCard?"card-detail":inIntro?"introductory":"paragraph",chars:textOf(node).replace(/\s+/g," ").trim().length});
      if(node.tagName==="br"){emit("\n");return;}
      if(node.tagName==="pre"){emit("\n\n");emit(textOf(node),true);emit("\n\n");return;}
      if(blocks.has(node.tagName))emit("\n\n");
      if(/^h[1-6]$/.test(node.tagName))emit(`[${node.tagName.toUpperCase()}] `);
      if(classes.has("mini-card"))emit("[CARD] ");
      if(node.tagName==="li")emit("- ");
      inPre ||= node.tagName==="pre";
    }
    if(node.nodeName==="#text"&&"value" in node)emit(inPre?node.value:node.value.replace(/\s+/g," "));
    if("childNodes" in node)for(const child of node.childNodes)visit(child,section,inCard,inIntro,inPre);
    if("tagName" in node&&blocks.has(node.tagName))emit("\n\n");
  };
  visit(body);
  const parts:Array<{text:string;preserve:boolean}>=[];
  let ordinary="";
  const flush=()=>{parts.push({text:ordinary.replace(/[ \t]+\n/g,"\n").replace(/\n[ \t]+/g,"\n").replace(/\n{3,}/g,"\n\n"),preserve:false});ordinary="";};
  for(const piece of pieces){if(piece.preserve){flush();parts.push(piece);}else ordinary+=piece.text;}
  flush();
  if(parts[0]&&!parts[0].preserve)parts[0].text=parts[0].text.trimStart();
  if(parts.at(-1)&&!parts.at(-1)!.preserve)parts.at(-1)!.text=parts.at(-1)!.text.trimEnd();
  const text=parts.map(part=>part.text).join("");
  const sections=[...new Set([...paragraphs,...cards].map(row=>row.section))].filter(Boolean).map(section=>{
    const intro=paragraphs.filter(row=>row.section===section&&row.role==="introductory");
    const details=paragraphs.filter(row=>row.section===section&&row.role==="card-detail");
    return {section,introductoryChars:intro.reduce((n,row)=>n+row.chars,0),longestIntroductoryParagraph:Math.max(0,...intro.map(row=>row.chars)),
      cardCount:cards.filter(row=>row.section===section).length,cardDetailChars:details.reduce((n,row)=>n+row.chars,0)};
  });
  return {version:HTML_READABLE_BODY_VERSION,text,facts:{paragraphCount:paragraphs.length,cardCount:cards.length,
    largestParagraphs:[...paragraphs].sort((a,b)=>b.chars-a.chars).slice(0,12),
    sectionsWithLargestIntroductions:sections.sort((a,b)=>b.longestIntroductoryParagraph-a.longestIntroductoryParagraph).slice(0,12)},
    limitations:["Logical source structure and text allocation only; computed layout, visual quality, user comprehension and business benefit are not established."]};
}
