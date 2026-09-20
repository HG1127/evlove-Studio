import {test} from 'node:test';
import assert from 'node:assert/strict';
import {safeBuildPath,executeBuild} from './build-runner.mjs';
test('build extraction rejects traversal, absolute paths and vendored dependencies',()=>{
 for(const path of ['../a','/a','C:/a','a\\b','a/../b','node_modules/a','.git/config'])assert.equal(safeBuildPath(path),false);
 assert.equal(safeBuildPath('src/app.ts'),true);
});
test('unconfigured build returns unverified, never executes on host',async()=>{
 const previous=process.env.BUILD_IMAGE;delete process.env.BUILD_IMAGE;
 try{const result=await executeBuild({testCase:{id:'build'},archiveBase64:''});assert.equal(result.verificationStatus,'unverified');assert.match(result.output,/BUILD_IMAGE/);}finally{if(previous)process.env.BUILD_IMAGE=previous;}
});
