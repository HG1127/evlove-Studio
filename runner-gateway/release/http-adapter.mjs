function serviceUrl(raw, allowInsecureHttp) {
  let url;
  try { url = new URL(raw); } catch { throw new Error(`发布平台地址无效：${raw || '(empty)'}`); }
  if (!['https:', 'http:'].includes(url.protocol)) throw new Error(`发布平台只允许 HTTP(S)：${url.protocol}`);
  const local = ['localhost', '127.0.0.1', '::1'].includes(url.hostname);
  if (url.protocol !== 'https:' && !local && !allowInsecureHttp) {
    throw new Error(`生产发布平台必须使用 HTTPS：${url.origin}；仅本机地址可默认使用 HTTP。`);
  }
  return url.toString();
}

export async function postReleaseJson(rawUrl, body, { token = '', timeoutMs = 45_000, allowInsecureHttp = false, fetchImpl = globalThis.fetch } = {}) {
  if (typeof fetchImpl !== 'function') throw new Error('当前 Node 运行时没有 fetch，无法连接生产发布平台。');
  const url = serviceUrl(rawUrl, allowInsecureHttp);
  let response;
  try {
    response = await fetchImpl(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Evolve-Release-Protocol': 'evolve-release/1',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    throw new Error(`发布平台请求失败：${error instanceof Error ? error.message : String(error)}`);
  }
  let data;
  try { data = await response.json(); }
  catch { throw new Error(`发布平台返回非 JSON（HTTP ${response.status}）`); }
  if (!response.ok) throw new Error(`发布平台 HTTP ${response.status}：${String(data?.error || data?.note || 'request failed').slice(0, 500)}`);
  return data;
}
