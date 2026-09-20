import { releaseCapability, releaseConfigFromEnv } from './config.mjs';
import { postReleaseJson } from './http-adapter.mjs';
import { createReleaseStore } from './release-store.mjs';

export const RELEASE_ACTIONS = ['shadow', 'canary-5', 'canary-20', 'canary-50', 'promote', 'rollback'];
const PHASE = { shadow: 'shadow', 'canary-5': 'canary-5', 'canary-20': 'canary-20', 'canary-50': 'canary-50', promote: 'promoted', rollback: 'rolled-back' };
const PREVIOUS = { shadow: ['idle', 'promoted', 'rolled-back'], 'canary-5': ['shadow'], 'canary-20': ['canary-5'], 'canary-50': ['canary-20'], promote: ['canary-50'] };
const TRAFFIC = { shadow: 0, 'canary-5': 5, 'canary-20': 20, 'canary-50': 50, promote: 100, rollback: 0 };

function hashList(candidate) {
  const snapshots = candidate?.artifactSnapshots;
  if (!candidate?.id || !Array.isArray(snapshots) || !snapshots.length) throw new Error('生产发布缺少 Candidate Artifact Snapshot。');
  const hashes = snapshots.map((item) => ({ sourceArtifactId: String(item.sourceArtifactId || ''), contentHash: String(item.contentHash || '') }));
  if (hashes.some((item) => !item.sourceArtifactId || !item.contentHash)) throw new Error('生产发布要求每个 Artifact Snapshot 都具有 contentHash。');
  if (new Set(hashes.map((item) => item.sourceArtifactId)).size !== hashes.length) throw new Error('生产发布 Artifact Snapshot 存在重复 sourceArtifactId。');
  return hashes;
}

function sameHashes(expected = [], actual = []) {
  return expected.length === actual.length && expected.every((item) => actual.some((other) => other.sourceArtifactId === item.sourceArtifactId && other.contentHash === item.contentHash));
}

function kpiTargetsHealthy(kpis) {
  if (!Array.isArray(kpis)) return false;
  return kpis.filter((item) => Number.isFinite(item?.target)).every((item) => {
    const value = Number(item.value); const target = Number(item.target);
    if (!Number.isFinite(value) || !Number.isFinite(target)) return false;
    return item.direction === 'lower' ? value <= target : value >= target;
  });
}

function initialState(environment) {
  return { phase: 'idle', environment, trafficPercent: 0, observationStatus: 'observing', history: [] };
}

function appendHistory(state, entry) {
  return { ...state, history: [...(state.history || []), entry].slice(-120) };
}

function liveResult(state, { ok = true, note, effectiveAction, healthy = state.observationStatus === 'healthy' } = {}) {
  return {
    ok,
    trafficPercent: Number(state.trafficPercent || 0),
    note,
    healthy,
    kpis: Array.isArray(state.kpis) ? state.kpis : [],
    evidenceMode: 'live',
    effectiveAction,
    observationStatus: state.observationStatus,
    deploymentId: state.phase === 'rolled-back' ? state.stableDeploymentId : state.candidateDeploymentId,
    stableDeploymentId: state.stableDeploymentId,
    artifactHashes: state.phase === 'rolled-back' ? state.stableArtifactHashes : state.candidateArtifactHashes,
    environment: state.environment,
    observedAt: state.observedAt,
    sampleSize: Number.isFinite(state.sampleSize) ? state.sampleSize : 0,
    windowMinutes: Number.isFinite(state.windowMinutes) ? state.windowMinutes : 0,
  };
}

export function createProductionReleaseController({ config = releaseConfigFromEnv(), store = createReleaseStore(config.stateFile), fetchImpl = globalThis.fetch, now = () => new Date().toISOString() } = {}) {
  const locks = new Map();
  const post = (url, body) => postReleaseJson(url, body, { token: config.platformToken, timeoutMs: config.timeoutMs, allowInsecureHttp: config.allowInsecureHttp, fetchImpl });

  async function withLock(key, task) {
    const previous = locks.get(key) || Promise.resolve();
    let release;
    const current = new Promise((resolve) => { release = resolve; });
    const chain = previous.then(() => current);
    locks.set(key, chain);
    await previous;
    try { return await task(); }
    finally { release(); if (locks.get(key) === chain) locks.delete(key); }
  }

  function persist(key, state, event) {
    const stamped = appendHistory({ ...state, updatedAt: now() }, { at: now(), ...event });
    store.set(key, stamped);
    return stamped;
  }

  async function deployCandidate(body, state, expectedHashes) {
    const artifacts = body.candidate.artifactSnapshots.map((item) => ({
      sourceArtifactId: item.sourceArtifactId,
      name: item.name,
      mimeType: item.mimeType,
      content: item.content,
      contentHash: item.contentHash,
    }));
    const result = await post(config.deployUrl, {
      operation: 'deploy-candidate', protocol: 'evolve-release/1',
      projectId: body.projectId, connectionId: body.connectionId, environment: config.environment,
      candidateId: body.candidate.id, candidateName: body.candidate.name,
      artifacts, expectedArtifactHashes: expectedHashes,
      previousStableDeploymentId: state.stableDeploymentId,
    });
    if (result?.ok !== true || typeof result.deploymentId !== 'string' || !result.deploymentId) throw new Error('部署平台未返回有效 deploymentId。');
    if (!sameHashes(expectedHashes, result.artifactHashes)) throw new Error('部署平台回执的 Artifact Hash 与已验收 Candidate 不一致。');
    return {
      ...state,
      candidateId: body.candidate.id,
      candidateDeploymentId: result.deploymentId,
      candidateArtifactHashes: expectedHashes,
      stableDeploymentId: typeof result.stableDeploymentId === 'string' && result.stableDeploymentId ? result.stableDeploymentId : state.stableDeploymentId,
      stableArtifactHashes: Array.isArray(result.stableArtifactHashes) ? result.stableArtifactHashes : state.stableArtifactHashes,
      environment: typeof result.environment === 'string' && result.environment ? result.environment : config.environment,
    };
  }

  async function applyTraffic(body, state, action) {
    if (action !== 'shadow' && action !== 'rollback' && !state.stableDeploymentId) throw new Error(`${action} 需要 stableDeploymentId 才能安全切流/回滚。`);
    if (action === 'rollback' && !state.stableDeploymentId) throw new Error('没有 stableDeploymentId，无法执行真实 Rollback。');
    const trafficPercent = TRAFFIC[action];
    const result = await post(config.trafficUrl, {
      operation: 'set-traffic', protocol: 'evolve-release/1', action,
      projectId: body.projectId, connectionId: body.connectionId, environment: state.environment || config.environment,
      stableDeploymentId: state.stableDeploymentId,
      candidateDeploymentId: state.candidateDeploymentId,
      candidateTrafficPercent: trafficPercent,
      stableTrafficPercent: action === 'rollback' ? 100 : Math.max(0, 100 - trafficPercent),
      shadow: action === 'shadow',
      mirrorPercent: action === 'shadow' ? config.shadowMirrorPercent : 0,
      sideEffectPolicy: action === 'shadow' ? config.shadowSideEffectPolicy : 'live',
    });
    if (result?.ok !== true) throw new Error(`流量平台拒绝 ${action}。`);
    if (Number(result.trafficPercent) !== trafficPercent) throw new Error(`流量平台回执不一致：期望 Candidate ${trafficPercent}%，实际 ${String(result.trafficPercent)}%。`);
    return { ...state, trafficPercent, observedAt: typeof result.observedAt === 'string' ? result.observedAt : now() };
  }

  async function observe(body, state, action) {
    let result;
    try {
      result = await post(config.telemetryUrl, {
        operation: 'observe-release', protocol: 'evolve-release/1', action,
        projectId: body.projectId, connectionId: body.connectionId, environment: state.environment || config.environment,
        stableDeploymentId: state.stableDeploymentId,
        candidateDeploymentId: state.candidateDeploymentId,
        deploymentId: state.candidateDeploymentId,
        trafficPercent: state.trafficPercent,
      });
    } catch (error) {
      return { ...state, observationStatus: 'observing', healthy: false, sampleSize: 0, windowMinutes: 0, kpis: [], observedAt: now(), observationNote: `生产流量已生效，但 Telemetry 暂不可用：${error instanceof Error ? error.message : String(error)}` };
    }
    if (result?.ok !== true) return { ...state, observationStatus: 'observing', healthy: false, sampleSize: 0, windowMinutes: 0, kpis: [], observedAt: now(), observationNote: String(result?.note || 'Telemetry 尚未返回可用观测。') };
    const sampleSize = Math.max(0, Math.trunc(Number(result.sampleSize) || 0));
    const windowMinutes = Math.max(0, Number(result.windowMinutes) || 0);
    const kpis = Array.isArray(result.kpis) ? result.kpis : [];
    const policy = config.policies[action] || { minSampleSize: 1, minWindowMinutes: 1 };
    const enough = sampleSize >= policy.minSampleSize && windowMinutes >= policy.minWindowMinutes;
    const healthy = result.healthy === true && kpiTargetsHealthy(kpis);
    return {
      ...state,
      sampleSize,
      windowMinutes,
      kpis,
      healthy: enough && healthy,
      observationStatus: !enough ? 'observing' : healthy ? 'healthy' : 'unhealthy',
      observedAt: typeof result.observedAt === 'string' ? result.observedAt : now(),
      observationNote: !enough
        ? `观察中：样本 ${sampleSize}/${policy.minSampleSize}，窗口 ${windowMinutes}/${policy.minWindowMinutes} 分钟。`
        : healthy ? '生产 KPI 达到当前阶段门槛。' : String(result.note || '生产 KPI 未达到当前阶段门槛。'),
    };
  }

  async function rollback(body, key, state, notePrefix = 'Rollback') {
    const rolled = await applyTraffic(body, state, 'rollback');
    let telemetry = rolled;
    try {
      const result = await post(config.telemetryUrl, {
        operation: 'observe-release', protocol: 'evolve-release/1', action: 'rollback',
        projectId: body.projectId, connectionId: body.connectionId, environment: rolled.environment || config.environment,
        deploymentId: rolled.stableDeploymentId, stableDeploymentId: rolled.stableDeploymentId,
        candidateDeploymentId: rolled.candidateDeploymentId, trafficPercent: 0,
      });
      telemetry = { ...rolled, kpis: Array.isArray(result?.kpis) ? result.kpis : [], sampleSize: Math.max(0, Math.trunc(Number(result?.sampleSize) || 0)), windowMinutes: Math.max(0, Number(result?.windowMinutes) || 0), observedAt: typeof result?.observedAt === 'string' ? result.observedAt : rolled.observedAt, observationStatus: result?.healthy === true ? 'healthy' : 'observing', healthy: result?.healthy === true };
    } catch { telemetry = { ...rolled, observationStatus: 'observing', healthy: false }; }
    const finalState = persist(key, { ...telemetry, phase: 'rolled-back', trafficPercent: 0 }, { action: 'rollback', note: notePrefix });
    return liveResult(finalState, { effectiveAction: 'rollback', healthy: finalState.healthy === true, note: `${notePrefix}：Candidate 流量已归零，Stable 恢复 100%。` });
  }

  async function handle(body) {
    const action = String(body?.action || '');
    if (!RELEASE_ACTIONS.includes(action)) throw new Error(`不支持的发布动作：${action || '(empty)'}`);
    if (!config.enabled) {
      const capability = releaseCapability(config);
      return { ok: false, trafficPercent: 0, note: `真实发布未启用：${capability.diagnostic}`, healthy: false, kpis: [], evidenceMode: 'simulation', environment: config.environment, observedAt: now() };
    }
    if (typeof body?.projectId !== 'string' || !body.projectId || typeof body?.connectionId !== 'string' || !body.connectionId) throw new Error('发布请求缺少 projectId / connectionId。');
    const key = `${body.projectId}::${body.connectionId}`;
    return withLock(key, async () => {
      let state = store.get(key) || initialState(config.environment);
      if (action === 'rollback') return rollback(body, key, state, '人工 Rollback');

      const expectedHashes = hashList(body.candidate);
      const requestedPhase = PHASE[action];
      const sameCandidate = state.candidateId === body.candidate.id && sameHashes(expectedHashes, state.candidateArtifactHashes || []);
      const samePhase = state.phase === requestedPhase && sameCandidate;
      if (!samePhase) {
        const allowed = PREVIOUS[action] || [];
        if (!allowed.includes(state.phase)) throw new Error(`真实发布状态不允许 ${state.phase} → ${action}。`);
        if (['shadow', 'canary-5', 'canary-20', 'canary-50'].includes(state.phase) && state.observationStatus !== 'healthy') throw new Error(`当前 ${state.phase} 仍未达到健康观察门槛，禁止推进到 ${action}。`);
        if (action === 'shadow') {
          state = await deployCandidate(body, state, expectedHashes);
        } else {
          if (!sameCandidate || !state.candidateDeploymentId) throw new Error('发布 Candidate 与已部署/已验收 Candidate 不一致，必须从 Shadow 重新开始。');
        }
        if (action === 'promote') {
          if (state.observationStatus !== 'healthy') throw new Error('Canary 50% 尚未健康，禁止 Promote。');
          const promotedTraffic = await applyTraffic(body, state, 'promote');
          const promoted = persist(key, {
            ...promotedTraffic,
            phase: 'promoted', trafficPercent: 100, observationStatus: 'healthy', healthy: true,
            stableDeploymentId: state.candidateDeploymentId,
            stableArtifactHashes: state.candidateArtifactHashes,
          }, { action: 'promote', note: '基于 Canary 50% 已满足样本、观察窗口和 KPI 门槛，Candidate 提升为 Stable。' });
          return liveResult(promoted, { effectiveAction: 'promote', healthy: true, note: 'Promote 完成：Candidate 已成为 100% Stable；决策证据来自 Promote 前已通过的 Canary 50% 观测。' });
        }
        state = await applyTraffic(body, state, action);
        state = persist(key, { ...state, phase: requestedPhase, observationStatus: 'observing', healthy: false }, { action, note: `${action} 流量/Shadow 配置已真实生效，开始采集生产 Telemetry。` });
      }

      const observed = await observe(body, state, action);
      if (observed.observationStatus === 'unhealthy' && observed.stableDeploymentId) {
        store.set(key, observed);
        return rollback(body, key, observed, `${action} KPI 不健康，自动 Rollback`);
      }
      const settled = persist(key, observed, { action: `${action}:observe`, note: observed.observationNote || '生产观测已刷新。' });
      return liveResult(settled, {
        effectiveAction: action,
        healthy: settled.observationStatus === 'healthy',
        note: settled.observationStatus === 'healthy'
          ? `${action} 已达到生产观察门槛，可以进入下一阶段。`
          : settled.observationStatus === 'unhealthy'
            ? `${action} 指标不健康，推进已锁定。`
            : settled.observationNote || `${action} 正在等待足够生产样本。`,
      });
    });
  }

  return { capability: () => releaseCapability(config), release: handle };
}
