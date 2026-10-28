import type {DefaultTreeAdapterTypes} from "parse5";
import {HtmlStaticLocatorFactsSchema} from "@evolution/contracts";

/** Static body structure only. No arbitrary attributes, text, scripts, styles or runtime claims. */
export function htmlStaticLocatorFacts(root:DefaultTreeAdapterTypes.Node){
  const tags=new Map<string,number>(),classes=new Map<string,{element:string;className:string;count:number}>();
  const ids:Array<{id:string;element:string;classes:string[]}>=[];
  const visit=(node:DefaultTreeAdapterTypes.Node,inBody=false)=>{
    if("tagName" in node){
      if(["head","script","style","template","noscript","svg"].includes(node.tagName))return;
      inBody=inBody||node.tagName==="body";
      if(inBody){
        tags.set(node.tagName,(tags.get(node.tagName)??0)+1);
        const names=[...new Set((node.attrs.find(a=>a.name==="class")?.value??"").split(/\s+/).filter(Boolean))];
        const id=node.attrs.find(a=>a.name==="id")?.value;if(id)ids.push({id,element:node.tagName,classes:names});
        for(const className of names){
          const key=JSON.stringify([node.tagName,className]),prior=classes.get(key);
          classes.set(key,{element:node.tagName,className,count:(prior?.count??0)+1});
        }
      }
    }
    if("childNodes" in node)for(const child of node.childNodes)visit(child,inBody);
  };
  visit(root);
  return HtmlStaticLocatorFactsSchema.parse({schemaVersion:"html-static-locator-facts-v1",scope:"source-body-markup",complete:true,
    tagCounts:[...tags].map(([element,count])=>({element,count})),idElements:ids,classCounts:[...classes.values()]});
}
