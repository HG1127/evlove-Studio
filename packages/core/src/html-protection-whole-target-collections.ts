import { wholeTargetName as name, wholeTargetMember as member, wholeTargetBinding as binding, wholeTargetConst, wholeTargetRange as range, wholeTargetBindingFact, wholeTargetWrites, wholeTargetFunctions, type WholeTargetNode as Node, type WholeTargetAst, type WholeTargetRange } from './html-protection-whole-target-ast';
export type WholeTargetCollection={kind:'global-document'|'query'|'element-query'|'element-of'|'array-copy'|'map'|'filter'|'children'|'literal-array'|'unresolved';range:WholeTargetRange;selector?:string;binding?:ReturnType<typeof wholeTargetBindingFact>;source?:WholeTargetCollection;receiver?:WholeTargetCollection;callbackRange?:WholeTargetRange;initialLength?:number;itemRanges?:WholeTargetRange[];gaps:string[]};
/** Symbolic collection/receiver lineage only. Native intermediate DOM and intrinsic behavior are separate obligations. */
export function wholeTargetCollection(node:Node,ast:WholeTargetAst,seen=new Set<Node>(),depth=0):WholeTargetCollection{
 const unresolved=(gap:string):WholeTargetCollection=>({kind:'unresolved',range:range(node),gaps:[gap]});if(depth>=24||seen.has(node))return unresolved('recursive-or-capacity-target-lineage');seen=new Set(seen).add(node);
 const next=(n:Node)=>wholeTargetCollection(n,ast,seen,depth+1),parents=ast.parents.get(node)??[],id=name(node);
 if(id){const selected=binding(id,parents);if(!selected)return id==='document'?{kind:'global-document',range:range(node),gaps:['global-document-native-binding-required']}:unresolved('unbound-target-identifier');
  if(wholeTargetConst(selected,ast)&&selected.init){const value=next(selected.init as Node);return{...value,binding:wholeTargetBindingFact(selected,ast),gaps:[...value.gaps,...(wholeTargetWrites(selected,ast).length?['target-binding-source-writes']:[])]};}
  const owner=ast.parents.get(selected)?.at(-1);if(selected.type==='Identifier'&&owner&&wholeTargetFunctions.has(String(owner.type))&&(owner.params as Node[])[0]===selected){const call=ast.parents.get(owner)?.at(-1);if(call?.type==='CallExpression'&&(call.arguments as Node[])[0]===owner&&['forEach','map','filter','every'].includes(member(call.callee as Node)??'')){const source=next((call.callee as Node).object as Node);return{kind:'element-of',range:range(node),binding:wholeTargetBindingFact(selected,ast),source,callbackRange:range(owner),gaps:[...source.gaps,'actual-callback-element-identity-required']};}}
  return{...unresolved('nearer-target-binding-not-an-immutable-collection'),binding:wholeTargetBindingFact(selected,ast)};
 }
 if(node.type==='ArrayExpression'){const elements=node.elements as Array<Node|null>;if(elements.length===1&&elements[0]?.type==='SpreadElement'){const source=next(elements[0].argument as Node);return{kind:'array-copy',range:range(node),source,gaps:[...source.gaps,'native-array-copy-intrinsics-required']};}if(elements.some(n=>n===null||n?.type==='SpreadElement'))return unresolved('sparse-or-spread-array-domain-unresolved');return{kind:'literal-array',range:range(node),initialLength:elements.length,itemRanges:elements.map(n=>range(n!)),gaps:['literal-array-values-and-mutations-require-causal-readback']};}
 if(node.type==='MemberExpression'&&member(node)==='children'){const receiver=next(node.object as Node);return{kind:'children',range:range(node),receiver,gaps:[...receiver.gaps,'live-children-epoch-required']};}
 if(node.type!=='CallExpression')return unresolved('unsupported-target-expression');
 const args=node.arguments as Node[],callee=node.callee as Node,method=member(callee);
 if(['querySelectorAll','querySelector'].includes(method??'')){
  if(args.length!==1||args[0]?.type!=='StringLiteral')return unresolved('dynamic-target-selector');const receiver=next(callee.object as Node),selector=String(args[0].value);if(selector.length>2048)return unresolved('target-selector-capacity');
  return{kind:method==='querySelectorAll'?'query':'element-query',range:range(node),selector,receiver,gaps:[...receiver.gaps,'native-query-result-at-owner-entry-required']};
 }
 if(['map','filter'].includes(method??'')){
  if(args.length!==1)return unresolved('collection-transform-call-domain');const source=next(callee.object as Node),callback=args[0]!,selected=name(callback)?binding(name(callback)!,parents):undefined,fn=wholeTargetConst(selected,ast)?selected!.init as Node:callback;
  return{kind:method as 'map'|'filter',range:range(node),source,callbackRange:range(fn),gaps:[...source.gaps,'native-array-transform-intrinsics-required',...(method==='filter'?['filter-predicate-and-query-continuity-required']:['mapped-value-dependency-required'])]};
 }
 const helper=name(callee),selected=helper?binding(helper,parents):undefined;if(helper&&wholeTargetConst(selected,ast)&&!wholeTargetWrites(selected!,ast).length){
  const fn=selected!.init as Node,params=fn?.params as Node[],body=fn?.body as Node,elements=body?.type==='ArrayExpression'?body.elements as Node[]:[],spread=elements[0],query=spread?.argument as Node;
  const first=name(params?.[0]),second=params?.[1]?.type==='AssignmentPattern'?name(params[1].left):undefined;
  if(fn?.type==='ArrowFunctionExpression'&&params.length===2&&first&&second&&name(params[1]!.right)==='document'&&elements.length===1&&spread?.type==='SpreadElement'&&query?.type==='CallExpression'&&member(query.callee as Node)==='querySelectorAll'&&name((query.callee as Node).object)===second&&(query.arguments as Node[]).length===1&&name((query.arguments as Node[])[0])===first&&args[0]?.type==='StringLiteral'&&args.length<=2){
   const receiver=args[1]?next(args[1]):next(params[1]!.right as Node);return{kind:'query',range:range(node),selector:String(args[0].value),receiver,binding:wholeTargetBindingFact(selected,ast),gaps:[...receiver.gaps,'native-helper-query-at-owner-entry-required']};
  }
 }
 return unresolved('unrecognized-or-shadowed-target-helper');
}
export function wholeTargetSelectorSet(value:WholeTargetCollection):string[]{return[...new Set([...(value.selector?[value.selector]:[]),...(value.source?wholeTargetSelectorSet(value.source):[]),...(value.receiver?wholeTargetSelectorSet(value.receiver):[])])];}
