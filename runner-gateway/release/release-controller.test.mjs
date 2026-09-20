import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createProductionReleaseController } from './release-controller.mjs';
import { createReleaseStore } from './release-store.mjs';

function candidate() {
  return { id: 'cand-1', name: 'candidate', artifactSnapshots: [{ sourceArtifactId: 'source', name: 'agent.json', mimeType: 'application/json', content: '{"v":2}', contentHash: 'hash-v2' }] };
}
function config(stateFile) {
  return {
    enabled: true, deployUrl: 'https://release.test/deploy', trafficUrl: 'https://release.test/traffic', telemetryUrl: 'https://release.test/telemetry',
    platformToken: 'server-secret', environment: 'production', stateFile, timeoutMs: 1000, allowInsecureHttp: false,
    shadowMirrorPercent: 100, shadowSideEffectPolicy: 'block-writes',
    policies: { shadow: { minSampleSize: 2, minWindowMinutes: 0 }, 'canary-5': { minSampleSize: 2, minWindowMinutes: 1 }, 'canary-20': { minSampleSize: 2, minWindowMinutes: 1 }, 'canary-50': { minSampleSize: 2, minWindowMinutes: 1 }, promote: { minSampleSize: 2, minWindowMinutes: 1 } },
  };
}
function response(body) { return { ok: true, status: 200, json: async () => body }; }

function harness(telemetrySequence = []) {
  const dir = mkdtempSync(path.join(tmpdir(), 'evolve-release-test-'));
  const stateFile = path.join(dir, 'state.json');
  const calls = [];
  let telemetryIndex = 0;
  const fetchImpl = async (url, options) => {
    const body = JSON.parse(options.body); calls.push({ url, body, headers: options.headers });
    if (url.endsWith('/deploy')) return response({ ok: true, deploymentId: 'candidate-deploy', stableDeploymentId: 'stable-deploy', artifactHashes: [{ sourceArtifactId: 'source', contentHash: 'hash-v2' }], stableArtifactHashes: [{ sourceArtifactId: 'source', contentHash: 'hash-v1' }], environment: 'production' });
    if (url.endsWith('/traffic')) return response({ ok: true, trafficPercent: body.candidateTrafficPercent, observedAt: '2026-09-16T06:30:00.000Z' });
    if (url.endsWith('/telemetry')) return response(telemetrySequence[Math.min(telemetryIndex++, telemetrySequence.length - 1)] || { ok: true, healthy: true, sampleSize: 10, windowMinutes: 10, observedAt: '2026-09-16T06:40:00.000Z', kpis: [{ key: 'success', label: 'Success', value: 99, unit: '%', target: 95, direction: 'higher' }] });
    throw new Error(`unexpected ${url}`);
  };
  const controller = createProductionReleaseController({ config: config(stateFile), store: createReleaseStore(stateFile), fetchImpl, now: () => '2026-09-16T06:45:00.000Z' });
  return { dir, stateFile, calls, controller, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

const request = (action) => ({ projectId: 'project', connectionId: 'production', candidate: candidate(), action });

test('unconfigured release fails closed and never claims live evidence', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'evolve-release-off-'));
  try {
    const off = { ...config(path.join(dir, 'state.json')), enabled: false, deployUrl: '', trafficUrl: '', telemetryUrl: '' };
    const controller = createProductionReleaseController({ config: off, store: createReleaseStore(off.stateFile), fetchImpl: async () => { throw new Error('must not call'); } });
    const result = await controller.release(request('shadow'));
    assert.equal(result.ok, false); assert.equal(result.evidenceMode, 'simulation'); assert.equal(controller.capability().enabled, false);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('shadow deploys once, blocks side effects and recheck promotes observation to healthy', async () => {
  const h = harness([
    { ok: true, healthy: true, sampleSize: 1, windowMinutes: 0, observedAt: 't1', kpis: [{ key: 'success', label: 'Success', value: 99, target: 95, direction: 'higher' }] },
    { ok: true, healthy: true, sampleSize: 3, windowMinutes: 1, observedAt: 't2', kpis: [{ key: 'success', label: 'Success', value: 99, target: 95, direction: 'higher' }] },
  ]);
  try {
    const first = await h.controller.release(request('shadow'));
    assert.equal(first.evidenceMode, 'live'); assert.equal(first.observationStatus, 'observing'); assert.equal(first.healthy, false);
    const traffic = h.calls.find((call) => call.url.endsWith('/traffic'))?.body;
    assert.equal(traffic.shadow, true); assert.equal(traffic.mirrorPercent, 100); assert.equal(traffic.sideEffectPolicy, 'block-writes'); assert.equal(traffic.candidateTrafficPercent, 0);
    const second = await h.controller.release(request('shadow'));
    assert.equal(second.observationStatus, 'healthy'); assert.equal(second.healthy, true);
    assert.equal(h.calls.filter((call) => call.url.endsWith('/deploy')).length, 1);
    assert.equal(h.calls.filter((call) => call.url.endsWith('/traffic')).length, 1);
    assert.match(String(h.calls[0].headers.Authorization), /server-secret/);
  } finally { h.cleanup(); }
});

test('unhealthy canary automatically restores stable traffic and reports effective rollback', async () => {
  const h = harness([
    { ok: true, healthy: true, sampleSize: 3, windowMinutes: 1, observedAt: 'shadow-ok', kpis: [{ key: 'success', label: 'Success', value: 99, target: 95, direction: 'higher' }] },
    { ok: true, healthy: false, sampleSize: 10, windowMinutes: 5, observedAt: 'canary-bad', note: 'error rate high', kpis: [{ key: 'success', label: 'Success', value: 80, target: 95, direction: 'higher' }] },
    { ok: true, healthy: true, sampleSize: 20, windowMinutes: 5, observedAt: 'stable-ok', kpis: [{ key: 'success', label: 'Success', value: 99, target: 95, direction: 'higher' }] },
  ]);
  try {
    assert.equal((await h.controller.release(request('shadow'))).healthy, true);
    const result = await h.controller.release(request('canary-5'));
    assert.equal(result.effectiveAction, 'rollback'); assert.equal(result.trafficPercent, 0); assert.equal(result.evidenceMode, 'live'); assert.equal(result.observationStatus, 'healthy');
    const trafficCalls = h.calls.filter((call) => call.url.endsWith('/traffic')).map((call) => call.body);
    assert.equal(trafficCalls.some((call) => call.action === 'canary-5' && call.candidateTrafficPercent === 5), true);
    assert.equal(trafficCalls.at(-1).action, 'rollback'); assert.equal(trafficCalls.at(-1).stableTrafficPercent, 100);
  } finally { h.cleanup(); }
});

test('promote requires a healthy 50% canary and moves candidate to stable without redeploying', async () => {
  const h = harness();
  try {
    const store = createReleaseStore(h.stateFile);
    store.set('project::production', {
      phase: 'canary-50', environment: 'production', trafficPercent: 50, observationStatus: 'healthy', healthy: true,
      candidateId: 'cand-1', candidateDeploymentId: 'candidate-deploy', candidateArtifactHashes: [{ sourceArtifactId: 'source', contentHash: 'hash-v2' }],
      stableDeploymentId: 'stable-deploy', stableArtifactHashes: [{ sourceArtifactId: 'source', contentHash: 'hash-v1' }], sampleSize: 100, windowMinutes: 30,
      kpis: [{ key: 'success', label: 'Success', value: 99, unit: '%', target: 95, direction: 'higher' }], observedAt: 'canary50-ok', history: [],
    });
    const result = await h.controller.release(request('promote'));
    assert.equal(result.effectiveAction, 'promote'); assert.equal(result.trafficPercent, 100); assert.equal(result.healthy, true); assert.equal(result.stableDeploymentId, 'candidate-deploy');
    assert.equal(h.calls.filter((call) => call.url.endsWith('/deploy')).length, 0);
    assert.equal(h.calls.find((call) => call.url.endsWith('/traffic'))?.body.action, 'promote');
  } finally { h.cleanup(); }
});
