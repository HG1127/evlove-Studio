/** Complete deterministic comparison. Inputs must already have native custody/schema validation in the App. */
export type HtmlProtectionNativeVisualDocument = {
  elementCount: number;
  styleTable: { strings: string[]; styleRows: [number,number][][]; elements: {
    sourcePath:string; tag:string; id:string|null; namespace:string|null; bounds:number[];
    styles:number; beforeStyles:number; afterStyles:number; markerStyles:number;
  }[] };
  snapshot: { [key:string]:unknown; strings:string[]; documents: { [key:string]:unknown; nodes:{
    parentIndex:number[]; nodeType:number[]; nodeName:number[]; nodeValue:number[]; attributes:number[][];
    pseudoType?:{index:number[];value:number[]};
  } }[] };
};
const equal=(a:unknown,b:unknown)=>JSON.stringify(a)===JSON.stringify(b);
function nodes(document:HtmlProtectionNativeVisualDocument) {
  if(document.snapshot.documents.length!==1)throw Error("operational-native-document-count-invalid");
  const {strings,documents}=document.snapshot,n=documents[0]!.nodes,count=n.nodeType.length;
  if([n.parentIndex,n.nodeName,n.nodeValue,n.attributes].some(array=>array.length!==count))throw Error("operational-native-node-partition-incomplete");
  return n.nodeType.map((type,index)=>({type,parent:n.parentIndex[index],name:strings[n.nodeName[index]!],
    text:n.nodeValue[index]===-1?"":strings[n.nodeValue[index]!],attributes:n.attributes[index]!.map(offset=>strings[offset]),
    pseudo:n.pseudoType?.index.includes(index)?strings[n.pseudoType.value[n.pseudoType.index.indexOf(index)]!]:undefined}));
}
function styles(document:HtmlProtectionNativeVisualDocument,row:number) {
  const result:Record<string,string>={};
  for(const [key,value] of document.styleTable.styleRows[row]??[]) {
    const name=document.styleTable.strings[key],literal=document.styleTable.strings[value];
    if(name===undefined||literal===undefined||Object.hasOwn(result,name))throw Error("operational-native-style-partition-incomplete");
    result[name]=literal;
  }
  return result;
}
/** Retain every additional native field (text boxes, paint order, scroll/client/offset rects,
 * sparse native node flags, document metadata and future CDP columns). Complete changed
 * columns are carried with both entire string tables; no native index loses its context.
 */
function completeNativeSnapshotChanges(original:HtmlProtectionNativeVisualDocument,executed:HtmlProtectionNativeVisualDocument) {
  const changes:Array<{path:string[];originalPresent:boolean;executedPresent:boolean;original:unknown;executed:unknown}>=[];
  const walk=(left:unknown,right:unknown,path:string[])=>{
    if(equal(left,right))return;
    if(left!==null&&right!==null&&typeof left==="object"&&typeof right==="object"&&!Array.isArray(left)&&!Array.isArray(right)) {
      const a=left as Record<string,unknown>,b=right as Record<string,unknown>;
      for(const key of [...new Set([...Object.keys(a),...Object.keys(b)])].sort())walk(a[key],b[key],[...path,key]);
      return;
    }
    changes.push({path,originalPresent:left!==undefined,executedPresent:right!==undefined,original:left??null,executed:right??null});
  };
  const material=(snapshot:HtmlProtectionNativeVisualDocument["snapshot"])=>{
    const {strings,documents,...rest}=snapshot;void strings;
    return {...rest,documents:Object.fromEntries(documents.map((document,index)=>[String(index),document]))};
  };
  walk(material(original.snapshot),material(executed.snapshot),[]);
  if(!changes.length&&equal(original.snapshot.strings,executed.snapshot.strings))return undefined;
  return {originalStrings:[...original.snapshot.strings],executedStrings:[...executed.snapshot.strings],changes};
}
/** Nothing is sampled: every native node, style property, pseudo style and geometry is compared.
 * Differences are observations for independent visual assessment, never automatic permission or PASS.
 */
export function htmlProtectionNativeVisualDelta(original:HtmlProtectionNativeVisualDocument,executed:HtmlProtectionNativeVisualDocument) {
  const left=original.styleTable.elements,right=executed.styleTable.elements;
  if(!left.length||original.elementCount!==left.length||executed.elementCount!==right.length
    ||new Set(left.map(item=>item.sourcePath)).size!==left.length||new Set(right.map(item=>item.sourcePath)).size!==right.length
    ||left.length!==right.length||left.some((item,index)=>!equal(
      [item.sourcePath,item.tag,item.id,item.namespace],
      [right[index]!.sourcePath,right[index]!.tag,right[index]!.id,right[index]!.namespace])))throw Error("operational-native-element-identity-drift");
  const styleChanges:Array<{sourcePath:string;kind:string;property:string;original:string|null;executed:string|null}>=[];
  const geometryChanges:Array<{sourcePath:string;original:number[];executed:number[]}>=[];
  for(const [index,item] of left.entries()) {
    const other=right[index]!;
    if(!equal(item.bounds,other.bounds))geometryChanges.push({sourcePath:item.sourcePath,original:[...item.bounds],executed:[...other.bounds]});
    for(const kind of ["styles","beforeStyles","afterStyles","markerStyles"] as const) {
      const before=styles(original,item[kind]),after=styles(executed,other[kind]);
      for(const property of [...new Set([...Object.keys(before),...Object.keys(after)])].sort())
        if(before[property]!==after[property])styleChanges.push({sourcePath:item.sourcePath,kind,property,original:before[property]??null,executed:after[property]??null});
    }
  }
  const originalNodes=nodes(original),executedNodes=nodes(executed);
  // A changed node census is a real complete difference, not a truncated zip/min-length match.
  const nodeChanges:Array<{index:number;original:ReturnType<typeof nodes>[number]|null;executed:ReturnType<typeof nodes>[number]|null}>=[];
  for(let index=0;index<Math.max(originalNodes.length,executedNodes.length);index++)
    if(!equal(originalNodes[index],executedNodes[index]))nodeChanges.push({index,original:originalNodes[index]??null,executed:executedNodes[index]??null});
  return {schemaVersion:"html-protection-native-visual-delta-v2" as const,comparedElements:left.length,
    originalNodeCount:originalNodes.length,executedNodeCount:executedNodes.length,styleChanges,geometryChanges,nodeChanges,
    nativeSnapshotChanges:completeNativeSnapshotChanges(original,executed),
    universalProtectionProved:false as const};
}
