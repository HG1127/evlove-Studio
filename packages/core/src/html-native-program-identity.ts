import {parse,type DefaultTreeAdapterTypes} from "parse5";

/** Non-executing identity only. A concrete adapter supplies SHA-256; raw executable text never leaves this projection. */
export function htmlNativeProgramIdentity(html:string,hash:(text:string)=>string){
  const document=parse(html,{sourceCodeLocationInfo:true});
  const scriptDigests:string[]=[],inlineAttributes:Array<{tag:string;attribute:string;digest:string}>=[],codeBlockDigests:string[]=[];
  const styleDigests:string[]=[],styleAttributes:Array<{tag:string;digest:string}>=[],stylesheetReferences:string[]=[];
  const visualBlockDigests:string[]=[];
  let mediaCount=0;
  let templates=0,frames=0,unlocated=false,externalScripts=0;
  const nodeText=(node:DefaultTreeAdapterTypes.Node):string=>node.nodeName==="#text"&&"value" in node?node.value
    :"childNodes" in node?node.childNodes.map(nodeText).join(""):"";
  const visit=(node:DefaultTreeAdapterTypes.Node)=>{
    if("tagName" in node){
      if(node.tagName==="template")templates++;
      if(["iframe","object","embed"].includes(node.tagName))frames++;
      if(["img","canvas","video","audio","picture","source"].includes(node.tagName))mediaCount++;
      if(node.tagName==="svg"){
        const location=node.sourceCodeLocation;
        if(!location)unlocated=true;else visualBlockDigests.push(hash(html.slice(location.startOffset,location.endOffset)));
      }
      if(node.tagName==="script"){
        const location=node.sourceCodeLocation;
        if(!location)unlocated=true;
        else scriptDigests.push(hash(html.slice(location.startOffset,location.endOffset)));
        if(node.attrs.some(attr=>attr.name==="src"))externalScripts++;
      }
      if(node.tagName==="style"){
        const location=node.sourceCodeLocation;
        if(!location)unlocated=true;else styleDigests.push(hash(html.slice(location.startOffset,location.endOffset)));
      }
      for(const attr of node.attrs)if(attr.name==="style")styleAttributes.push({tag:node.tagName,digest:hash(attr.value)});
      if(node.tagName==="link"&&node.attrs.some(attr=>attr.name==="rel"&&attr.value.split(/\s+/).includes("stylesheet"))){
        stylesheetReferences.push(hash(JSON.stringify([...node.attrs].sort((a,b)=>a.name.localeCompare(b.name)))));
      }
      for(const attr of node.attrs)if(/^on/i.test(attr.name)||attr.name==="srcdoc"
        ||/^(href|src|action|formaction)$/i.test(attr.name)&&/^\s*(?:javascript:|data:text\/(?:html|javascript))/i.test(attr.value)){
        inlineAttributes.push({tag:node.tagName,attribute:attr.name,digest:hash(attr.value)});
      }
      if(node.tagName==="pre"||node.tagName==="code")codeBlockDigests.push(hash(JSON.stringify({tag:node.tagName,text:nodeText(node)})));
    }
    if("childNodes" in node)for(const child of node.childNodes)visit(child);
    if("content" in node&&node.content)visit(node.content);
  };
  visit(document);
  return {version:"html-program-identity-v1" as const,
    signature:hash(JSON.stringify({version:"html-program-identity-v1",scriptDigests,inlineAttributes,templates,frames,externalScripts,unlocated})),
    styleSignature:hash(JSON.stringify({version:"html-style-identity-v1",styleDigests,styleAttributes,stylesheetReferences})),
    styleCount:styleDigests.length,inlineStyleAttributeCount:styleAttributes.length,stylesheetReferenceCount:stylesheetReferences.length,
    mediaCount,visualBlockDigests,
    scriptCount:scriptDigests.length,inlineExecutableAttributeCount:inlineAttributes.length,templateCount:templates,frameCount:frames,
    externalScriptCount:externalScripts,unlocated,codeBlockDigests};
}
