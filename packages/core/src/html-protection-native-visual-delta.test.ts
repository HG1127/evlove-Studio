import {describe,expect,it} from "vitest";
import {htmlProtectionNativeVisualDelta,type HtmlProtectionNativeVisualDocument} from "./html-protection-native-visual-delta";
function fixture():HtmlProtectionNativeVisualDocument{
  return {elementCount:111,styleTable:{strings:["color","red","blue"],styleRows:[[[0,1]],[[0,2]]],
    elements:Array.from({length:111},(_,index)=>({sourcePath:"card:"+index,tag:"ARTICLE",id:"card-"+index,namespace:"html",bounds:[0,index*20,100,20],styles:0,beforeStyles:0,afterStyles:0,markerStyles:0}))},
    snapshot:{strings:["#document",""],documents:[{nodes:{parentIndex:[-1],nodeType:[9],nodeName:[0],nodeValue:[1],attributes:[[]]}}]}};
}
describe("complete native visual comparison",()=>{
  it("compares every element, all pseudo styles and geometry without promoting differences to permission",()=>{
    const a=fixture(),b=fixture();b.styleTable.elements[110]!.markerStyles=1;b.styleTable.elements[110]!.bounds[1]!+=1;
    const delta=htmlProtectionNativeVisualDelta(a,b);expect(delta.comparedElements).toBe(111);
    expect(delta.styleChanges).toEqual([{sourcePath:"card:110",kind:"markerStyles",property:"color",original:"red",executed:"blue"}]);
    expect(delta.geometryChanges).toHaveLength(1);expect(delta.universalProtectionProved).toBe(false);
  });
  it("retains complete new or changed native node material, never zips a shorter prefix",()=>{
    const a=fixture(),b=fixture();b.snapshot.documents[0]!.nodes={parentIndex:[-1,0],nodeType:[9,3],nodeName:[0,0],nodeValue:[1,1],attributes:[[],[]]};
    expect(htmlProtectionNativeVisualDelta(a,b).nodeChanges).toEqual([{index:1,original:null,executed:{type:3,parent:0,name:"#document",text:"",attributes:[],pseudo:undefined}}]);
  });
  it.each(["missing","foreign","reordered","duplicate"] as const)("refuses %s native element scope",kind=>{
    const a=fixture(),b=fixture();if(kind==="missing")b.styleTable.elements.pop();if(kind==="foreign")b.styleTable.elements[110]!.id="other";
    if(kind==="reordered")b.styleTable.elements.reverse();if(kind==="duplicate")b.styleTable.elements[110]!.sourcePath="card:0";
    expect(()=>htmlProtectionNativeVisualDelta(a,b)).toThrow();
  });
});
