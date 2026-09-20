import path from 'node:path';
import { tmpdir } from 'node:os';

function numberFrom(env, key, fallback, min = 0, max = Number.POSITIVE_INFINITY) {
  const raw = Number(env[key]);
  if (!Number.isFinite(raw)) return fallback;
  return Math.min(max, Math.max(min, raw));
}

function policy(env, prefix, fallbackSample, fallbackWindow) {
  return {
    minSampleSize: Math.trunc(numberFrom(env, `RELEASE_${prefix}_MIN_SAMPLE_SIZE`, fallbackSample, 0, 10_000_000)),
    minWindowMinutes: numberFrom(env, `RELEASE_${prefix}_MIN_WINDOW_MINUTES`, fallbackWindow, 0, 10_080),
  };
}

/** Server-side only. Production platform credentials never need to reach the browser. */
export function releaseConfigFromEnv(env = process.env) {
  const deployUrl = String(env.RELEASE_DEPLOY_URL || '').trim();
  const trafficUrl = String(env.RELEASE_TRAFFIC_URL || '').trim();
  const telemetryUrl = String(env.RELEASE_TELEMETRY_URL || '').trim();
  const canary50 = policy(env, 'CANARY_50', 1, 1);
  return {
    enabled: Boolean(deployUrl && trafficUrl && telemetryUrl),
    deployUrl,
    trafficUrl,
    telemetryUrl,
    platformToken: String(env.RELEASE_PLATFORM_TOKEN || ''),
    environment: String(env.RELEASE_ENVIRONMENT || 'production'),
    stateFile: String(env.RELEASE_STATE_FILE || path.join(tmpdir(), 'evolve-production-release-state-v1.json')),
    timeoutMs: Math.trunc(numberFrom(env, 'RELEASE_REQUEST_TIMEOUT_MS', 45_000, 1_000, 300_000)),
    allowInsecureHttp: String(env.RELEASE_ALLOW_INSECURE_HTTP || '') === '1',
    shadowMirrorPercent: numberFrom(env, 'RELEASE_SHADOW_MIRROR_PERCENT', 100, 0, 100),
    shadowSideEffectPolicy: String(env.RELEASE_SHADOW_SIDE_EFFECT_POLICY || 'block-writes'),
    policies: {
      shadow: policy(env, 'SHADOW', 1, 0),
      'canary-5': policy(env, 'CANARY_5', 1, 1),
      'canary-20': policy(env, 'CANARY_20', 1, 1),
      'canary-50': canary50,
      promote: policy(env, 'PROMOTE', canary50.minSampleSize, canary50.minWindowMinutes),
    },
  };
}

export function releaseCapability(config) {
  const missing = [
    ['RELEASE_DEPLOY_URL', config.deployUrl],
    ['RELEASE_TRAFFIC_URL', config.trafficUrl],
    ['RELEASE_TELEMETRY_URL', config.telemetryUrl],
  ].filter(([, value]) => !value).map(([name]) => name);
  return config.enabled
    ? { enabled: true, diagnostic: `ready · ${config.environment} · server-side deploy/traffic/telemetry bridge` }
    : { enabled: false, diagnostic: `未连接发布平台${missing.length ? `：缺少 ${missing.join(', ')}` : ''}` };
}
