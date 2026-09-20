import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

const base = process.argv[2] || 'http://127.0.0.1:8000/__runner';
async function post(route, body) {
  const response = await fetch(`${base}/${route}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(60000) });
  assert.equal(response.status, 200);
  return response.json();
}
const ping = await post('run', { ping: true });
assert.equal(ping.protocol, 'evolve-runner/2');
assert.equal(ping.capabilities.htmlBrowser, true);
const artifact = { name: 'runner-smoke.html', content: '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>真实验证</title></head><body><button id="save" onclick="document.getElementById(\'status\').textContent=\'已保存\'">保存</button><p id="status">等待</p></body></html>' };
const result = await post('run', { artifact, testCase: { id: 'actual-click', browserSteps: [{ action: 'click', selector: '#save' }, { action: 'text', selector: '#status', value: '已保存' }] } });
assert.equal(result.verificationStatus, 'verified');
assert.equal(result.artifactHash, createHash('sha256').update(artifact.content).digest('hex'));
assert.deepEqual(result.screenshots.map((shot) => shot.width), [1440, 390]);
assert.ok(result.screenshots.every((shot) => shot.artifactHash === result.artifactHash));
const negative = await post('run', { artifact, testCase: { id: 'wrong-assertion', browserSteps: [{ action: 'text', selector: '#status', value: '已保存' }] } });
assert.equal(negative.verificationStatus, 'failed');
const release = await post('release', { action: 'promote' });
assert.equal(release.ok, false);
console.log('PASS：同域 Runner 协议、真实点击与断言、双视口截图、SHA-256 一致、错误断言失败；未配置 Production Release 环境时 /release 继续 fail-closed。');
