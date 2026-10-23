import {parse,type DefaultTreeAdapterTypes} from "parse5";
import {HtmlTextNodeEditsSchema} from "@evolution/contracts";
import {applyExactEdits} from "./exact-edits";

interface BodyTextNode {
  anchorId:string;
  element:string;
  section:string;
  text:string;
  start:number;
  end:number;
}

function bodyTextNodes(html:string):BodyTextNode[]{
  const root=parse(html,{sourceCodeLocationInfo:true});
  const nodes:BodyTextNode[]=[];
  let physicalBody=false;
  const visit=(node:DefaultTreeAdapterTypes.Node,inBody=false,element="",section="")=>{
    if("tagName" in node){
      if(["head","script","style","template","noscript"].includes(node.tagName))return;
      if(node.tagName==="body"){
        const location=node.sourceCodeLocation;
        if(!location?.startTag||!location.endTag)throw new Error("HTML body text requires complete physical body boundaries");
        physicalBody=true;inBody=true;
      }
      element=node.tagName;
      section=node.attrs.find(attr=>attr.name==="id")?.value??section;
    }
    if(inBody&&node.nodeName==="#text"&&"value" in node&&node.value.trim()){
      const location=node.sourceCodeLocation;
      if(!location)throw new Error("HTML body text has no physical source location");
      const start=location.startOffset,end=location.endOffset;
      nodes.push({anchorId:`t${start.toString(36)}_${end.toString(36)}`,element,section,text:node.value,start,end});
    }
    if("childNodes" in node)for(const child of node.childNodes)visit(child,inBody,element,section);
  };
  visit(root);
  if(!physicalBody)throw new Error("HTML body text requires complete physical body boundaries");
  return nodes;
}

/** Complete body text only; no raw tags, attributes, scripts, styles or template code. */
export function htmlRepairTextNodeContext(html:string){
  const nodes=bodyTextNodes(html).map(({anchorId,element,section,text})=>({anchorId,element,section,text}));
  // Fail closed instead of silently dropping chapters or giving an incomplete edit index.
  if(nodes.length>4096||JSON.stringify(nodes).length>240_000)throw new Error("HTML complete body text edit index exceeds the repair context capacity");
  return nodes;
}

/** Resolve model IDs against the same physical parent and preflight exact edits before any write. */
export function resolveHtmlTextNodeEdits(html:string,payload:string,parentSha256:string){
  const data=HtmlTextNodeEditsSchema.parse(JSON.parse(payload));
  if(data.parentSha256!==parentSha256)throw new Error("HTML text edits do not match the frozen parent SHA-256");
  const anchors=new Map(bodyTextNodes(html).map(node=>[node.anchorId,node]));
  const seen=new Set<string>();
  const edits=data.edits.flatMap(edit=>{
    const anchor=anchors.get(edit.anchorId);
    if(!anchor||seen.has(edit.anchorId))throw new Error("HTML text edit anchor is unknown or duplicated: "+edit.anchorId);
    seen.add(edit.anchorId);
    if(edit.text===anchor.text)return [];
    const after=edit.text.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
    return [{before:html.slice(anchor.start,anchor.end),after,start:anchor.start,end:anchor.end}];
  });
  if(!edits.length)throw new Error("HTML text edits contain no actual body text changes");
  const exact=JSON.stringify({kind:"text-edits",edits});
  applyExactEdits(html,exact,{strict:true});
  return exact;
}
