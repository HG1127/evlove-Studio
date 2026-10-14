import { wholeTargetName as name, wholeTargetMember as member, wholeTargetBinding as binding, wholeTargetRange as range, wholeTargetBindingFact, wholeTargetWrites, wholeTargetFunctions, type WholeTargetNode as Node, type WholeTargetAst, type WholeTargetRange } from './html-protection-whole-target-ast';
export type WholeTargetGuard={range:WholeTargetRange;truth:boolean;origin:'ancestor-branch'|'short-circuit'|'prior-exit';constraint:'length'|'index-upper-bound'|'lookup-truthy';minimumLength?:number;maximumLength?:number;indexBinding?:ReturnType<typeof wholeTargetBindingFact>;interveningDirectWriteCount:number;causalApplicability:'unverified';gaps:string[]};
const within=(node:Node|undefined,read:Node)=>Boolean(node&&Number(node.start)<=Number(read.start)&&Number(read.end)<=Number(node.end));
const exits=(node:Node|undefined):boolean=>Boolean(node&&(['ReturnStatement','ThrowStatement'].includes(String(node.type))||(node.type==='BlockStatement'&&(node.body as Node[]).length===1&&exits((node.body as Node[])[0]))));
/** Exact control-flow facts only; unknown call effects, alias writes and native receiver state remain explicit. */
export function wholeTargetGuards(read:Node,target:Node|undefined,ast:WholeTargetAst):WholeTargetGuard[]{
 if(!target)return[];const all=ast.parents.get(read)??[],ownFunction=all.findLastIndex(n=>wholeTargetFunctions.has(String(n.type))),parents=all.slice(ownFunction+1),conditions:Array<{test:Node;truth:boolean;origin:WholeTargetGuard['origin']}>=[];
 for(const node of parents){
  if(node.type==='IfStatement'){if(within(node.consequent as Node,read))conditions.push({test:node.test as Node,truth:true,origin:'ancestor-branch'});else if(within(node.alternate as Node,read))conditions.push({test:node.test as Node,truth:false,origin:'ancestor-branch'});}
  if(['WhileStatement','ForStatement'].includes(String(node.type))&&node.test&&within(node.body as Node,read))conditions.push({test:node.test as Node,truth:true,origin:'ancestor-branch'});
  if(node.type==='LogicalExpression'&&within(node.right as Node,read)&&['&&','||'].includes(String(node.operator)))conditions.push({test:node.left as Node,truth:node.operator==='&&',origin:'short-circuit'});
  if(node.type==='BlockStatement')for(const statement of node.body as Node[]){if(Number(statement.end)>Number(read.start)||statement.type!=='IfStatement')continue;if(exits(statement.consequent as Node)&&!statement.alternate)conditions.push({test:statement.test as Node,truth:false,origin:'prior-exit'});else if(exits(statement.alternate as Node)&&!statement.consequent)conditions.push({test:statement.test as Node,truth:true,origin:'prior-exit'});}
 }
 const result:WholeTargetGuard[]=[];
 const targetOf=(node:Node|undefined)=>node&&name(node.object)&&binding(name(node.object)!,ast.parents.get(node)??[])===target;
 const add=(test:Node,truth:boolean,origin:WholeTargetGuard['origin'],constraint:WholeTargetGuard['constraint'],fields:Partial<WholeTargetGuard>={})=>{const writes=wholeTargetWrites(target,ast).filter(write=>write.range.start>Number(test.end)&&write.range.start<Number(read.start));result.push({range:range(test),truth,origin,constraint,...fields,interveningDirectWriteCount:writes.length,causalApplicability:'unverified',gaps:[...writes.map(()=> 'intervening-target-write'), 'native-intrinsics-and-causal-target-epoch-required']});};
 function infer(test:Node,truth:boolean,origin:WholeTargetGuard['origin']){
  if(test.type==='UnaryExpression'&&test.operator==='!'){infer(test.argument as Node,!truth,origin);return;}
  if(test.type==='LogicalExpression'&&((test.operator==='&&'&&truth)||(test.operator==='||'&&!truth))){infer(test.left as Node,truth,origin);infer(test.right as Node,truth,origin);return;}
  if(test.type==='MemberExpression'&&member(test)==='length'&&targetOf(test)){add(test,truth,origin,'length',truth?{minimumLength:1}:{minimumLength:0,maximumLength:0});return;}
  if(test.type==='MemberExpression'&&test.computed&&targetOf(test)&&sameKey(test.property as Node,read.property as Node,ast)){if(truth)add(test,truth,origin,'lookup-truthy');return;}
  if(test.type!=='BinaryExpression')return;const left=test.left as Node,right=test.right as Node,op=String(test.operator);
  if(member(right)==='length'&&targetOf(right)&&name(left)&&op==='<'&&truth){const index=binding(name(left)!,ast.parents.get(left)??[]);if(index&&sameKey(left,read.property as Node,ast))add(test,truth,origin,'index-upper-bound',{indexBinding:wholeTargetBindingFact(index,ast)});return;}
  if(member(left)!=='length'||!targetOf(left)||right.type!=='NumericLiteral'||!Number.isSafeInteger(right.value)||Number(right.value)<0)return;const value=Number(right.value);let minimumLength:number|undefined,maximumLength:number|undefined;
  if((['===','=='].includes(op)&&truth)||(['!==','!='].includes(op)&&!truth))minimumLength=maximumLength=value;
  else if((op==='>='&&truth)||(op==='<'&&!truth))minimumLength=value;
  else if((op==='>'&&truth)||(op==='<='&&!truth))minimumLength=value+1;
  else if((op==='<='&&truth)||(op==='>'&&!truth))maximumLength=value;
  else if((op==='<'&&truth)||(op==='>='&&!truth))maximumLength=value-1;
  if(minimumLength!==undefined||maximumLength!==undefined)add(test,truth,origin,'length',{...(minimumLength===undefined?{}:{minimumLength}),...(maximumLength===undefined?{}:{maximumLength})});
 }
 for(const condition of conditions)infer(condition.test,condition.truth,condition.origin);return[...new Map(result.map(item=>[item.range.start+':'+item.truth+':'+item.constraint,item])).values()];
}
function sameKey(a:Node,b:Node,ast:WholeTargetAst){if(a.type==='NumericLiteral'&&b.type==='NumericLiteral')return a.value===b.value;if(a.type==='StringLiteral'&&b.type==='StringLiteral')return a.value===b.value;const id=name(a);return id&&id===name(b)&&binding(id,ast.parents.get(a)??[])===binding(id,ast.parents.get(b)??[]);}
