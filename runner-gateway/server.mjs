import {executeBuild} from "./build-runner.mjs";
import {executeBrowserTest,getBrowser,closeBrowser} from "./browser-runner.mjs";
import {createProductionReleaseController} from "./release/release-controller.mjs";
export {closeBrowser as closeRunner};
// Evolve Studio browser/build evidence gateway. See README.md for deployment and verification scope.
import { createServer } from "node:http";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const PORT = Number(process.env.PORT || 8788);
const TOKEN = process.env.ACCESS_TOKEN || "";

function cors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
}
function json(res, status, body) {
  cors(res);
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > 45 * 1024 * 1024) { reject(new Error("body too large")); req.destroy(); return; }
      chunks.push(chunk);
    });
    req.on("end", () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}")); }
      catch { resolve({}); }
    });
    req.on("error", reject);
  });
}

/** 从 variant/candidate 里递归收集 { path, content } 文件条目（结构兼容多种快照形态）。 */
function collectFiles(value, out = [], depth = 0) {
  if (!value || typeof value !== "object" || depth > 6) return out;
  if (Array.isArray(value)) { for (const item of value.slice(0, 200)) collectFiles(item, out, depth + 1); return out; }
  const record = value;
  if (typeof record.path === "string" && typeof record.content === "string") { out.push(record); return out; }
  for (const child of Object.values(record)) collectFiles(child, out, depth + 1);
  return out;
}

/**
 * 示例执行器：对候选快照里的 JS 文件做 node --check 语法级构建检查。
 * TODO: 换成你的真实逻辑——例如拉取候选代码、在容器/CI 里 install+build+跑 E2E，
 *       把真实输出写进 output、执行痕迹写进 trace；完全跑不了时如实报 unverified。
 */
function executeTestCase(testCase, variant) {
  const started = Date.now();
  const files = collectFiles(variant).filter((file) => /\.(js|mjs|cjs)$/.test(file.path));
  const trace = [];
  if (!files.length) {
    trace.push({ id: "no-files", stage: "collect", summary: "候选快照中没有可检查的 JS 文件", status: "info" });
    return {
      testCaseId: String(testCase?.id ?? "unknown"),
      output: "示例网关：候选中未包含可执行检查的 JS 文件，未产生真实运行证据。",
      latencyMs: Date.now() - started,
      cost: 0,
      trace,
      verificationStatus: "unverified",
    };
  }
  const dir = mkdtempSync(path.join(tmpdir(), "runner-gw-"));
  let failed = 0;
  try {
    for (const file of files.slice(0, 50)) {
      const safeName = path.basename(file.path).replace(/[^\w.-]/g, "_");
      const target = path.join(dir, safeName);
      writeFileSync(target, file.content, "utf8");
      const result = spawnSync(process.execPath, ["--check", target], { encoding: "utf8", timeout: 15000 });
      if (result.status === 0) {
        trace.push({ id: `check-${safeName}`, stage: "build-syntax", summary: `${file.path} 语法检查通过`, status: "pass" });
      } else {
        failed += 1;
        trace.push({ id: `check-${safeName}`, stage: "build-syntax", summary: `${file.path} 语法检查失败`, status: "fail", detail: String(result.stderr || "").slice(0, 400) });
      }
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  trace.push({ id: "sample-limit", stage: "note", summary: "示例网关仅做语法级构建检查；E2E/真实运行请替换 executeTestCase", status: "info" });
  return {
    testCaseId: String(testCase?.id ?? "unknown"),
    output: failed ? `${files.length} 个 JS 文件中 ${failed} 个未通过语法级构建检查` : `${files.length} 个 JS 文件全部通过语法级构建检查（非 E2E）`,
    latencyMs: Date.now() - started,
    cost: 0,
    trace,
    verificationStatus: failed ? "failed" : "partial",
    ...(failed ? { error: `${failed} 个文件语法检查失败` } : {}),
  };
}



export function createRunnerHandler({ token = TOKEN, releaseController = createProductionReleaseController() } = {}) {
 return async (req, res) => {
  if (req.method === "OPTIONS") { cors(res); res.writeHead(204); res.end(); return; }
  const url = (req.url || "/").split("?")[0];
  if (req.method === "GET" && url === "/health") { json(res, 200, { ok: true, service: "evolve-runner", protocol: "evolve-runner/2" }); return; }
  if (req.method !== "POST") { json(res, 405, { error: "method not allowed" }); return; }
  if (token && req.headers.authorization !== `Bearer ${token}`) { json(res, 401, { error: "missing or bad bearer token" }); return; }
  let body;try{body=await readBody(req);}catch(error){json(res,400,{error:String(error)});return;}
  if (url === "/run" && body && body.ping === true) {
    let available=false;let browserError;
    try{await getBrowser();available=true;}catch(error){browserError=String(error.message ?? error);}
    const docker=process.env.BUILD_IMAGE ? spawnSync("docker",["info","--format","{{.ServerVersion}}"],{encoding:"utf8",timeout:3000,windowsHide:true}) : undefined;
    const build=!!process.env.BUILD_IMAGE && docker?.status===0;
    const release=releaseController.capability();
    json(res,200,{ok:true,pong:true,protocol:"evolve-runner/2",capabilities:{syntax:true,htmlBrowser:available,screenshots:available,build,e2e:available,release:release.enabled},diagnostics:{browser:available?"ready":browserError,build:build?"ready":process.env.BUILD_IMAGE?"Docker 服务不可用":"未配置工程构建镜像",release:release.diagnostic}});return;
  }
  if (url === "/run") {
    if(body.archiveBase64){try{json(res,200,await executeBuild(body));}catch(error){json(res,400,{error:String(error)});}return;}
    if(body.artifact && /\.html?$/i.test(body.artifact.name??"")){
      try{json(res,200,await executeBrowserTest(body));}catch(error){json(res,503,{error:String(error)});}return;
    }
    json(res, 200, executeTestCase(body.testCase, body.variant));
    return;
  }
  if (url === "/release") {
    try { json(res, 200, await releaseController.release(body)); }
    catch (error) { json(res, 502, { error: error instanceof Error ? error.message : String(error) }); }
    return;
  }
  json(res, 404, { error: `unknown route ${url}` });
 };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
 const server = createServer(createRunnerHandler());
 server.listen(PORT, process.env.HOST || "127.0.0.1", () => {
  console.log(`[runner-gateway] listening on :${PORT}${TOKEN ? " (token enabled)" : " (no token)"}`);
 });
}
