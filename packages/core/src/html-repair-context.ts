import {parse,type DefaultTreeAdapterTypes} from "parse5";

/** Exact body slices for mutation context; protected executable/style bytes are never emitted. */
export function htmlRepairBodyContext(html:string){
  const root=parse(html,{sourceCodeLocationInfo:true});
  const omitted:Array<{start:number;end:number}>=[];
  let bodyStart:number|undefined,bodyEnd:number|undefined;
  const visit=(node:DefaultTreeAdapterTypes.Node)=>{
    if("tagName" in node){
      const location=node.sourceCodeLocation;
      if(node.tagName==="body"){
        bodyStart=location?.startTag?.endOffset;
        bodyEnd=location?.endTag?.startOffset;
      }
      if(location&&(node.tagName==="script"||node.tagName==="style")){
        omitted.push({start:location.startOffset,end:location.endOffset});return;
      }
      if(location?.startTag&&node.attrs.some(attr=>attr.name==="style"||attr.name==="srcdoc"||/^on/i.test(attr.name)
        ||/^(href|src|action|formaction)$/i.test(attr.name)&&/^\s*(javascript:|data:text\/(?:html|javascript|css))/i.test(attr.value))){
        omitted.push({start:location.startTag.startOffset,end:location.startTag.endOffset});
      }
    }
    if("childNodes" in node)for(const child of node.childNodes)visit(child);
    // Inert template content may contain protected code too.
    if("content" in node&&node.content)visit(node.content);
  };
  visit(root);
  if(bodyStart===undefined||bodyEnd===undefined||bodyEnd<bodyStart)return undefined;
  let cursor=bodyStart;
  const slices:string[]=[];
  for(const range of omitted.sort((a,b)=>a.start-b.start)){
    if(range.end<=cursor||range.start>=bodyEnd)continue;
    if(range.start>cursor)slices.push(html.slice(cursor,range.start));
    slices.push("\n[protected executable/style markup omitted; do not use this marker as an edit anchor]\n");
    cursor=Math.min(bodyEnd,Math.max(cursor,range.end));
  }
  slices.push(html.slice(cursor,bodyEnd));
  return slices.join("");
}
