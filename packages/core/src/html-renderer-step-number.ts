import {parse,type DefaultTreeAdapterTypes as Tree} from "parse5";

type Element=Tree.Element;
type Card={label:string;detail:string};
type Issue={section:string;gridIndex:number;cardIndex:number;label:string;detailPrefix:string};
export const HTML_RENDERER_STEP_NUMBER_POLICY="known-sop-renderer-step-number-echo-v1";
const attr=(node:Element,key:string)=>node.attrs.find(a=>a.name===key)?.value;
const cls=(node:Element,name:string)=>attr(node,"class")?.split(/\s+/u).includes(name);
const children=(node:Element)=>node.childNodes.filter((n):n is Element=>"tagName" in n);
const excluded=new Set(["head","script","style","template","noscript","pre","code","svg"]);
const text=(node:Tree.Node):string=>"tagName" in node&&excluded.has(node.tagName)?"":node.nodeName==="#text"&&"value" in node?node.value:"childNodes" in node?node.childNodes.map(text).join(""):"";

/** Only the known renderer's unambiguous direct grids, cards and two paragraph slots. */
function layouts(html:string){
  const sections=new Map<string,Array<Array<Card|undefined>>>(),duplicates=new Set<string>();
  const visit=(node:Tree.Node,section?:string)=>{
    if("tagName" in node){
      if(excluded.has(node.tagName))return;
      if(node.tagName==="article"){
        const id=attr(node,"id");section=cls(node,"slide-card")&&attr(node,"data-kind")==="tool"&&id&&/^slide-\d{1,6}$/u.test(id)?id:undefined;
        if(section){if(sections.has(section))duplicates.add(section);else sections.set(section,[]);}
      }
      if(section&&cls(node,"slide-body")){
        const grids=children(node).filter(n=>cls(n,"mini-grid"));
        sections.get(section)!.push(...grids.map(grid=>children(grid).map(card=>{
          const content=children(card),slots=content.length===1&&content[0]!.tagName==="div"&&cls(content[0]!,"text-lines")?children(content[0]!):content;
          return cls(card,"mini-card")&&slots.length===2&&slots.every(n=>n.tagName==="p")
            ?{label:text(slots[0]!).trim(),detail:text(slots[1]!).trim()}:undefined;
        })));
      }
    }
    if("childNodes" in node)for(const child of node.childNodes)visit(child,section);
  };
  visit(parse(html));for(const section of duplicates)sections.delete(section);return sections;
}
function echoedPrefix(detail:string,label:string){
  const match=detail.match(/^(?:(步骤)\s*)?(\d{1,3})([.．](?!\d)|[、)）:：]|\s+|$)/u);
  if(!match||Number(match[2])!==Number(label))return undefined;
  // A plain count such as “1 个项目” is meaningful prose, not a repeated step label.
  const explicit=!!match[1]||/^[.．、)）:：]/u.test(match[3]!)||label.length>=2&&match[2]===label||detail===label;
  return explicit?(match[1]??"")+match[2]:undefined;
}
export class HtmlRendererStepNumberError extends Error{
  readonly code="HTML_RENDERER_STEP_NUMBER_ECHO";
  readonly policy=HTML_RENDERER_STEP_NUMBER_POLICY;
  readonly issues:Issue[];
  constructor(issues:Issue[]){super("A changed step detail repeats its retained renderer label");this.name="HtmlRendererStepNumberError";this.issues=issues;}
}

/** Reject only newly introduced echoes. Never alter source/candidate text or claim semantic acceptance. */
export function assertHtmlRendererStepNumbers(originalHtml:string,subjectHtml:string){
  const original=layouts(originalHtml),subject=layouts(subjectHtml),issues:Issue[]=[];let checkedCards=0;
  for(const [section,grids] of subject){
    const before=original.get(section);if(!before||before.length!==grids.length)continue;
    grids.forEach((cards,grid)=>{
      const source=before[grid]!;if(source.length!==cards.length) return;
      cards.forEach((card,index)=>{
        const previous=source[index];
        if(!card||!previous||!/^\d{1,3}$/u.test(previous.label)||card.label!==previous.label)return;
        checkedCards++;const prefix=echoedPrefix(card.detail,card.label);
        if(prefix&&!echoedPrefix(previous.detail,previous.label))issues.push({section,gridIndex:grid+1,cardIndex:index+1,label:card.label,detailPrefix:prefix});
      });
    });
  }
  if(issues.length)throw new HtmlRendererStepNumberError(issues);
  return {policy:HTML_RENDERER_STEP_NUMBER_POLICY,checkedCards};
}
