import { z } from "zod";
import type { HtmlProtectionWholeRuntimeRequest, HtmlProtectionWholeRuntimeActionFact, HtmlProtectionWholeClipboardValueProgram } from "@evolution/contracts";
import { selectHtmlProtectionWholeClipboardValueProfile } from "@evolution/core";
import { htmlProtectionCloudCanonicalJson as canonical } from "./vercel-sandbox-html-protection-cloud-protocol";
const identity=z.string().min(1),digest=z.string().regex(/^[a-f0-9]{64}$/),text=z.string().max(2*1024*1024);
const Source=z.object({parentId:identity,scriptId:identity,sourceSha256:digest,sourceCharacters:z.number().int().nonnegative(),frameId:identity,contextUniqueId:identity,url:z.string(),nativeSourceLocation:z.object({line:z.number().int().nonnegative(),column:z.number().int().nonnegative()}).strict()}).strict();
const Location=z.object({scriptId:identity,lineNumber:z.number().int().nonnegative(),columnNumber:z.number().int().nonnegative()}).strict();
const Value=z.object({text,sourceElement:z.object({id:identity,sourcePath:identity,tag:identity,removedFromDetachedClone:z.number().int().nonnegative()}).strict().nullable(),lexical:z.object({producer:z.literal('chromium-native-lexical-string-binding-v1'),backendNodeId:z.number().int().positive(),handlerRealm:z.object({frameId:identity,uniqueContextId:identity}).strict(),handler:Location,bindingName:identity,scopeIndex:z.number().int().min(0).max(128)}).strict().optional()}).strict();
const Window=z.object({realm:z.object({frameId:identity,loaderId:identity,uniqueContextId:identity}).strict(),stability:z.object({preMirrorSha256:digest,postMirrorSha256:digest,mutationEvents:z.literal(0)}).strict(),value:Value}).strict();
const Claim=z.object({availability:z.enum(['available','observed','failed','unavailable']),gaps:z.array(identity).min(1).optional(),profile:z.unknown().optional(),source:Source.optional(),before:Window.optional(),after:Window.optional()}).strict();
const Target=z.object({value:z.object({target:z.object({attributes:z.array(z.tuple([z.string(),z.string()]))}).passthrough()}).passthrough()}).passthrough();
/** Restore independently reselects the exact Original value program and binds all native reads to this physical arm. */
export function validateHtmlProtectionWholeClipboardReadback(args:{request:HtmlProtectionWholeRuntimeRequest;facts:HtmlProtectionWholeRuntimeActionFact[];sourceMaterial:unknown;custody:{frameId:string;loaderId:string}|undefined}){
 const sources=z.object({scripts:z.array(Source.passthrough()),unmatched:z.array(z.unknown()),missingParentIds:z.array(z.string())}).passthrough().safeParse(args.sourceMaterial),realms=new Set<string>();
 for(const fact of args.facts){if(fact.action.operation!=='copy'||fact.nativeObservation===undefined)continue;
  const observation=z.object({events:z.unknown().optional(),before:z.unknown().optional(),after:z.unknown().optional(),clipboardExpectation:z.unknown().optional(),clipboard:z.object({text,sentinelSha256:digest}).strict().optional()}).passthrough().parse(fact.nativeObservation);
  if(!observation.clipboardExpectation){if(fact.status==='observed'||fact.gaps.includes('actual-clipboard-value-mismatch'))throw Error('Whole clipboard lacks independent value material');continue;}
  const claim=Claim.parse(observation.clipboardExpectation),selected=selectHtmlProtectionWholeClipboardValueProfile({sourcePlan:args.request.sourcePlan,subjectScriptLocations:args.request.subjectScriptLocations,nativeEvents:observation.events});
  if(claim.availability==='unavailable'&&!claim.profile){if(!claim.gaps||fact.gaps.includes('actual-clipboard-value-mismatch'))throw Error('Whole unknown clipboard cannot claim a known failure');continue;}
  if(selected.availability!=='available'||canonical(selected.profile)!==canonical(claim.profile)||!claim.source||!claim.before||!sources.success)throw Error('Whole clipboard source/value program not independently bound');
  const actualRealm=z.object({realm:Window.shape.realm}).passthrough().parse(observation.before).realm;
  if(selected.profile.nativeBackendNodeId!==fact.beforeBackendNodeId)throw Error('Whole clipboard native listener target differs');
  const profile=selected.profile,source=sources.data.scripts.find(source=>source.scriptId===profile.nativeScriptId&&source.parentId===profile.parentId);
  if(!source||canonical(Source.strip().parse(source))!==canonical(claim.source)||source.contextUniqueId!==profile.nativeContextUniqueId||source.frameId!==profile.nativeFrameId)throw Error('Whole clipboard physical native script identity differs');
  for(const window of [claim.before,claim.after].filter(window=>window!==undefined)){
   if(!args.custody||window.realm.frameId!==args.custody.frameId||window.realm.loaderId!==args.custody.loaderId||window.realm.uniqueContextId!==actualRealm.uniqueContextId||window.stability.preMirrorSha256!==window.stability.postMirrorSha256)throw Error('Whole clipboard native value window differs');
   realms.add(window.realm.uniqueContextId);validateValue(window.value,profile.program,profile,fact,window===claim.before?observation.before:observation.after);
  }
  if(claim.availability==='available'){if(claim.after||fact.status==='observed'||fact.gaps.includes('actual-clipboard-value-mismatch'))throw Error('Whole clipboard unfinished value evidence claims completion');continue;}
  if(claim.availability==='unavailable'){if(!claim.gaps||fact.gaps.includes('actual-clipboard-value-mismatch'))throw Error('Whole clipboard unproved continuity cannot claim known failure');continue;}
  if(claim.availability==='failed')throw Error('Whole clipboard known failure lacks callback/value continuity authority');
  if(!claim.after||!observation.clipboard||claim.before.value.text!==claim.after.value.text)throw Error('Whole clipboard actual value did not remain stable at both boundaries');
  if(claim.before.value.text!==observation.clipboard.text||fact.status!=='observed')throw Error('Whole clipboard status differs from independently read native value');
 }
 if(realms.size>1)throw Error('Whole clipboard native expected values crossed realms');
}
function validateValue(value:z.infer<typeof Value>,program:HtmlProtectionWholeClipboardValueProgram,profile:{nativeScriptId:string;nativeLineNumber:number;nativeColumnNumber:number;nativeContextUniqueId:string;nativeFrameId:string},fact:HtmlProtectionWholeRuntimeActionFact,target:unknown){
 if(program.kind==='literal'){if(value.text!==program.text||value.sourceElement!==null||value.lexical)throw Error('Whole clipboard literal value differs');return;}
 if(program.kind==='native-lexical-string'){
  const lexical=value.lexical;if(value.sourceElement!==null||!lexical||lexical.backendNodeId!==fact.beforeBackendNodeId||lexical.handlerRealm.frameId!==profile.nativeFrameId||lexical.handlerRealm.uniqueContextId!==profile.nativeContextUniqueId||lexical.bindingName!==program.bindingName||canonical(lexical.handler)!==canonical({scriptId:profile.nativeScriptId,lineNumber:profile.nativeLineNumber,columnNumber:profile.nativeColumnNumber}))throw Error('Whole clipboard native lexical handler/binding differs');return;
 }
 const source=value.sourceElement,attributes=new Map(Target.parse(target).value.target.attributes),key='data-'+program.datasetProperty.replace(/[A-Z]/g,value=>'-'+value.toLowerCase());
 if(value.lexical||!source||source.id!==attributes.get(key)||(!program.clone&&source.removedFromDetachedClone!==0))throw Error('Whole clipboard native target dependency differs');
}
