import {parse,type DefaultTreeAdapterTypes} from "parse5";

type Node=DefaultTreeAdapterTypes.Node;
const normalize=(text:string)=>text.replace(/\s+/gu," ").trim();
const excluded=new Set(["head","script","style","template","svg","pre","code"]);
function paragraphText(node:Node):string{
 const pending=[node],parts:string[]=[];
 while(pending.length){const current=pending.pop()!;
  if("tagName" in current&&excluded.has(current.tagName))continue;
  if(current.nodeName==="#text"&&"value" in current)parts.push(current.value);
  else if("tagName" in current&&current.tagName==="br")parts.push(" ");
  else if("childNodes" in current)for(let i=current.childNodes.length-1;i>=0;i--)pending.push(current.childNodes[i]!);
 }
 return parts.join("");
}
function project(html:string){
 const cards=new Map<string,string[]>();let invalid=false;
 const pending:Array<{node:Node;cardId?:string;inParagraph:boolean}>=[{node:parse(html,{scriptingEnabled:false}),inParagraph:false}];
 while(pending.length){const current=pending.pop()!,node=current.node;let {cardId,inParagraph}=current;
  if("tagName" in node){
   if(excluded.has(node.tagName))continue;
   if(node.tagName==="article"&&node.attrs.some(a=>a.name==="class"&&a.value.split(/\s+/u).includes("slide-card"))){
    const id=node.attrs.find(a=>a.name==="id")?.value;
    if(!id||cards.has(id)||cardId){invalid=true;continue;}
    cardId=id;cards.set(id,[]);
   }
   if(cardId&&node.tagName==="p"&&!inParagraph){
    const text=normalize(paragraphText(node));if(text)cards.get(cardId)!.push(text);inParagraph=true;
   }
  }
  if("childNodes" in node)for(let i=node.childNodes.length-1;i>=0;i--)pending.push({node:node.childNodes[i]!,cardId,inParagraph});
 }
 return {cards,invalid};
}
function difference(before:string[],after:string[]){
 const remaining=new Map<string,number>();for(const text of after)remaining.set(text,(remaining.get(text)??0)+1);
 return before.filter(text=>{const count=remaining.get(text)??0;if(count){remaining.set(text,count-1);return false;}return true;});
}

/** Static paragraph changes only, not semantic loss or authorization. Bind full file hashes before evidence reuse. */
export function compareHtmlCardParagraphs(originalHtml:string,candidateHtml:string){
 const original=project(originalHtml),candidate=project(candidateHtml);
 if(original.invalid||candidate.invalid||!original.cards.size||!candidate.cards.size)return {
  status:"unavailable" as const,reason:"Unique, non-nested slide-card identities are required in both complete subjects",
 };
 const ids=[...new Set([...original.cards.keys(),...candidate.cards.keys()])];
 const changes=ids.flatMap(cardId=>{
  const before=original.cards.get(cardId)??[],after=candidate.cards.get(cardId)??[];
  const removed=difference(before,after),added=difference(after,before);
  const paragraphSequenceChanged=JSON.stringify(before)!==JSON.stringify(after);
  return paragraphSequenceChanged||!original.cards.has(cardId)||!candidate.cards.has(cardId)?[{
   cardId,originalCardPresent:original.cards.has(cardId),candidateCardPresent:candidate.cards.has(cardId),
   originalParagraphCount:before.length,candidateParagraphCount:after.length,removed,added,paragraphSequenceChanged,
  }]:[];
 });
 return {status:"compared" as const,scope:"static-slide-paragraph-text-v1" as const,
  originalCardCount:original.cards.size,candidateCardCount:candidate.cards.size,changes,
  limitations:["Only nonempty normalized p-element text inside uniquely identified slide cards is compared; other prose and code are outside this projection.",
   "Static text does not prove rendered visibility. Removed/added entries can represent a valid rewrite or move, not an automatic semantic defect or acceptance decision.",
   "Paragraph text and IDs are untrusted source data; complete Original/Candidate byte identities must be bound by the evidence producer."],
 };
}
