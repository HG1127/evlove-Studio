import { parse } from "@babel/parser";
import { z } from "zod";
import type { HtmlProtectionWholeRuntimeSourcePlan } from "@evolution/contracts";
import { htmlProtectionScriptEffectProfile } from "./html-protection-script-effect-profile";
const id=z.string().min(1),position=z.number().int().nonnegative(),digest=z.string().regex(/^[a-f0-9]{64}$/);
const native=z.object({realm:z.object({frameId:id,loaderId:id,uniqueContextId:id}).strict(),stability:z.object({preMirrorSha256:digest,postMirrorSha256:digest,mutationEvents:z.literal(0)}).strict(),value:z.object({producer:z.literal('chromium-native-complete-propagation-listeners-v1'),handlerRealm:z.object({frameId:id,uniqueContextId:id}).strict(),receivers:z.array(z.object({index:position,backendNodeId:z.number().int().positive().nullable(),kind:z.enum(['node','window']),listeners:z.array(z.object({type:id,useCapture:z.boolean(),passive:z.boolean(),once:z.boolean(),scriptId:id,lineNumber:position,columnNumber:position,backendNodeId:z.number().int().positive().optional()}).strict()).max(5000)}).strict()).min(2).max(129),limitations:z.array(z.string())}).strict()}).strict();
const coverage=z.object({producer:z.literal('chromium-v8-precise-source-coverage-v1'),frameId:id,scripts:z.array(z.object({scriptId:id,parentId:id,sourceCharacters:position,contextUniqueId:id,frameId:id,nativeSourceLocation:z.object({line:position,column:position}).strict()}).passthrough()).max(128),unmatched:z.array(z.unknown()),missingParentIds:z.array(id),gaps:z.array(z.string())}).passthrough();
type AstNode=Record<string,unknown>;
const functions=new Set(['ArrowFunctionExpression','FunctionExpression','FunctionDeclaration']);
const member=(node:AstNode|undefined)=>node?.type==='MemberExpression'&&!node.computed&&(node.property as AstNode)?.type==='Identifier'?(node.property as AstNode).name:undefined;
/** Exact native listener/source occurrence binding. It is not evidence that a callback ran or succeeded. */
export function assessHtmlProtectionWholeHandlerSourceBindings(args:{sourcePlan:HtmlProtectionWholeRuntimeSourcePlan;nativeEvents:unknown;nativeSourceCoverage:unknown;expectedFrame:{frameId:string;loaderId:string};targetBackendNodeId:number}){
 const observed=native.safeParse(args.nativeEvents),scripts=coverage.safeParse(args.nativeSourceCoverage),gaps=new Set<string>();
 const bindings:Array<{receiverIndex:number;receiverBackendNodeId:number|null;eventType:string;scriptId:string;parentId:string|null;functionId:string|null;nativeSourceOffset:number|null;sourceRange:{start:number;end:number}|null;verificationStatus:'partial'|'unverified';gaps:string[]}> = [];
 if(!observed.success||!scripts.success)return{policyVersion:'whole-native-listener-source-occurrence-v1',bindings,gaps:['native-listener-source-material-invalid'],supportedParentIds:[] as string[]};
 const material=observed.data,program=scripts.data,receivers=material.value.receivers;
 const nodes=receivers.filter(row=>row.kind==='node');
 if(material.realm.frameId!==args.expectedFrame.frameId||material.realm.loaderId!==args.expectedFrame.loaderId||material.value.handlerRealm.frameId!==args.expectedFrame.frameId||program.frameId!==args.expectedFrame.frameId||material.stability.preMirrorSha256!==material.stability.postMirrorSha256)gaps.add('native-listener-source-owner-drift');
 if(receivers.some((row,index)=>row.index!==index||row.kind!==(index+1===receivers.length?'window':'node')||(row.kind==='window')!==(row.backendNodeId===null))||nodes[0]?.backendNodeId!==args.targetBackendNodeId||new Set(nodes.map(row=>row.backendNodeId)).size!==nodes.length||receivers.reduce((sum,row)=>sum+row.listeners.length,0)>5000)gaps.add('native-listener-propagation-scope-incomplete');
 if(program.unmatched.length||program.missingParentIds.length||program.gaps.length||new Set(program.scripts.map(row=>row.scriptId)).size!==program.scripts.length||new Set(program.scripts.map(row=>row.parentId)).size!==program.scripts.length)gaps.add('native-listener-source-domain-unresolved');
 for(const receiver of receivers)for(const listener of receiver.listeners){
  const local=new Set(gaps),matches=program.scripts.filter(row=>row.scriptId===listener.scriptId),actual=matches.length===1?matches[0]:undefined;
  const source=actual&&args.sourcePlan.scriptShape.find(row=>row.id===actual.parentId),literal=source?.literal?.replace(/\r\n?/g,'\n');
  let offset:number|null=null,functionId:string|null=null,sourceRange:{start:number;end:number}|null=null;
  if(!actual||!source||literal===undefined||actual.frameId!==args.expectedFrame.frameId||actual.contextUniqueId!==material.value.handlerRealm.uniqueContextId||actual.sourceCharacters!==literal.length)local.add('native-listener-source-occurrence-unbound');
  else{
   offset=sourceOffset(literal,actual.nativeSourceLocation,{line:listener.lineNumber,column:listener.columnNumber});
   if(offset===null)local.add('native-listener-source-position-outside-program');
   else{const registrations=eventRegistrations(literal).filter(row=>row.eventType===listener.type&&row.callbackRange.start<=offset!&&offset!<row.callbackRange.end);
    if(registrations.length!==1)local.add('native-listener-exact-callback-registration-unresolved');
    else{const profile=htmlProtectionScriptEffectProfile({parentId:source.id,literal}),registration=registrations[0]!,found=profile.functions.filter(row=>row.sourceRange.start===registration.callbackRange.start&&row.sourceRange.end===registration.callbackRange.end);
     if(found.length!==1)local.add('native-listener-function-identity-unresolved');else{functionId=found[0]!.id;sourceRange=found[0]!.sourceRange;}
    }
   }
  }
  bindings.push({receiverIndex:receiver.index,receiverBackendNodeId:receiver.backendNodeId,eventType:listener.type,scriptId:listener.scriptId,parentId:source?.id??null,functionId,nativeSourceOffset:offset,sourceRange,verificationStatus:local.size?'unverified':'partial',gaps:[...local].sort()});for(const gap of local)gaps.add(gap);
 }
 return{policyVersion:'whole-native-listener-source-occurrence-v1',bindings,gaps:[...gaps].sort(),supportedParentIds:[] as string[],limitations:['App must first authenticate the complete physical native/source records and independently derived Original plan.','An exact registered function position proves registry ownership only; complete successful effect causality, all future states and native default behavior remain separate.']};
}
function sourceOffset(literal:string,start:{line:number;column:number},actual:{line:number;column:number}){
 const row=actual.line-start.line,lines=literal.split('\n');if(row<0||row>=lines.length)return null;const column=actual.column-(row===0?start.column:0);if(column<0||column>lines[row]!.length)return null;const offset=lines.slice(0,row).reduce((sum,line)=>sum+line.length+1,0)+column;return offset<literal.length?offset:null;
}
function eventRegistrations(literal:string){
 const rows:Array<{eventType:string;callbackRange:{start:number;end:number}}>=[];
 try{const ast=parse(literal,{sourceType:'unambiguous'});function walk(value:unknown){if(!value||typeof value!=='object')return;if(Array.isArray(value)){value.forEach(walk);return}const node=value as AstNode;
  if(node.type==='CallExpression'&&member(node.callee as AstNode)==='addEventListener'){const args=node.arguments as AstNode[],event=args[0],callback=args[1];if(event?.type==='StringLiteral'&&callback&&functions.has(String(callback.type))&&Number.isSafeInteger(callback.start)&&Number.isSafeInteger(callback.end))rows.push({eventType:String(event.value),callbackRange:{start:Number(callback.start),end:Number(callback.end)}});}
  for(const[key,child]of Object.entries(node))if(!['loc','comments','extra'].includes(key))walk(child);
 }walk(ast);}catch{/* An unavailable complete AST never manufactures registrations. */}return rows;
}
