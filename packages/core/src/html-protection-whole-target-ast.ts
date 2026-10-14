export type WholeTargetNode=Record<string,unknown>;
export type WholeTargetRange={start:number;end:number};
type Node=WholeTargetNode;
export const wholeTargetFunctions=new Set(['ArrowFunctionExpression','FunctionExpression','FunctionDeclaration','ObjectMethod','ClassMethod','ClassPrivateMethod']);
export const wholeTargetName=(n:unknown)=>n&&typeof n==='object'&&(n as Node).type==='Identifier'?String((n as Node).name):undefined;
export const wholeTargetMember=(n:Node|undefined)=>n&&['MemberExpression','OptionalMemberExpression'].includes(String(n.type))?n.computed?(n.property as Node)?.type==='StringLiteral'?String((n.property as Node).value):undefined:wholeTargetName(n.property):undefined;
export const wholeTargetRange=(n:Node):WholeTargetRange=>({start:Number(n.start),end:Number(n.end)});
export function walkWholeTargetAst(value:unknown,visit:(n:Node,ancestors:Node[])=>void,ancestors:Node[]=[]){if(!value||typeof value!=='object')return;if(Array.isArray(value)){value.forEach(n=>walkWholeTargetAst(n,visit,ancestors));return;}const n=value as Node;visit(n,ancestors);for(const[k,v]of Object.entries(n))if(!['loc','comments','extra'].includes(k))walkWholeTargetAst(v,visit,[...ancestors,n]);}
export type WholeTargetAst={root:Node;parents:Map<Node,Node[]>};
export function indexWholeTargetAst(root:Node):WholeTargetAst{const parents=new Map<Node,Node[]>();walkWholeTargetAst(root,(n,p)=>{if(parents.size>=100_000)throw Error('target-ast-node-capacity');parents.set(n,p);});return{root,parents};}
function binds(n:Node|undefined,id:string):boolean{if(!n)return false;if(wholeTargetName(n)===id)return true;if(n.type==='AssignmentPattern')return binds(n.left as Node,id);if(n.type==='RestElement')return binds(n.argument as Node,id);if(n.type==='ObjectPattern')return(n.properties as Node[]).some(p=>binds((p.value??p.argument) as Node,id));if(n.type==='ArrayPattern')return(n.elements as Node[]).some(p=>binds(p,id));return false;}
function declaredBinding(statement:Node,id:string):Node|undefined{
 const declaration=['ExportNamedDeclaration','ExportDefaultDeclaration'].includes(String(statement.type))?statement.declaration as Node|undefined:statement;
 if(!declaration)return;
 if(['FunctionDeclaration','ClassDeclaration'].includes(String(declaration.type))&&wholeTargetName(declaration.id)===id)return declaration;
 if(declaration.type==='VariableDeclaration')return(declaration.declarations as Node[]).find(d=>binds(d.id as Node,id));
 if(declaration.type==='ImportDeclaration'){const specifier=(declaration.specifiers as Node[]).find(n=>wholeTargetName(n.local)===id);if(specifier)return specifier.local as Node;}
}
function hoistedBinding(scope:Node,id:string):Node|undefined{
 let result:Node|undefined;
 walkWholeTargetAst(scope.body,(node,parents)=>{
  if(parents.some(parent=>wholeTargetFunctions.has(String(parent.type))||['ClassDeclaration','ClassExpression','StaticBlock'].includes(String(parent.type))))return;
  if(node.type==='FunctionDeclaration'&&wholeTargetName(node.id)===id)result=node;
  if(node.type==='VariableDeclaration'&&node.kind==='var')for(const declaration of node.declarations as Node[])if(binds(declaration.id as Node,id))result=declaration;
 });return result;
}
export function wholeTargetBinding(id:string,ancestors:Node[]):Node|undefined{
 for(const scope of [...ancestors].reverse()){
  // An unsupported dynamic lexical environment is a barrier, never a reason to borrow an outer declaration.
  if(scope.type==='WithStatement')return scope;
  if(['BlockStatement','Program','StaticBlock'].includes(String(scope.type)))for(const statement of scope.body as Node[]){const declared=declaredBinding(statement,id);if(declared)return declared;}
  if(scope.type==='SwitchStatement')for(const item of scope.cases as Node[])for(const statement of item.consequent as Node[]){const declared=declaredBinding(statement,id);if(declared)return declared;}
  if(['ClassDeclaration','ClassExpression'].includes(String(scope.type))&&wholeTargetName(scope.id)===id)return scope.id as Node;
  if(['Program','StaticBlock'].includes(String(scope.type))){const hoisted=hoistedBinding(scope,id);if(hoisted)return hoisted;}
  if(['ForStatement','ForInStatement','ForOfStatement'].includes(String(scope.type))){const decl=(scope.init??scope.left) as Node|undefined;if(decl?.type==='VariableDeclaration')for(const d of decl.declarations as Node[])if(binds(d.id as Node,id))return d;}
  if(scope.type==='CatchClause'&&binds(scope.param as Node,id))return scope.param as Node;
  if(wholeTargetFunctions.has(String(scope.type))){
   const param=(scope.params as Node[]).find(p=>binds(p,id));if(param)return param;
   if(scope.type==='FunctionExpression'&&wholeTargetName(scope.id)===id)return scope.id as Node;
   const hoisted=hoistedBinding(scope,id);if(hoisted)return hoisted;
  }
 }return;
}
export function wholeTargetConst(n:Node|undefined,ast:WholeTargetAst){return n?.type==='VariableDeclarator'&&wholeTargetName(n.id)!==undefined&&ast.parents.get(n)?.at(-1)?.type==='VariableDeclaration'&&ast.parents.get(n)?.at(-1)?.kind==='const';}
export function wholeTargetBindingFact(n:Node|undefined,ast:WholeTargetAst){if(!n)return null;const p=ast.parents.get(n)??[],owner=[...p].reverse().find(x=>wholeTargetFunctions.has(String(x.type)));return{range:wholeTargetRange(n),nodeType:String(n.type),declarationKind:ast.parents.get(n)?.at(-1)?.type==='VariableDeclaration'?String(ast.parents.get(n)?.at(-1)?.kind):'parameter-or-function',ownerFunctionRange:owner?wholeTargetRange(owner):null};}
export function wholeTargetWrites(binding:Node,ast:WholeTargetAst){const writes:Array<{range:WholeTargetRange;kind:string}>=[];walkWholeTargetAst(ast.root,(n,p)=>{if(!['AssignmentExpression','UpdateExpression','UnaryExpression'].includes(String(n.type))||(n.type==='UnaryExpression'&&n.operator!=='delete'))return;let target=(n.left??n.argument) as Node;while(target&&['MemberExpression','OptionalMemberExpression'].includes(String(target.type)))target=target.object as Node;const id=wholeTargetName(target);if(id&&wholeTargetBinding(id,p)===binding)writes.push({range:wholeTargetRange(n),kind:String(n.type)});});return writes;}
