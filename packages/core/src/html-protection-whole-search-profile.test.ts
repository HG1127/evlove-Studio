// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { htmlProtectionWholeRuntimeSourcePlan } from './html-protection-whole-runtime-plan';
import { htmlProtectionWholeSearchPredicates as compile, evaluateHtmlProtectionWholeSearchPredicate as evaluate, selectHtmlProtectionWholeSearchPredicate as select } from './html-protection-whole-search-profile';
const plan=(code:string)=>htmlProtectionWholeRuntimeSourcePlan({original:{sourceArtifactId:'source',sha256:'a'.repeat(64),byteLength:code.length},html:'<html><head></head><body><script>'+code+'</script></body></html>'});
const code=(source:string,query:string)=>'document.querySelector("#search").addEventListener("input",e=>{document.querySelectorAll(".slide-card").forEach(card=>{const ok='+source+'.includes('+query+');card.classList.toggle("search-hidden",!ok);});});';
describe('Original-bound search predicate normalization facts',()=>{
 it('normalizes both operands only when the actual Original source does so',()=>{const profile=compile(plan(code('card.dataset.search.toLowerCase()','e.target.value.toLowerCase().trim()'))).profiles[0]!;expect(profile).toMatchObject({sourceNormalize:['lowercase'],queryNormalize:['lowercase','trim']});expect(evaluate(profile,'Alpha',' ALPHA ')).toBe(true);expect(evaluate(profile,'Alpha','missing')).toBe(false);});
 it('retains the exact case-sensitive source predicate',()=>{const profile=compile(plan(code('card.dataset.search','e.target.value'))).profiles[0]!;expect(profile).toMatchObject({sourceNormalize:[],queryNormalize:[]});expect(evaluate(profile,'Alpha','Alpha')).toBe(true);expect(evaluate(profile,'Alpha','alpha')).toBe(false);});
 it('supports the actual Original query-only normalization and equivalent empty-query guard',()=>{const source='const qsa=(s,el=document)=>[...el.querySelectorAll(s)];const s=document.querySelector("#search");s.addEventListener("input",()=>{const q=s.value.toLowerCase().trim();qsa(".slide-card").forEach(card=>{const ok=!q||card.dataset.search.includes(q);card.classList.toggle("search-hidden",!ok);});});';const profile=compile(plan(source)).profiles[0]!;expect(profile).toMatchObject({sourceNormalize:[],queryNormalize:['lowercase','trim']});expect(evaluate(profile,'alpha',' ALPHA ')).toBe(true);expect(evaluate(profile,'Alpha','Alpha')).toBe(false);});
 it.each([code('card.dataset.search','unknown(e.target.value)'),code('card.dataset.search','e.target.value').replace('.slide-card','.other'),code('card.dataset.search','e.target.value').replace('const ok','let ok')])('leaves unbound or mutable predicates unresolved instead of declaring product failure',source=>{expect(compile(plan(source)).profiles).toEqual([]);});
 it.each([
  'String.prototype.includes=()=>true;',
  'Object.defineProperty(String.prototype,"includes",{value:()=>true});',
  'eval("untrusted predicate");',
  'const document={querySelectorAll:()=>[]};',
 ])('does not infer a native search expectation when source changes the search environment: %s',prefix=>{expect(compile(plan(prefix+code('card.dataset.search','e.target.value'))).profiles).toEqual([]);});
 it('retains unknown actual input handlers as unavailable instead of assuming the one recognized handler controls membership',()=>{const source=plan(code('card.dataset.search','e.target.value')),profile=compile(source).profiles[0]!;const listener={type:'input',scriptId:'native-script',lineNumber:0,columnNumber:profile.handlerRange.start};const locations=[{parentId:profile.parentId,sourcePath:source.scriptShape[0]!.sourcePath,subjectSourcePath:source.scriptShape[0]!.sourcePath,line:0,column:0,sourceCharacters:source.scriptShape[0]!.literal!.length}];expect(select({sourcePlan:source,subjectScriptLocations:locations,nativeEvents:{value:{handlerRealm:{frameId:"owned-frame",uniqueContextId:"owned-realm"},receivers:[{listeners:[listener,{...listener,columnNumber:0}]}]}}})).toMatchObject({availability:'unavailable',gaps:['Original-search-extra-input-handler-unresolved']});});

 it.each([
  code('card.dataset.search','e.target.value').replace('const ok=', 'if(card.id==="always-visible")return;const ok='),
  code('card.dataset.search','e.target.value').replace('card.classList.toggle("search-hidden",!ok);', 'if(card.id!=="always-visible")card.classList.toggle("search-hidden",!ok);'),
  code('card.dataset.search','e.target.value').replace('card.classList.toggle("search-hidden",!ok);', '(()=>card.classList.toggle("search-hidden",!ok))();'),
  code('card.dataset.search','e.target.value').replace('document.querySelectorAll(".slide-card").forEach', 'if(e.target.value==="keep")return;document.querySelectorAll(".slide-card").forEach'),
 ])('keeps conditional/early-exit/nested per-card control flow unavailable: %s',source=>{expect(compile(plan(source)).profiles).toEqual([]);});

 it.each([
  code('card.dataset.search','q').replace('document.querySelectorAll(".slide-card").forEach', 'const q=e.target.value.toLowerCase();document.querySelectorAll(".slide-card").forEach').replace('const ok=', 'let q=e.target.value;const ok='),
  code('card.dataset.search','e.target.value').replace('card.classList.toggle("search-hidden",!ok);', 'card.classList.toggle("search-hidden",!ok);card.classList.remove("search-hidden");'),
  'const p=String.prototype;p.includes=()=>true;'+code('card.dataset.search','e.target.value'),
  'const s=document.querySelector("#search");s.addEventListener("input",s=>{document.querySelectorAll(".slide-card").forEach(card=>{const ok=card.dataset.search.includes(s.value);card.classList.toggle("search-hidden",!ok);});});',
  code('card.dataset.search','e.target.value').replace('const ok=', '{const e={target:{value:"other"}};const ok=').replace('card.classList.toggle("search-hidden",!ok);', 'card.classList.toggle("search-hidden",!ok);}'),
 ])('rejects nearer lexical shadows, extra class effects and intrinsic alias mutation: %s',source=>{expect(compile(plan(source)).profiles).toEqual([]);});

 it('supports only the exact Original unconditional toggle followed by its numeric handler-local counter tail',()=>{const source=code('card.dataset.search','e.target.value').replace('document.querySelectorAll(".slide-card").forEach','let shown=0;document.querySelectorAll(".slide-card").forEach').replace('card.classList.toggle("search-hidden",!ok);','card.classList.toggle("search-hidden",!ok);if(ok)shown++;');expect(compile(plan(source)).profiles).toHaveLength(1);for(const invalid of [source.replace('let shown=0','let shown=object'),source.replace('if(ok)shown++','if(ok)card.classList.remove("search-hidden")'),source.replace('if(ok)shown++','if(ok)shown++;else shown=0'),source.replace('if(ok)shown++','if(ok)shown++;shown="later"'),source.replace('if(ok)shown++','if(other)shown++')])expect(compile(plan(invalid)).profiles).toEqual([]);});

});
