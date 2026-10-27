import {parse,type DefaultTreeAdapterTypes} from "parse5";
import {HtmlBodyEditAnchorSchema,HtmlBodyNodeEditsSchema,HtmlBuildBodyContextSchema,HtmlBuildBodyNodeEditsSchema,HtmlTextNodeEditsSchema,TextArtifactEditsSchema} from "@evolution/contracts";
import {applyExactEdits} from "./exact-edits";

interface BodyTextNode {
  anchorId:string;
  element:string;
  section:string;
  text:string;
  start:number;
  end:number;
}

function bodyTextNodes(html:string,parentSha256?:string):BodyTextNode[]{
  if(parentSha256!==undefined&&!/^[a-f0-9]{64}$/.test(parentSha256))throw new Error("Invalid frozen parent SHA-256");
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
      nodes.push({anchorId:`t${start.toString(36)}_${end.toString(36)}${parentSha256?"-"+parentSha256.slice(0,16):""}`,element,section,text:node.value,start,end});
    }
    if("childNodes" in node)for(const child of node.childNodes)visit(child,inBody,element,section);
  };
  visit(root);
  if(!physicalBody)throw new Error("HTML body text requires complete physical body boundaries");
  return nodes;
}

/** Complete body text only; no raw tags, attributes, scripts, styles or template code. */
export function htmlRepairTextNodeContext(html:string,parentSha256?:string){
  const nodes=bodyTextNodes(html,parentSha256).map(({anchorId,element,section,text})=>({anchorId,element,section,text}));
  // Fail closed instead of silently dropping chapters or giving an incomplete edit index.
  if(nodes.length>4096||JSON.stringify(nodes).length>240_000)throw new Error("HTML complete body text edit index exceeds the repair context capacity");
  return nodes;
}

/** Read every chapter while retaining exact raw-text anchors and full-source offsets for the builder. */
export function htmlBuildBodyEditAnchors(html:string,parentSha256:string){
  const nodes=bodyTextNodes(html,parentSha256).map(({anchorId,element,section,start,end})=>({anchorId,element,section,start,end,before:html.slice(start,end)}));
  const parsed=HtmlBodyEditAnchorSchema.array().min(1).max(4096).parse(nodes);
  if(JSON.stringify(parsed).length>320_000)throw new Error("Complete HTML body edit index exceeds the build context capacity; no chapters were truncated");
  return parsed;
}

/** Fill omitted positions only from a unique complete text node in the issued parent index. */
export function bindHtmlBuildTextEditAnchors(payload:string,issuedContext:unknown){
  const context=HtmlBuildBodyContextSchema.parse(issuedContext);
  const data=TextArtifactEditsSchema.parse(JSON.parse(payload));
  const byText=new Map<string,typeof context.anchors>();
  for(const anchor of context.anchors){
    const matches=byText.get(anchor.before)??[];matches.push(anchor);byText.set(anchor.before,matches);
  }
  return JSON.stringify({...data,edits:data.edits.map(edit=>{
    // Explicit positions and markup/substrings retain the existing strict edit contract.
    // Repeated real body nodes must be selected explicitly; metadata copies are not nodes.
    if(edit.start!==undefined||edit.end!==undefined)return edit;
    const matches=byText.get(edit.before);
    return matches?.length===1?{...edit,start:matches[0]!.start,end:matches[0]!.end}:edit;
  })});
}

/** IDs disambiguate repeated body text without asking the model to copy text or calculate offsets.
 * Raw after bytes retain the existing builder's markup capability; protection remains downstream.
 */
export function bindHtmlBuildBodyNodeEdits(payload:string,issuedContext:unknown){
  const context=HtmlBuildBodyContextSchema.parse(issuedContext),data=HtmlBuildBodyNodeEditsSchema.parse(JSON.parse(payload));
  const anchors=new Map(context.anchors.map(anchor=>[anchor.anchorId,anchor]));
  if(anchors.size!==context.anchors.length)throw new Error("Issued HTML body index has duplicate IDs");
  const seen=new Set<string>();
  const edits=data.edits.map(edit=>{
    const anchor=anchors.get(edit.anchorId);
    if(!anchor||seen.has(edit.anchorId))throw new Error("HTML build body anchor is unknown or duplicated: "+edit.anchorId);
    seen.add(edit.anchorId);
    return {before:anchor.before,after:edit.after,start:anchor.start,end:anchor.end};
  });
  return JSON.stringify(TextArtifactEditsSchema.parse({kind:"text-edits",edits}));
}

/** Resolve model IDs against the same physical parent and preflight exact edits before any write. */
export function resolveHtmlTextNodeEdits(html:string,payload:string,parentSha256:string){
  const data=HtmlTextNodeEditsSchema.parse(JSON.parse(payload));
  if(data.parentSha256!==parentSha256)throw new Error("HTML text edits do not match the frozen parent SHA-256");
  return exactBodyNodeEdits(html,data.edits,bodyTextNodes(html));
}

/** The caller owns the verified full SHA and immutable parent; the model cannot select another parent. */
export function resolveBoundHtmlBodyNodeEdits(html:string,payload:string,parentSha256:string){
  const data=HtmlBodyNodeEditsSchema.parse(JSON.parse(payload));
  return exactBodyNodeEdits(html,data.edits,bodyTextNodes(html,parentSha256));
}

function exactBodyNodeEdits(html:string,requested:Array<{anchorId:string;text:string}>,nodes:BodyTextNode[]){
  const anchors=new Map(nodes.map(node=>[node.anchorId,node]));
  const seen=new Set<string>();
  const edits=requested.flatMap(edit=>{
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
