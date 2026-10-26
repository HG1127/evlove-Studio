import {parse,type DefaultTreeAdapterTypes} from "parse5";

type Element=DefaultTreeAdapterTypes.Element;
type Note={key:string;cardId:string;start:number;end:number;raw:string;text:string;attributes:string;declaredCode:boolean;layoutEligible:boolean};
const attribute=(node:Element,name:string)=>node.attrs.find(item=>item.name===name)?.value;
const hasClass=(node:Element,name:string)=>attribute(node,"class")?.split(/\s+/).includes(name);
const attributes=(node:Element)=>JSON.stringify([...node.attrs].sort((a,b)=>a.name.localeCompare(b.name)));
const typed=(node:Element)=>node.attrs.some(item=>item.name==="class"&&item.value.split(/\s+/).some(value=>/^language-/i.test(value)&&!/^language-(?:text|plaintext)$/i.test(value))
  ||["lang","type"].includes(item.name)&&!/^text(?:\/plain)?$/i.test(item.value));
const escaped=(value:string)=>value.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");

function notes(html:string){
  const rows:Note[]=[],cards=new Set<string>(),counts=new Map<string,number>();
  let physicalBody=false,invalid=false;
  const visit=(node:DefaultTreeAdapterTypes.Node,inBody=false,cardId="",inSlideBody=false,inInteractive=false)=>{
    if("tagName" in node){
      if(["head","script","style","template","noscript"].includes(node.tagName))return;
      inInteractive=inInteractive||["a","button","input","textarea","select","label"].includes(node.tagName)
        ||node.attrs.some(item=>/^on/i.test(item.name)||item.name==="contenteditable"&&item.value!=="false")
        ||Boolean(attribute(node,"class")?.split(/\s+/).some(name=>/^prompt(?:-|$)/.test(name)));
      if(node.tagName==="body"){
        if(!node.sourceCodeLocation?.startTag||!node.sourceCodeLocation.endTag){invalid=true;return;}
        physicalBody=true;inBody=true;
      }
      if(node.tagName==="article"&&hasClass(node,"slide-card")){
        cardId=attribute(node,"id")??"";inSlideBody=false;
        if(!/^slide-\d+$/.test(cardId)||cards.has(cardId)){invalid=true;return;}
        cards.add(cardId);
      }
      if(cardId&&hasClass(node,"slide-body"))inSlideBody=true;
      if(inBody&&cardId&&inSlideBody&&node.tagName==="pre"){
        const ordinal=counts.get(cardId)??0;counts.set(cardId,ordinal+1);
        // A physical, simple PRE/CODE pair only. Highlighted/nested markup remains unsupported.
        const code=node.childNodes.length===1?node.childNodes[0]:undefined;
        const location=node.sourceCodeLocation;
        if(hasClass(node,"code-block")&&code&&"tagName" in code&&code.tagName==="code"
          &&code.childNodes.every(child=>child.nodeName==="#text")&&location?.startTag&&location.endTag){
          const text=code.childNodes.map(child=>"value" in child?child.value:"").join("");
          rows.push({key:cardId+":"+ordinal,cardId,start:location.startOffset,end:location.endOffset,
            raw:html.slice(location.startOffset,location.endOffset),text,attributes:attributes(node)+attributes(code),declaredCode:typed(node)||typed(code),
            layoutEligible:!inInteractive&&node.attrs.length===1&&node.attrs[0]!.name==="class"&&node.attrs[0]!.value.trim()==="code-block"&&code.attrs.length===0});
        }
      }
    }
    if("childNodes" in node)for(const child of node.childNodes)visit(child,inBody,cardId,inSlideBody,inInteractive);
  };
  visit(parse(html,{sourceCodeLocationInfo:true}));
  return !physicalBody||invalid?undefined:{rows,counts,cards};
}

const plain=(text:string)=>/\p{Script=Han}/u.test(text)&&!/[<>{};=()[\]`\\]/.test(text);
function appendedProse(original:Note,subject:Note){
  if(!original.layoutEligible||!subject.layoutEligible||original.declaredCode||subject.declaredCode||original.attributes!==subject.attributes
    ||original.text.trim()!==original.text||original.text.includes("\n")||!plain(original.text)||!/[。！？：]/.test(original.text)
    ||!subject.text.startsWith(original.text+"\n"))return undefined;
  const suffix=subject.text.slice(original.text.length),lines=suffix.split("\n").filter(line=>line.trim());
  if(!lines.length||lines.some(line=>!/^\s*\p{Script=Han}/u.test(line)||!plain(line)))return undefined;
  return suffix;
}

/** Lossless pre-freeze layout only. The adapter must establish a supported renderer first. */
export function separateHtmlAppendedProse(originalHtml:string,subjectHtml:string){
  const original=notes(originalHtml),subject=notes(subjectHtml),unchanged={html:subjectHtml,reflowedIds:[] as string[]};
  if(!original||!subject||original.cards.size!==subject.cards.size||[...original.cards].some(id=>!subject.cards.has(id))
    ||[...original.counts].some(([id,count])=>subject.counts.get(id)!==count))return unchanged;
  const targets=new Map(subject.rows.map(row=>[row.key,row])),edits:Array<{start:number;end:number;after:string;cardId:string}>=[];
  for(const source of original.rows){
    const target=targets.get(source.key);if(!target)continue;
    const suffix=appendedProse(source,target);if(suffix===undefined)continue;
    edits.push({start:target.start,end:target.end,after:source.raw+"<p>"+escaped(suffix)+"</p>",cardId:source.cardId});
  }
  let html=subjectHtml;
  for(const edit of edits.sort((a,b)=>b.start-a.start))html=html.slice(0,edit.start)+edit.after+html.slice(edit.end);
  return {html,reflowedIds:[...new Set(edits.map(edit=>edit.cardId))]};
}
