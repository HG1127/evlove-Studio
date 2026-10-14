import type { HtmlProtectionWholeClipboardValueProgram } from "@evolution/contracts";
export type ClipboardSourceNode=Record<string,unknown>;
type Node=ClipboardSourceNode;
export const clipboardNodeName=(node:unknown)=>node&&typeof node==='object'&&(node as Node).type==='Identifier'?String((node as Node).name):undefined;
export const clipboardNodeMember=(node:Node|undefined)=>node?.type==='MemberExpression'&&!node.computed?clipboardNodeName(node.property):undefined;
const name=clipboardNodeName,member=clipboardNodeMember,functions=new Set(['ArrowFunctionExpression','FunctionExpression','FunctionDeclaration']);
export function visitClipboardSource(value:unknown,callback:(node:Node,ancestors:Node[])=>void,ancestors:Node[]=[]){if(!value||typeof value!=='object')return;if(Array.isArray(value)){value.forEach(item=>visitClipboardSource(item,callback,ancestors));return;}const node=value as Node;callback(node,ancestors);for(const[key,child]of Object.entries(node))if(!['loc','comments','extra'].includes(key))visitClipboardSource(child,callback,[...ancestors,node]);}
function binds(node:Node|undefined,id:string):boolean{if(!node)return false;if(name(node)===id)return true;if(node.type==='AssignmentPattern')return binds(node.left as Node,id);if(node.type==='RestElement')return binds(node.argument as Node,id);if(node.type==='ObjectPattern')return(node.properties as Node[]).some(p=>binds((p.value??p.argument) as Node,id));if(node.type==='ArrayPattern')return(node.elements as Node[]).some(p=>binds(p,id));return false;}
function binding(id:string,ancestors:Node[]):Node|undefined{
 for(const scope of [...ancestors].reverse()){
  if(['BlockStatement','Program'].includes(String(scope.type)))for(const statement of scope.body as Node[]){if(statement.type==='FunctionDeclaration'&&name(statement.id)===id)return statement;if(statement.type==='VariableDeclaration')for(const declaration of statement.declarations as Node[])if(binds(declaration.id as Node,id))return declaration;}
  if(scope.type==='CatchClause'&&binds(scope.param as Node,id))return scope.param as Node;
  if(functions.has(String(scope.type))){const param=(scope.params as Node[]).find(p=>binds(p,id));if(param)return param;let hoisted:Node|undefined;visitClipboardSource(scope.body,(node,parents)=>{if(parents.some(p=>functions.has(String(p.type))))return;if(node.type==='FunctionDeclaration'&&name(node.id)===id)hoisted=node;if(node.type==='VariableDeclaration'&&node.kind==='var')for(const declaration of node.declarations as Node[])if(binds(declaration.id as Node,id))hoisted=declaration;});if(hoisted)return hoisted;}
 }return;
}
function immutableConst(declaration:Node|undefined,ancestors:Node[]){if(declaration?.type!=='VariableDeclarator'||!name(declaration.id)||!declaration.init)return false;return ancestors.some(scope=>['BlockStatement','Program'].includes(String(scope.type))&&(scope.body as Node[]).some(statement=>statement.type==='VariableDeclaration'&&statement.kind==='const'&&(statement.declarations as Node[]).includes(declaration)));}
function declarator(statement:Node|undefined){return statement?.type==='VariableDeclaration'&&statement.kind==='const'&&(statement.declarations as Node[]).length===1?(statement.declarations as Node[])[0]:undefined;}
function getterTarget(init:Node|undefined,receiver:string){if(init?.type!=='CallExpression'||member(init.callee as Node)!=='getElementById'||name((init.callee as Node).object)!=='document'||(init.arguments as Node[]).length!==1)return;const property=(init.arguments as Node[])[0]!,dataset=property.object as Node;if(member(dataset)!=='dataset'||name(dataset.object)!==receiver)return;const key=member(property);return key&&/^[a-z][a-zA-Z0-9]*$/.test(key)&&!['constructor','prototype'].includes(key)?key:undefined;}
function standardQueryHelper(node:Node,ancestors:Node[],ast:Node){
 const id=name(node.callee),selected=id?binding(id,ancestors):undefined;if(!id||!immutableConst(selected,ancestors))return false;
 let mutable=false;visitClipboardSource(ast,item=>{if(['AssignmentExpression','UpdateExpression'].includes(String(item.type))&&name(item.left??item.argument)===id)mutable=true;});if(mutable)return false;
 const helper=selected!.init as Node,params=helper?.params as Node[],body=helper?.body as Node;if(helper?.type!=='ArrowFunctionExpression'||params?.length!==2||params[0]?.type!=='Identifier'||params[1]?.type!=='AssignmentPattern'||name(params[1].right)!=='document'||!name(params[1].left)||body?.type!=='ArrayExpression'||(body.elements as Node[]).length!==1)return false;
 const spread=(body.elements as Node[])[0]!,query=spread.argument as Node;return spread.type==='SpreadElement'&&query?.type==='CallExpression'&&member(query.callee as Node)==='querySelectorAll'&&name((query.callee as Node).object)===name(params[1].left)&&(query.arguments as Node[]).length===1&&name((query.arguments as Node[])[0])===name(params[0]);
}
function removal(statement:Node,owner:string,ancestors:Node[],ast:Node){
 const outer=statement.type==='ExpressionStatement'?statement.expression as Node:undefined;if(outer?.type!=='CallExpression'||member(outer.callee as Node)!=='forEach'||(outer.arguments as Node[]).length!==1)return;
 const callback=(outer.arguments as Node[])[0]!,params=callback.params as Node[],remove=callback.body as Node,collection=(outer.callee as Node).object as Node;
 if(callback.type!=='ArrowFunctionExpression'||params.length!==1||!name(params[0])||remove.type!=='CallExpression'||member(remove.callee as Node)!=='remove'||name((remove.callee as Node).object)!==name(params[0])||(remove.arguments as Node[]).length!==0||collection.type!=='CallExpression')return;
 const args=collection.arguments as Node[];if(args[0]?.type!=='StringLiteral')return;
 const direct=member(collection.callee as Node)==='querySelectorAll'&&name((collection.callee as Node).object)===owner&&args.length===1;
 const helper=args.length===2&&name(args[1])===owner&&standardQueryHelper(collection,ancestors,ast);
 return direct||helper?String(args[0].value):undefined;
}
/** A deliberately finite source grammar; arbitrary prefix calls, shadows and extra value writes retain unknown status. */
export function clipboardValueProgramFromSource(args:{write:Node;handler:Node;registration:Node;ancestors:Node[];ast:Node}):HtmlProtectionWholeClipboardValueProgram|undefined{
 const{write,handler,registration,ancestors,ast}=args,body=handler.body as Node,statements=body.type==='BlockStatement'?body.body as Node[]:[],last=statements.at(-1),root=body.type==='BlockStatement'&&last?.type==='ExpressionStatement'?last.expression as Node:body;
 if(!(root===write||(root.type==='CallExpression'&&member(root.callee as Node)==='then'&&(root.callee as Node).object===write&&(root.arguments as Node[]).length===1))||(write.arguments as Node[]).length!==1)return;
 const prefix=body.type==='BlockStatement'?statements.slice(0,-1):[];let value=(write.arguments as Node[])[0]!,trim=false;
 if(value.type==='CallExpression'&&member(value.callee as Node)==='trim'&&(value.arguments as Node[]).length===0){trim=true;value=(value.callee as Node).object as Node;}
 if(value.type==='StringLiteral'&&!prefix.length)return{kind:'literal',text:trim?String(value.value).trim():String(value.value)};
 if(value.type==='Identifier'&&!trim&&!prefix.length){const selected=binding(name(value)!,ancestors);if(!immutableConst(selected,ancestors)||Number(selected!.start)>=Number(handler.start))return;return{kind:'native-lexical-string',bindingName:name(value)!};}
 if(value.type!=='MemberExpression'||!['innerText','textContent'].includes(String(member(value))))return;
 const owner=name(value.object),receiver=name((registration.callee as Node).object),atRegistration=ancestors.slice(0,ancestors.indexOf(registration));
 if(!owner||!receiver||!binding(receiver,atRegistration)||binding(receiver,atRegistration)!==binding(receiver,ancestors))return;
 const source=declarator(prefix[0]),sourceId=source&&name(source.id),key=source&&getterTarget(source.init as Node,receiver);if(!sourceId||!key||binding(sourceId,ancestors)!==source)return;
 let clone=false,position=1;const copy=declarator(prefix[position]);if(copy&&name(copy.id)===owner){const init=copy.init as Node;if(init?.type!=='CallExpression'||member(init.callee as Node)!=='cloneNode'||name((init.callee as Node).object)!==sourceId||(init.arguments as Node[]).length!==1||(init.arguments as Node[])[0]?.type!=='BooleanLiteral'||(init.arguments as Node[])[0]?.value!==true||binding(owner,ancestors)!==copy)return;clone=true;position++;}else if(owner!==sourceId)return;
 if(prefix[position]?.type==='IfStatement'){const guard=prefix[position]!,test=guard.test as Node,consequent=guard.consequent as Node;if(guard.alternate||test?.type!=='UnaryExpression'||test.operator!=='!'||name(test.argument)!==sourceId||consequent?.type!=='ReturnStatement'||consequent.argument)return;position++;}
 const removeSelectors:string[]=[];for(const statement of prefix.slice(position)){if(!clone)return;const selector=removal(statement,owner,ancestors,ast);if(selector===undefined)return;removeSelectors.push(selector);}
 return{kind:'control-dataset-element-text',datasetProperty:key,clone,removeSelectors,getter:member(value) as 'innerText'|'textContent',trim};
}
/** The main-world methods used by the handler cannot be assumed pristine if complete source mutates their aliases. */
export function hasKnownClipboardSourceEnvironment(asts:Node[]){
 let known=true;const protectedNames=['navigator','document','String','Array','Node','Element','HTMLElement','Document','Navigator','Clipboard','Object','Reflect','Function','Proxy'],aliases=new Set(protectedNames),globals=new Set(['window','globalThis','self']);
 const origin=(value:Node|undefined)=>{const keys:string[]=[];let dynamic=false;while(value&&['MemberExpression','OptionalMemberExpression'].includes(String(value.type))){const key=value.computed?(value.property as Node)?.type==='StringLiteral'?String((value.property as Node).value):undefined:name(value.property);if(key===undefined)dynamic=true;else keys.unshift(key);value=value.object as Node;}const root=name(value);if(aliases.has(root??''))return dynamic?'unknown':'intrinsic';if(globals.has(root??'')){if(dynamic)return'unknown';if(!keys.length)return'global';if(aliases.has(keys[0]!))return'intrinsic';}return'other';};
 for(let pass=0;pass<64;pass++){let changed=false;for(const ast of asts)visitClipboardSource(ast,node=>{if(node.type!=='VariableDeclarator')return;const source=origin(node.init as Node);if(source==='unknown'){known=false;return;}if(['intrinsic','global'].includes(source)){const id=name(node.id),set=source==='global'?globals:aliases;if(!id)known=false;else if(!set.has(id)){set.add(id);changed=true;}}});if(!changed)break;if(pass===63)known=false;}
 for(const ast of asts)visitClipboardSource(ast,node=>{
  if(node.type==='VariableDeclarator'&&[...protectedNames,'window','globalThis','self'].some(id=>binds(node.id as Node,id)))known=false;
  if(functions.has(String(node.type))&&(node.params as Node[]).some(param=>[...protectedNames,'window','globalThis','self'].some(id=>binds(param,id))))known=false;
  if(['AssignmentExpression','UpdateExpression'].includes(String(node.type))&&(['intrinsic','unknown'].includes(origin((node.left??node.argument) as Node))||(node.type==='AssignmentExpression'&&['intrinsic','unknown'].includes(origin(node.right as Node)))))known=false;
  if(['CallExpression','OptionalCallExpression','NewExpression'].includes(String(node.type))){const callee=node.callee as Node,method=member(callee);if(['eval','Function'].includes(name(callee)??'')||['defineProperty','defineProperties','setPrototypeOf','getPrototypeOf','getOwnPropertyDescriptor','assign','__defineGetter__','__defineSetter__'].includes(method??'')||(method==='set'&&['intrinsic','unknown'].includes(origin(callee)))||(aliases.has(name(callee)??'')&&!protectedNames.includes(name(callee)!))||(callee?.computed&&['intrinsic','unknown'].includes(origin(callee))))known=false;}
 });return known;
}
