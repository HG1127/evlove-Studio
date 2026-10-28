# Backend Environment · V1

The Vercel API owns production data access. Keep Supabase server credentials, actor signing material, and the browser operator key in server-only environment variables. Never put them in `VITE_*` variables or commit them to Git.

## Production data plane

Configure `SUPABASE_URL` and the full `SUPABASE_SECRET_KEY` in Vercel Production. `SUPABASE_SERVICE_ROLE_KEY` remains a compatibility fallback. The server accepts a publishable key only in nonproduction or when `EVOLUTION_ALLOW_PUBLISHABLE_DATA_PLANE` is explicitly enabled; this is not the production security posture. `VITE_SUPABASE_ARTIFACT_BUCKET` selects the private Artifact bucket (default `evolution-artifacts`).

The production browser uses the same-origin `/api/evolution/*` API and does not need a Supabase secret. The browser can explicitly select local mode if the backend is unavailable; data created there stays in that browser until a later authenticated sync.

## Local development direct access

For a local `pnpm dev` session that should open the connected workspace without the operator login form, set `EVOLUTION_ALLOW_INSECURE_INTERNAL_AUTH=true` in the ignored `.env.local` file and restart the dev server. This shortcut is accepted only when `NODE_ENV` is not `production`, the request URL is `localhost` or a loopback address, and the connecting peer is loopback. Browser writes still require a same-origin request. LAN clients and production deployments retain the normal operator authentication. The server still needs a working `SUPABASE_SECRET_KEY` and the Supabase migrations to show and persist remote data.
## Single-operator browser access

The initial production UI uses a single-operator access key. Set these server-only Vercel Production variables:

```text
EVOLUTION_WORKSPACE_ID=<the configured production workspace ID>
EVOLUTION_IDENTITY_HMAC_SECRET=<at least 32 random characters; preserve the existing value if configured>
EVOLUTION_OPERATOR_ACCESS_KEY=<64 random hexadecimal characters, generated independently of the signing secret>
```

Generate the access key locally with PowerShell, then copy it directly to the Vercel Production variable. Do not paste it into a chat or repository file:

```powershell
$bytes = [byte[]]::new(32)
[Security.Cryptography.RandomNumberGenerator]::Fill($bytes)
[Convert]::ToHexString($bytes).ToLowerInvariant()
```

Redeploy after changing the variables. Open the production alias and enter the access key in the browser's “连接工作区” form. The server exchanges it for a signed, HttpOnly, Secure, SameSite=Strict cookie lasting eight hours. The key is not stored in browser storage. The operator session is scoped to `EVOLUTION_WORKSPACE_ID`; rotating either the access key or signing secret invalidates existing sessions. Logging out clears the current browser cookie. Browser writes require a same-origin request.

This is for a trusted single administrator on one workspace. The access key grants the existing `admin` role, including release approval and security administration; handle it as a production root credential. Full multiuser identity, organization membership, per-user revocation, and RLS remain separate work. Keep the current exact-deployment internal bridge limited to protected deployment diagnostics and remove it when the browser actor flow is production-evidenced.

Verify deployment without exposing secrets:

1. `GET /api/evolution/operator-session` returns `{configured:true,authenticated:false}` in a fresh browser.
2. A wrong key returns 401; the correct key returns `{configured:true,authenticated:true}` with a protected cookie.
3. `GET /api/evolution/operator-session` then reports authenticated. The UI must show “后端同步正常” before treating browser data as synced.
4. `DELETE /api/evolution/operator-session` clears the cookie, and protected API reads again return 401.

## Vercel Release Provider

Production health observation does not require a Vercel API token. Vercel deployments also expose project identity and the production URL through system environment variables; local development may read the ignored `.vercel/project.json` created by `vercel link`.

Promote / Rollback are deliberately fail-closed unless a dedicated server-side credential is configured:

```text
VERCEL_RELEASE_TOKEN=<dedicated Vercel API token>
```

`VERCEL_OIDC_TOKEN` is **not** a substitute for this release credential: OIDC is used by Sandbox / Workflow, while Vercel Project and Deployment management APIs currently reject it. Never expose `VERCEL_RELEASE_TOKEN` through a `VITE_*` variable.

The current Vercel Hobby project uses **Preview Gate → Production Promote**. Rolling Release / 5% → 20% → 50% Canary is not supported by the plan and is explicitly skipped rather than simulated.

## 自定义后端模型（无需 Vercel AI Gateway）

在项目“设置 → 模型连接”中点击“添加自定义模型”，填写连接名称、兼容接口的 Base URL、API Key 和完整模型 ID。模型名没有预设白名单；填写服务商实际支持的 ID。Base URL 可填 API 根路径（例如 `https://provider.example/v1`），也接受以 `/chat/completions` 或 `/responses` 结尾的地址。生产环境必须使用 HTTPS，地址不能包含账号、密码或查询参数。

选择“接口协议”和“JSON 输出方式”，点击“测试后端调用”。这会从后端执行一次无任务文件的真实结构化模型调用，不会保存草稿或启动 Mission。普通健康检查不会调用模型。服务商不支持 JSON 模式时可选择“仅提示词 JSON”；返回值仍必须通过任务的 Zod 契约，不能用无法解析的文本冒充执行结果。

后端解析兼容完整的前置 `<think>…</think>` 推理段和包裹最终 JSON 的代码块，仅解析最终回复并继续通过任务的 Zod 契约。只有推理内容、未闭合推理段、输出长度截断、JSON 格式错误或任务结构不符都会明确提示失败，不会自动补全内容或宣称测试通过。

测试通过后点击“保存为后端默认模型”。浏览器可添加多个连接；后台任务使用工作区中保存的一个默认连接。仅保存浏览器连接不会配置后台任务。保存成功也不等于 Mission 已验收，真实 Baseline、Candidate、实验、Hidden Validation 和 Gate F 仍需各自的执行证据。

后端通过现有 `evolution_vault_secrets` 表加密保存连接，查询只返回名称、URL、模型和协议，不返回 API Key。部署前须配置独立随机的服务端 `EVOLUTION_VAULT_MASTER_KEY`（至少 32 字符），以及上文的工作区凭据。保留既有 Vault 主密钥；不要在已有加密数据时随意替换。加密密钥必须有受保护的备份，不得放入 `VITE_*` 或 Git。该功能不需要新数据库迁移。 如果页面提示加密保存尚未启用，补齐服务端配置并重启后，可点击“重新检查保存状态”恢复保存按钮；“测试后端调用”可在保存草稿前使用。

路由优先级为：保存的后端连接 → 完整的直连环境配置 → 显式开启的历史 Gateway。若不使用 Gateway，将 `EVOLUTION_AI_GATEWAY_ENABLED=false`。直连环境配置为 `EVOLUTION_AI_API_KEY`、`EVOLUTION_AI_MODEL`、`EVOLUTION_AI_BASE_URL`，也保留已有服务商环境变量的兼容读取。模型切换会改变后续评分的路由身份；一次成对评测会固定同一配置，避免当前版本和 Candidate 使用不同模型。

直连服务可选设置服务端 `EVOLUTION_AI_REASONING_EFFORT`，适用于已保存的后端连接及直连环境配置。未设置时完全沿用服务商默认值；设置后会发送到 Chat Completions 的 `reasoning_effort` 或 Responses 的 `reasoning.effort`。可选值为 `none`、`minimal`、`low`、`medium`、`high`、`xhigh`、`max`，实际支持范围必须以所选服务商和模型为准，不会自动降级或尝试其他值。无效值在请求前拒绝；历史 Gateway 不接受这个直连选项。配置变更会改变评分及用量路由身份，已有评分不能跨配置复用，一次成对评测内仍固定同一配置。修改服务端环境后重启或重新部署生效；不要在已登记试验中切换。

MiniMax-M3.1-Flash 支持 `low` 至 `max`，默认 `max`，并且不能关闭思考；其思考 token 也计入生成长度上限。可在后续单独登记的试验中选择例如 `medium`，验证完整性、耗时和质量；设置成功本身不证明改善。见 [MiniMax 官方兼容接口参数](https://platform.minimax.cn/docs/api-reference/text-openai-api)。此选项不增加输出上限、重试次数或验收预算。

公开的 `public-readiness` 被动检查只检查环境变量，不访问 Vault，也不证明已保存模型的运行状态。`serverAi` 表示环境中的模型配置，`serverAiConnectionStorageConfigured` 只表示加密保存机制可用；不能把后一项当作模型已保存或真实调用成功。保存后通过已登录的 `ai-connection` 查询及“测试后端调用”确认实际配置和运行结果。若提示连接工作区，请先完成现有后台工作区登录。
