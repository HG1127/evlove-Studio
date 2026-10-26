import {parse,type DefaultTreeAdapterTypes} from "parse5";
import {htmlReadableBody} from "./html-readable-body";

/** Static source-order outline and body text. No script, style or runtime execution. */
export function htmlPlanningDocument(html:string){
  const readable=htmlReadableBody(html);
  if(!readable)return undefined;
  const root=parse(html),articles:DefaultTreeAdapterTypes.Element[]=[],headings:DefaultTreeAdapterTypes.Element[]=[];
  const excluded=new Set(["head","script","style","template","svg","noscript"]);
  const visit=(node:DefaultTreeAdapterTypes.Node)=>{
    if("tagName" in node){
      if(excluded.has(node.tagName))return;
      if(node.tagName==="article")articles.push(node);
      if(/^h[1-6]$/.test(node.tagName))headings.push(node);
    }
    if("childNodes" in node)node.childNodes.forEach(visit);
  };
  visit(root);
  const textOf=(node:DefaultTreeAdapterTypes.Node):string=>{
    if("tagName" in node&&excluded.has(node.tagName))return "";
    if(node.nodeName==="#text"&&"value" in node)return node.value;
    return "childNodes" in node?node.childNodes.map(textOf).join(""):"";
  };
  const firstHeading=(node:DefaultTreeAdapterTypes.Node):DefaultTreeAdapterTypes.Element|undefined=>{
    if("tagName" in node){if(excluded.has(node.tagName))return undefined;if(/^h[1-6]$/.test(node.tagName))return node;}
    if("childNodes" in node)for(const child of node.childNodes){const found=firstHeading(child);if(found)return found;}
    return undefined;
  };
  const outline=(articles.length?articles:headings).map((node,index)=>{
    const heading=firstHeading(node);
    return {index,id:node.attrs.find(attr=>attr.name==="id")?.value??"",title:heading?textOf(heading).replace(/\s+/g," ").trim():""};
  });
  return {text:readable.text,outline};
}
