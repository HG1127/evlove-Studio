import {test} from 'node:test';
import assert from 'node:assert/strict';
import {nativeCopyChecks} from './native-html-observer.mjs';

const good={kind:'.copy-slide[data-slide]',index:0,cardId:'slide-2',pass:true,fidelity:true,exactTrimmed:true,
 expectedSha256:'a'.repeat(64),sha256:'b'.repeat(64),expectedChars:10,chars:10};

test('retains an unchanged sentinel as a located failure without leaking clipboard plaintext',()=>{
 const row={...good,index:43,cardId:'slide-45',pass:false,fidelity:false,sha256:'c'.repeat(64),chars:18};
 const checks=nativeCopyChecks([good,row]);
 assert.deepEqual(checks.slice(0,2).map(c=>({pass:c.pass,tested:c.tested,failed:c.failed})),[{pass:false,tested:2,failed:1},{pass:false,tested:2,failed:1}]);
 assert.deepEqual(checks[0].copyFailures[0],{selector:row.kind,index:43,cardId:'slide-45',expectedSha256:row.expectedSha256,
  actualSha256:row.sha256,expectedChars:10,actualChars:18,reason:'clipboard-not-written'});
 assert.equal(checks[1].copyFailures[0].reason,'dom-content-mismatch');
 assert(!JSON.stringify(checks).includes('EVOLUTION_SENTINEL'));
});
test('preserves write success separately from content fidelity and prompt whitespace',()=>{
 const row={...good,kind:'.prompt-copy-all',fidelity:true,exactTrimmed:false};
 const checks=nativeCopyChecks([row]);
 assert.deepEqual(checks.map(c=>c.pass),[true,true,false]);
 assert.equal(checks[2].copyFailures[0].reason,'prompt-whitespace-mismatch');
 assert.deepEqual(checks[2].copyFailures[0].actualSha256,row.sha256);
});
test('records early exceptions without fabricating missing clipboard observations',()=>{
 const checks=nativeCopyChecks([{kind:'.copy-slide[data-slide]',index:7,pass:false,error:'TimeoutError'}]);
 for(const c of checks.slice(0,2))assert.deepEqual(c.copyFailures,[{selector:'.copy-slide[data-slide]',index:7,reason:'exception',errorName:'TimeoutError'}]);
});
test('keeps successful copies and the empty-control verdicts identical to the original formulas',()=>{
 for(const copies of [[],[good],[{...good,fidelity:false}],[{...good,kind:'.prompt-copy-all',exactTrimmed:false}]]){
  const checks=nativeCopyChecks(copies);
  assert.deepEqual(checks.map(c=>c.pass),[copies.length>0&&copies.every(c=>c.pass),copies.length>0&&copies.every(c=>c.fidelity),copies.filter(c=>c.kind==='.prompt-copy-all').every(c=>c.exactTrimmed)]);
 }
 assert(nativeCopyChecks([good]).every(c=>c.copyFailures.length===0));
});
