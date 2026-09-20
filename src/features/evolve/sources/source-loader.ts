import { extractSource as parseLocally, extractPdfText } from "./extract";
import { getParserGatewayConfig } from "./parser-gateway";
import { parseCacheKey, readParseCache, writeParseCache } from "./parse-cache";

type Args = Parameters<typeof parseLocally>[0];
type Parsed = Awaited<ReturnType<typeof parseLocally>>;
const inFlight = new Map<string, Promise<Parsed>>();
const MAX_PARSE_CONCURRENCY = 3;
let activeParses = 0;
const parseWaiters: Array<() => void> = [];

async function withParseSlot<T>(work: () => Promise<T>): Promise<T> {
  if (activeParses >= MAX_PARSE_CONCURRENCY) await new Promise<void>((resolve) => parseWaiters.push(resolve));
  activeParses += 1;
  try { return await work(); }
  finally {
    activeParses -= 1;
    parseWaiters.shift()?.();
  }
}

async function parseInBackground(args: Args): Promise<{ parsed: Parsed; cacheable: boolean }> {
  if (typeof Worker === "undefined") return { parsed: await parseLocally(args), cacheable: false };
  return new Promise((resolve, reject) => {
    let worker: Worker;
    try { worker = new Worker(new URL("./parse.worker.ts", import.meta.url), { type: "module" }); }
    catch { void parseLocally(args).then(parsed => resolve({ parsed, cacheable: false }), reject); return; }
    const finish = () => { clearTimeout(timer); worker.terminate(); };
    const timer = setTimeout(() => { finish(); reject(new Error("后台解析超过 5 分钟，已停止。请拆分压缩包或使用外部解析服务后重试；原文件未被修改。")); }, 300_000);
    worker.onmessage = (event: MessageEvent<{ kind: string; id: number; buffer: Uint8Array; ok: boolean; parsed: Parsed; cacheable: boolean; message?: string }>) => {
      if (event.data.kind === "pdf") {
        const id = event.data.id;
        void extractPdfText(event.data.buffer).then(text => worker.postMessage({kind:"pdf-result",id,text}), error => worker.postMessage({kind:"pdf-result",id,error:String(error)}));
        return;
      }
      if (event.data.kind !== "done") return;
      finish();
      if (event.data.ok) resolve(event.data);
      else reject(new Error(event.data.message ?? "后台解析失败"));
    };
    worker.onerror = () => { finish(); reject(new Error("后台解析器加载或运行失败，请刷新后重试。")); };
    // Transfer a copy: callers still need the original bytes for source preservation.
    const bytes = new Uint8Array(args.buffer);
    try { worker.postMessage({ ...args, kind: "parse", buffer: bytes, baseUrl: document.baseURI }, [bytes.buffer]); }
    catch (error) { finish(); reject(error); }
  });
}

/** All intake/restore paths share a bounded background parse pool and content-addressed parse index. */
export async function extractSource(args: Args): Promise<Parsed> {
  // External parsing depends on mutable service settings and may require fresh server evidence.
  // It therefore skips the persistent cache. The resolved config is passed into the Worker so
  // Docling / Unstructured / Tika enrichment no longer forces parsing back onto the UI thread.
  const gateway = getParserGatewayConfig();
  const externalEnabled = gateway.enabled && gateway.kind !== "off";
  const parseArgs: Args = externalEnabled ? { ...args, parserConfig: gateway } : args;
  const key = externalEnabled ? undefined : await parseCacheKey(args.name, args.mimeType, args.buffer).catch(() => undefined);
  if (key) {
    const existing = inFlight.get(key);
    if (existing) return structuredClone(await existing);
  }
  const job = (async () => {
    const cached = key ? await readParseCache(key) : undefined;
    if (cached) return cached;
    const result = await withParseSlot(() => parseInBackground(parseArgs));
    if (key && result.cacheable) await writeParseCache(key, result.parsed);
    return result.parsed;
  })();
  if (key) inFlight.set(key, job);
  try { return structuredClone(await job); }
  finally { if (key) inFlight.delete(key); }
}
