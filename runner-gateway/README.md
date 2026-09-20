# Evolve Studio 真实验证网关

Node.js 20+。本地 `npm run dev` / `npm run preview` 自动准备依赖，并将执行器挂载在应用同域的 `/__runner`，无需另外启动 8788 服务。静态文件托管不包含 Node 服务，正式部署需使用 Node/Vite 服务或部署独立网关。

## 默认自动模式

打开设置的“解析与 Target”自动检测后台能力。Windows 自动尝试已安装的 Edge、Chrome，再尝试 Playwright Chromium。Linux/macOS 自动尝试 Chromium 与 Chrome/Edge。缺少浏览器时执行 `npm run runner:install-browser` 一次；Linux 还需安装浏览器系统依赖。检测与实际测试共用真实浏览器，不返回模拟通过。浏览器空闲 60 秒自动释放。

默认 Run URL 为当前应用的 `/__runner/run`，Release URL 留空。旧版固定 localhost URL 自动迁移到当前地址。自定义 CI/发布执行器位于设置页高级选项。

## 独立部署（可选）

在 runner-gateway 目录执行 npm ci。Windows 已安装 Edge 时：

```powershell
$env:BROWSER_CHANNEL="msedge"
node server.mjs
```

其他环境先运行 npx playwright install chromium，再运行 node server.mjs。Linux 需要浏览器系统依赖。默认监听 127.0.0.1:8788，可设置 PORT。Studio Run URL 填 http://127.0.0.1:8788/run 或已有同域代理。连通测试必须返回 evolve-runner/2 协议响应；HTTP 错误不能算成功。

远程部署由运维配置 HOST、ACCESS_TOKEN 和 HTTPS 反向代理；Studio Bearer Token 与 ACCESS_TOKEN 一致。密钥不要写入源码包。此服务不是多租户公网执行平台。

## 能力与证据范围

- 完整 HTML：独立浏览器上下文，实际点击、填写、可见性/文本/数量断言，桌面及手机截图、运行错误和横向溢出检查。返回文件 SHA-256。
- browserSteps 最多 24 步，action 为 click、fill、visible、text、count，selector 指定元素，value 指定输入或预期值。Studio 提供中文表单。
- 没有交互断言、或外部资源被阻断时返回 partial；verified 只代表声明的断言通过。
- 浏览器阻断外部网络、服务工作线程、弹窗、下载。依赖远程 API、登录、外部脚本的应用需专用受控执行器。
- 视觉模型由 Studio 单独调用。截图绑定文件版本，不代表交互或所有页面都通过。

## 工程 ZIP 构建

需要 Docker 与预先准备的 BUILD_IMAGE。镜像包含 Node、npm、sh，以及工程匹配的 /opt/deps/node_modules。BUILD_COMMAND 只接受运维环境配置，默认 npm run build && npm test；请求不能指定镜像或命令。

```powershell
$env:BUILD_IMAGE="your-prepared-build-image"
$env:BUILD_COMMAND="npm run build && npm test"
node server.mjs
```

源码在容器临时目录运行，链接镜像依赖，运行时不联网安装。限制：ZIP 30MB，解压 50MB，1500 文件，120 秒，容器断网、只读根目录、1GB 内存、2 CPU。拒绝危险路径、符号链接和 node_modules。ZIP 根目录应含 package.json。

构建通过返回 partial，因为编译和工程测试不等于全部业务目标通过。缺少镜像或 Docker 时为 unverified。本次环境没有 Docker，容器集成尚未实测；路径拒绝和未配置状态已测试。

## Production Release Runner

`/__runner/release` 现在是服务端 Production Release Controller。它不会自己伪造容器、流量或 KPI，而是只在服务器配置了真实的部署、切流和 Telemetry 三个 HTTP 端点时声明 `capabilities.release=true`。未配置时继续 fail-closed，返回 simulation/拒绝发布。

服务器环境变量：

```bash
RELEASE_DEPLOY_URL=https://release-control.example.com/deploy
RELEASE_TRAFFIC_URL=https://release-control.example.com/traffic
RELEASE_TELEMETRY_URL=https://observability.example.com/evolve
RELEASE_PLATFORM_TOKEN=server-side-secret
RELEASE_ENVIRONMENT=production
RELEASE_STATE_FILE=/var/lib/evolve/release-state.json
```

生产平台 Token 只由 Node Runner 使用，不进入 Studio 浏览器/localStorage。远程 HTTP 默认只允许 HTTPS；本机 localhost 可使用 HTTP，其他非 HTTPS 环境必须由运维显式设置 `RELEASE_ALLOW_INSECURE_HTTP=1`。

### 三个外部端点协议

1. **Deploy**：接收 `operation=deploy-candidate`、Candidate 完整 Artifact Snapshot 与 `expectedArtifactHashes`。必须返回 `{ ok:true, deploymentId, artifactHashes, stableDeploymentId?, stableArtifactHashes? }`，其中 Candidate hashes 必须逐项与 Evolve 已验收快照一致，否则发布立即中止。
2. **Traffic**：接收 `operation=set-traffic`、`stableDeploymentId`、`candidateDeploymentId` 与 Candidate/Stable 百分比。Shadow 固定 Candidate 用户流量 0%，默认 `mirrorPercent=100`，并传 `sideEffectPolicy=block-writes`；真实平台必须据此阻止邮件、交易、数据库写入等 Shadow 副作用。Canary 为 5% → 20% → 50%，Promote 为 100%，Rollback 为 Stable 100% / Candidate 0%。返回的 `trafficPercent` 必须与请求一致。
3. **Telemetry**：接收 `operation=observe-release` 和当前 deployment/traffic 状态，返回 `{ ok:true, healthy, sampleSize, windowMinutes, observedAt, kpis }`。KPI 中带 target 的指标会由 Runner 再校验一次；样本或窗口不足时状态为 `observing`，Studio 只能刷新当前阶段，不能推进。

默认最低观察门槛只是保护“空样本推进”，不是生产最佳实践，可按阶段覆盖：`RELEASE_SHADOW_MIN_SAMPLE_SIZE`、`RELEASE_SHADOW_MIN_WINDOW_MINUTES`、`RELEASE_CANARY_5_*`、`RELEASE_CANARY_20_*`、`RELEASE_CANARY_50_*`、`RELEASE_PROMOTE_*`。Shadow 镜像比例用 `RELEASE_SHADOW_MIRROR_PERCENT`，写操作策略用 `RELEASE_SHADOW_SIDE_EFFECT_POLICY`。

真实状态写入 `RELEASE_STATE_FILE`：只存 deployment id、Artifact hash、流量、KPI 和历史，不存 Token 或 Artifact 正文。相同阶段再次调用是“刷新 Telemetry”，不会重新部署/重复切流。Canary KPI 达到已验证的不健康状态时 Runner 会立即把 Stable 恢复到 100%，并通过 `effectiveAction=rollback` 把实际动作同步回 Evolve UI。

### 发布与测试

- `npm run runner:test`：真实浏览器点击、正反断言、双视口证据、构建边界，以及 Production Release Controller 的 fail-closed、Shadow、Telemetry recheck、Canary 自动回滚、Promote 测试。
- `node scripts/runner-smoke.mjs`：测试当前 8000 同域服务；未配置上述生产端点时仍确认 `/release` 拒绝模拟发布。
- `node --test runner-gateway/release/release-controller.test.mjs`：单独验证发布状态机，不连接真实外部平台。
