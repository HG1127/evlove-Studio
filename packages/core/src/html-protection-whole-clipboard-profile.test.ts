// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { htmlProtectionWholeRuntimeSourcePlan } from './html-protection-whole-runtime-plan';
import { htmlProtectionWholeClipboardValueProfiles as compile, selectHtmlProtectionWholeClipboardValueProfile as select } from './html-protection-whole-clipboard-profile';
const plan=(code:string)=>htmlProtectionWholeRuntimeSourcePlan({original:{sourceArtifactId:'source',sha256:'a'.repeat(64),byteLength:code.length},html:'<html><head></head><body><article class="slide-card" id="one">synthetic</article><script>'+code+'</script></body></html>'});
const direct='document.querySelectorAll(".copy").forEach(b=>b.addEventListener("click",()=>{const el=document.getElementById(b.dataset.copy);if(!el)return;navigator.clipboard.writeText(el.innerText).then(()=>0);}));';
const clone='const qsa=(s,el=document)=>[...el.querySelectorAll(s)];qsa(".copy").forEach(b=>b.addEventListener("click",()=>{const card=document.getElementById(b.dataset.slide);const copy=card.cloneNode(true);qsa(".copy-button",copy).forEach(x=>x.remove());navigator.clipboard.writeText(copy.innerText.trim());}));';
describe('complete Original clipboard value expression programs',()=>{
 it('compiles the complete current-arm native text dependency instead of old Original body text',()=>{const result=compile(plan(direct));expect(result.profiles[0]?.program).toEqual({kind:'control-dataset-element-text',datasetProperty:'copy',clone:false,removeSelectors:[],getter:'innerText',trim:false});expect(result.unresolved).toEqual([]);expect(result.supportedParentIds).toEqual([]);});
 it('retains the exact native detached clone/removal/getter/trim algorithm',()=>{const result=compile(plan(clone));expect(result.profiles[0]?.program).toEqual({kind:'control-dataset-element-text',datasetProperty:'slide',clone:true,removeSelectors:['.copy-button'],getter:'innerText',trim:true});expect(result.unresolved).toEqual([]);});
 it('requires actual native lexical readback for a const boot value and never equates it with visible current body text',()=>{const result=compile(plan('const raw=unresolved();button.addEventListener("click",()=>navigator.clipboard.writeText(raw));'));expect(result.profiles[0]?.program).toEqual({kind:'native-lexical-string',bindingName:'raw'});expect(result.supportedParentIds).toEqual([]);expect(compile(plan('let raw=unresolved();button.addEventListener("click",()=>navigator.clipboard.writeText(raw));')).profiles).toEqual([]);});
 it('rejects shadowed native receiver and unknown remove-helper behavior',()=>{expect(compile(plan('const document=other;'+direct)).profiles).toEqual([]);expect(compile(plan(clone.replace('const qsa=(s,el=document)=>[...el.querySelectorAll(s)];','const qsa=unknown;'))).profiles).toEqual([]);});
 it('chooses only the unique native callback position and leaves fake/reordered positions unresolved',()=>{const source=plan(direct),profile=compile(source).profiles[0]!,nativeEvents={value:{handlerRealm:{frameId:"owned-frame",uniqueContextId:"owned-realm"},receivers:[{index:0,kind:'node',backendNodeId:9,listeners:[{type:'click',lineNumber:2,columnNumber:profile.handlerRange.start+5,scriptId:'physical-script'}]}]}};expect(select({sourcePlan:source,subjectScriptLocations:[{parentId:profile.parentId,line:2,column:5}],nativeEvents}).availability).toBe('available');nativeEvents.value.receivers[0]!.listeners[0]!.columnNumber=0;expect(select({sourcePlan:source,subjectScriptLocations:[{parentId:profile.parentId,line:2,column:5}],nativeEvents}).availability).toBe('unavailable');});
 it.each([
  direct.replace('if(!el)return;','el.textContent="later";'),
  direct.replace('()=>{const el','(b)=>{const el'),
  direct.replace('const el=document.getElementById(b.dataset.copy);','const el=document.getElementById(b.dataset.copy);custom();'),
  clone.replace('const qsa=(s,el=document)=>[...el.querySelectorAll(s)];','let qsa=(s,el=document)=>[...el.querySelectorAll(s)];'),
  clone.replace('qsa(".copy").forEach(b=>b.addEventListener','function install(qsa){qsa(".copy").forEach(b=>b.addEventListener')+'}install(custom);',
  clone.replace('qsa(".copy-button",copy).forEach(x=>x.remove());','if(flag)qsa(".copy-button",copy).forEach(x=>x.remove());'),
  'const raw="outside";button.addEventListener("click",raw=>navigator.clipboard.writeText(raw));',
  'const raw="outside";button.addEventListener("click",()=>{if(true){var raw="shadow";}navigator.clipboard.writeText(raw);});',
  'const raw="outside";button.addEventListener("click",()=>{function raw(){}navigator.clipboard.writeText(raw);});',
 ])('retains an unclosed clipboard binding/prefix/removal as unknown',source=>expect(compile(plan(source)).profiles).toEqual([]));
 it.each(['window','globalThis','self'])('rejects mutable clipboard intrinsic aliases through %s',root=>expect(compile(plan('const c='+root+'.navigator.clipboard;c.writeText=()=>0;'+direct)).profiles).toEqual([]));
 it.each(['Object.assign(Clipboard.prototype,{writeText:other});','const get=Reflect.get;const p=get(Clipboard,"prototype");p.writeText=other;','let p;p=navigator.clipboard;p.writeText=other;'])('keeps reflective/indirect clipboard native mutation unknown',source=>expect(compile(plan(source+direct)).profiles).toEqual([]));

 it('does not bind an ancestor or foreign physical listener to the clicked control',()=>{const source=plan(direct),profile=compile(source).profiles[0]!;for(const foreign of ['ancestor','backend']){const row={index:foreign==='ancestor'?1:0,kind:'node' as const,backendNodeId:9,listeners:[{type:'click',lineNumber:2,columnNumber:profile.handlerRange.start+5,scriptId:'physical-script',backendNodeId:foreign==='backend'?10:9}]};expect(select({sourcePlan:source,subjectScriptLocations:[{parentId:profile.parentId,line:2,column:5}],nativeEvents:{value:{handlerRealm:{frameId:'frame',uniqueContextId:'realm'},receivers:[row]}}}).availability).toBe('unavailable');}});

});
