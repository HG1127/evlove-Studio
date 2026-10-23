import type {Candidate,CandidatePatch,SourceArtifact} from "@evolution/contracts";

/** Locate a unique element without serializing or changing untouched document bytes. */
export function htmlElementRange(source:string,id:string){
  const tokens=[...source.matchAll(/<!--[\s\S]*?-->|<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>|<\/?[a-z](?:[^>"']|"[^"]*"|'[^']*')*>/gi)];
  const openings=tokens.filter(token=>{
    if(!/^<[a-z]/i.test(token[0])||/^<(script|style)\b/i.test(token[0]))return false;
    const value=token[0].match(/\sid\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i);
    return (value?.[1]??value?.[2]??value?.[3])===id;
  });
  if(openings.length!==1)return undefined;
  const opening=openings[0]!;
  const tag=opening[0].match(/^<([a-z][\w:-]*)/i)![1]!.toLowerCase();
  if(/^(?:area|base|br|col|embed|hr|img|input|link|meta|param|source|track|wbr)$/.test(tag)||/\/\s*>$/.test(opening[0]))return undefined;
  let depth=0;
  for(const token of tokens.slice(tokens.indexOf(opening))){
    const match=token[0].match(/^<(\/)?([a-z][\w:-]*)\b/i);
    if(match?.[2]?.toLowerCase()!==tag)continue;
    depth+=match[1]?-1:1;
    if(depth===0)return {tag,start:opening.index!,innerStart:opening.index!+opening[0].length,innerEnd:token.index!,end:token.index!+token[0].length};
  }
  return undefined;
}

/** Only exact ID targets and complete same-element replacements are safe to apply locally. */
export function applyHtmlCandidatePatch(source:string,patch:CandidatePatch):string|undefined{
  const selector=/^#([a-zA-Z_][\w:.-]*)(?:\s+(section|article|div|main))?$/.exec(patch.target.trim());
  if(!selector)return undefined;
  const id=selector[1]!;
  const range=htmlElementRange(source,id);
  if(!range||(selector[2]&&selector[2]!==range.tag))return undefined;
  const content=patch.content.trim();
  if(!content||/<\/?(?:html|head|body)\b/i.test(content))return undefined;
  if(patch.operation==="update"){
    const fragment=content.replace(/^\s*(?:<!--[\s\S]*?-->\s*)*/,"").replace(/(?:\s*<!--(?:(?!-->)[\s\S])*-->)*\s*$/,"");
    const replacement=htmlElementRange(fragment,id);
    if(!replacement||replacement.tag!==range.tag||replacement.start!==0||replacement.end!==fragment.length)return undefined;
    return source.slice(0,range.start)+content+source.slice(range.end);
  }
  if(patch.operation==="add"){
    if(htmlElementRange(content,id)||source.includes(content))return undefined;
    return source.slice(0,range.innerStart)+"\n"+content+"\n"+source.slice(range.innerStart);
  }
  return undefined;
}

/** A planner's omission marker is not executable file content. Preserve completed artifacts. */
export function incompleteHtmlCandidatePatches(candidate:Candidate,targets:SourceArtifact[]):string[]{
  return candidate.patches.flatMap(patch=>{
    if(patch.operation!=="update"||!/保持.{0,40}(?:原有|原始|其余).{0,40}不变|保留.{0,30}(?:其余|剩余).{0,20}内容/.test(patch.content))return [];
    const id=/^#([a-zA-Z_][\w:.-]*)$/.exec(patch.target.trim())?.[1];
    if(!id)return [];
    const target=targets.find(source=>(!patch.artifactId||patch.artifactId===source.id)&&/^(html?|xhtml)$/i.test(source.extension)&&htmlElementRange(source.textContent??"",id));
    return target&&!htmlElementRange(patch.content,id)?[patch.target]:[];
  });
}
