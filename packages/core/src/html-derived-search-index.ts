import {parse,type DefaultTreeAdapterTypes} from "parse5";

type Element=DefaultTreeAdapterTypes.Element;
const attribute=(node:Element,name:string)=>node.attrs.find(attr=>attr.name===name)?.value;
const normalize=(text:string)=>text.replace(/\s+/g," ").trim().toLowerCase();
function textOf(node:DefaultTreeAdapterTypes.Node):string{
  if("tagName" in node&&["script","style","template","svg","noscript","button"].includes(node.tagName))return "";
  if(node.nodeName==="#text"&&"value" in node)return node.value;
  return "childNodes" in node?node.childNodes.map(textOf).join(" "):"";
}
function cards(html:string){
  const map=new Map<string,Element>(),root=parse(html,{sourceCodeLocationInfo:true});
  const visit=(node:DefaultTreeAdapterTypes.Node)=>{
    if("tagName" in node&&node.tagName==="article"&&attribute(node,"class")?.split(/\s+/).includes("slide-card")){
      const id=attribute(node,"id");if(id){if(map.has(id))throw new Error("Duplicate HTML card identity");map.set(id,node);}
    }
    if("childNodes" in node)for(const child of node.childNodes)visit(child);
  };
  visit(root);return map;
}
function bodyText(card:Element){
  let body:Element|undefined;
  const visit=(node:DefaultTreeAdapterTypes.Node)=>{
    if("tagName" in node&&attribute(node,"class")?.split(/\s+/).includes("slide-body"))body??=node;
    if("childNodes" in node)for(const child of node.childNodes)visit(child);
  };
  visit(card);return normalize(textOf(body??card));
}
const escaped=(text:string)=>text.replace(/&/g,"&amp;").replace(/"/g,"&quot;").replace(/</g,"&lt;").replace(/>/g,"&gt;");

/** Pure derived-metadata compilation. The adapter must first establish the supported program profile. */
export function synchronizeHtmlCardSearchIndex(originalHtml:string,subjectHtml:string){
  const original=cards(originalHtml),subject=cards(subjectHtml),edits:Array<{start:number;end:number;after:string}>=[];
  const updatedIds:string[]=[];
  for(const [id,before] of original){
    const prior=attribute(before,"data-search"),after=subject.get(id);
    if(prior===undefined)continue;
    if(!after)throw new Error("Original indexed HTML card is missing: "+id);
    const current=attribute(after,"data-search"),location=after.sourceCodeLocation?.attrs?.["data-search"];
    if(current===undefined||!location)throw new Error("HTML card search index has no physical attribute location: "+id);
    const expected=prior+" "+bodyText(after);
    if(current===expected)continue;
    edits.push({start:location.startOffset,end:location.endOffset,after:'data-search="'+escaped(expected)+'"'});updatedIds.push(id);
  }
  let html=subjectHtml;
  for(const edit of edits.sort((a,b)=>b.start-a.start))html=html.slice(0,edit.start)+edit.after+html.slice(edit.end);
  return {html,updatedIds};
}

/** Exact canonical changes only; this never licenses arbitrary edits to named-element attributes. */
export function canonicalHtmlSearchIndexChanges(originalHtml:string,subjectHtml:string){
  const original=cards(originalHtml),subject=cards(subjectHtml),changedIds:string[]=[],invalidIds:string[]=[];
  for(const [id,before] of original){
    const prior=attribute(before,"data-search");if(prior===undefined)continue;
    const after=subject.get(id),current=after&&attribute(after,"data-search");
    if(current===prior)continue;
    changedIds.push(id);
    if(!after||current!==prior+" "+bodyText(after))invalidIds.push(id);
  }
  return {changedIds,invalidIds};
}

/** Queries are derived from real new content, independently of any final-paper questions. */
export function novelHtmlSearchQueries(originalHtml:string,subjectHtml:string,max=12){
  const original=cards(originalHtml),subject=cards(subjectHtml),queries:Array<{cardId:string;query:string}>=[];
  for(const [cardId,after] of subject){
    if(!/^slide-\d+$/.test(cardId)||queries.length>=max)continue;
    const before=original.get(cardId),prior=before&&attribute(before,"data-search");if(!before||prior===undefined)continue;
    const oldText=bodyText(before),nextText=bodyText(after),oldIndex=prior.toLowerCase();
    const latin=[...nextText.matchAll(/[a-z][a-z0-9_]{3,79}/g)].map(match=>match[0]);
    const chinese=[...nextText.matchAll(/[\p{Script=Han}]{3,}/gu)].flatMap(match=>Array.from({length:match[0].length-2},(_,i)=>match[0].slice(i,i+3)));
    const query=[...latin,...chinese].find(token=>!oldText.includes(token)&&!oldIndex.includes(token));
    if(query)queries.push({cardId,query});
  }
  return queries;
}
