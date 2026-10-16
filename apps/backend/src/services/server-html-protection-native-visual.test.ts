// @vitest-environment node
import {describe,expect,it} from "vitest";
import {prepareServerHtmlProtectionNativeVisualComparison} from "./server-html-protection-native-visual";
function document(){return {realm:{frameId:"native-frame"},value:{elementCount:2,
 styleTable:{strings:["color","red","blue"],styleRows:[[[0,1]],[[0,2]]],elements:[
  {sourcePath:"html",tag:"HTML",id:null,namespace:"html",bounds:[0,0,100,100],styles:0,beforeStyles:0,afterStyles:0,markerStyles:0},
  {sourcePath:"html/p",tag:"P",id:null,namespace:"html",bounds:[0,0,100,20],styles:0,beforeStyles:0,afterStyles:0,markerStyles:0}]},
 snapshot:{strings:["native-frame","#document","HTML","P","#text","Method",""],documents:[{frameId:0,
  nodes:{parentIndex:[-1,0,1,2],nodeType:[9,1,1,3],nodeName:[1,2,3,4],nodeValue:[-1,-1,-1,5],backendNodeId:[1,2,3,4],attributes:[[],[],[],[]]},
  layout:{nodeIndex:[1,2,3],styles:[[],[],[]],bounds:[[0,0,100,100],[0,0,100,20],[0,0,50,20]],text:[-1,-1,5]}}]}}};}
describe("App native visual complete material reconstruction",()=>{
 it("validates the full native census before hashing and retaining the complete final node/style/layout delta",()=>{
  const a=document(),b=document();b.value.snapshot.strings[5]="Method with details";b.value.styleTable.elements[1]!.bounds[3]=40;b.value.styleTable.elements[1]!.markerStyles=1;
  const result=prepareServerHtmlProtectionNativeVisualComparison(a,b);
  expect(result.sha256).toMatch(/^[a-f0-9]{64}$/);expect(result.originalMaterialSha256).not.toBe(result.executedMaterialSha256);
  expect(result.delta.comparedElements).toBe(2);expect(result.delta.nodeChanges).toHaveLength(1);expect(result.delta.geometryChanges).toHaveLength(1);
  expect(result.delta.styleChanges).toEqual([{sourcePath:"html/p",kind:"markerStyles",property:"color",original:"red",executed:"blue"}]);
  expect(result.delta.universalProtectionProved).toBe(false);
 });
 it.each(["frame","last-element","last-node","styles","layout","identity"] as const)("refuses %s before any scoped acceptance claim",kind=>{
  const a=document(),b=document();
  if(kind==="frame")b.realm.frameId="foreign-frame";
  if(kind==="last-element")b.value.styleTable.elements.pop();
  if(kind==="last-node")b.value.snapshot.documents[0]!.nodes.nodeValue.pop();
  if(kind==="styles")b.value.styleTable.elements[1]!.styles=100;
  if(kind==="layout")b.value.snapshot.documents[0]!.layout.styles.pop();
  if(kind==="identity")b.value.styleTable.elements[1]!.sourcePath="other";
  expect(()=>prepareServerHtmlProtectionNativeVisualComparison(a,b)).toThrow();
 });
 it("refuses rather than truncates an oversized complete native comparison",()=>{
  const a=document(),b=document();b.value.snapshot.strings[5]="x".repeat(4*1024*1024);
  expect(()=>prepareServerHtmlProtectionNativeVisualComparison(a,b)).toThrow("full-comparison-budget-exceeded");
 });
});


it("retains complete native text-box and paint-order column differences even when element bounds/styles are equal",()=>{
 const a=document(),b=document();
 Object.assign(a.value.snapshot.documents[0]!,{textBoxes:{layoutIndex:[2],bounds:[[0,0,50,20]],start:[0],length:[6]}});
 Object.assign(b.value.snapshot.documents[0]!,{textBoxes:{layoutIndex:[2],bounds:[[1,0,50,20]],start:[0],length:[6]}});
 Object.assign(a.value.snapshot.documents[0]!.layout,{paintOrders:[0,1,2]});
 Object.assign(b.value.snapshot.documents[0]!.layout,{paintOrders:[0,2,1]});
 const result=prepareServerHtmlProtectionNativeVisualComparison(a,b);
 expect(result.delta.geometryChanges).toEqual([]);expect(result.delta.styleChanges).toEqual([]);
 expect(result.delta.nativeSnapshotChanges?.changes).toEqual(expect.arrayContaining([
  expect.objectContaining({path:["documents","0","layout","paintOrders"],original:[0,1,2],executed:[0,2,1]}),
  expect.objectContaining({path:["documents","0","textBoxes","bounds"],original:[[0,0,50,20]],executed:[[1,0,50,20]]})]));
 expect(result.delta.nativeSnapshotChanges?.originalStrings).toEqual(a.value.snapshot.strings);
 expect(result.delta.nativeSnapshotChanges?.executedStrings).toEqual(b.value.snapshot.strings);
});
