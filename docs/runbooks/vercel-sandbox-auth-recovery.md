# Vercel Sandbox 授权恢复操作手册（Evolve Studio）

本手册面向有权访问 `500ipo-evolve-studio` 项目的 Vercel 团队成员。**无需把任何 Token、.env.local 或账号信息发到聊天中。**

## 已证实的阻断

- 当前项目已关联到 `500ipo-evolve-studio`，且关联项目 ID 与此前检查到的项目 ID 一致。
- 本地 `.env.local` 的 `VERCEL_OIDC_TOKEN` 载荷 `exp` 为 **2026-09-20T12:46:17.000Z**，已过期。这个载荷检查不能验证签名，只能识别明确过期/范围错误。
- 当前 ChatGPT 所连接 Vercel 账号无法枚举到目标团队，项目配置与 Sandbox 查询返回 **HTTP 403**。此处需要有权限的项目成员/管理员修复访问授权。
- Vercel CLI 当前未安装在该机器的 PATH。本地 Docker Desktop Engine 也未运行；它不属于本项目规定的 V1 Sandbox 替代方案，不能默默改变隔离架构。

## 有权限的团队成员在 TRAE 项目终端执行

1. **团队管理员先确认授权。** 确保操作人员在 Vercel 目标 Team 里具有使用 `500ipo-evolve-studio` 和 Sandbox 的必要权限。若聊天中的 Vercel 连接使用了其他账号，需要切换到被授权的账号或重新连接。
2. **使用正常交互式登录**（终端可能打开浏览器，请由用户本人完成）：

   ```powershell
   pnpm dlx vercel login
   pnpm dlx vercel whoami
   ```

3. **确认现有链接**，不要创建同名的新项目。仅在关联错误时，以目标团队的 slug 重新关联：

   ```powershell
   pnpm dlx vercel link --scope <TEAM_SLUG>
   ```

   关联项目应当显示为 `500ipo-evolve-studio`。若 CLI 提示无团队访问权，应由 Team 管理员邀请/提升权限，不要通过更换无关项目绕过。

4. **只下载到独立的忽略文件**，不要直接覆盖带有数据库或模型配置的现有 `.env.local`：

   ```powershell
   pnpm dlx vercel env pull .env.vercel.local
   node scripts/merge-vercel-oidc.mjs
   ```

   第二条为默认 Dry Run，验证新 OIDC 的到期时间、项目及团队范围，不修改文件，也不打印令牌。若校验成功：

   ```powershell
   node scripts/merge-vercel-oidc.mjs --apply
   ```

   该脚本只更换 `VERCEL_OIDC_TOKEN` 配置行，保留其它本地配置，并原子写回。`.env.vercel.local` 仍是含机密数据的临时文件，请在确认无需使用后安全清理；仓库的 `.gitignore` 已覆盖 `.env*`。

5. **重启 Nitro/Vite 本地服务以读取新环境变量**：

   ```powershell
   pnpm dev
   ```

6. 进入 **进化闭环完整性中心 → Target Adapter**，先点 **检查授权配置**（不产生 Sandbox 费用），确认不再提示过期；再由具备执行权限的操作者点 **验证云端 Browser**。只有实际的 `Sandbox ready:true` 与 Browser 的 Preview/Chromium Steps 实测全通过，才可运行新的 HTML Mission。

## 备选方案：团队级 Vercel Access Token（避免本地 OIDC 的周期性过期）

Vercel Sandbox 官方 SDK 也支持 Access Token 方式。该方案适合长期运行的本地服务或非 Vercel 主机，但仍需要**具有目标团队项目权限**的管理员授权。它不能绕过 403，也不能使用与本项目无关的 token。

1. 由目标 Vercel Team 管理员创建限定目标团队访问范围、有效期与权限的 Access Token，并通过组织的秘密管理方式配置在此项目服务器的 `.env.local` 中。切勿放在浏览器 localStorage、前端代码或聊天里。
2. 在服务器本地配置以下四个变量（示例占位符必须由有权限的人替换）：

   ```dotenv
   EVOLUTION_SANDBOX_AUTH_MODE=access-token
   VERCEL_TOKEN=<AUTHORIZED_TEAM_SCOPED_SECRET>
   VERCEL_TEAM_ID=team_<AUTHORIZED_TEAM_ID>
   VERCEL_PROJECT_ID=prj_<LINKED_PROJECT_ID>
   ```

3. 重启 Nitro/Vite。进化闭环完整性中心应显示“Access Token 配置完整，等待云端验证”，**不能**直接显示 `READY`。操作者再执行真正的 Sandbox/Chromium Health。Vercel 远端服务拒绝访问时仍应返回未就绪，禁止建立 HTML Workflow。
4. 本项目通过显式 `token + teamId + projectId` 参数调用 Sandbox SDK；该方式优先于仍然存在但过期的本地 OIDC。仅当 `EVOLUTION_SANDBOX_AUTH_MODE=access-token` 明确设置并且三个配置完整一致时才会选择此模式。它不会向 Sandbox 文件系统注入访问令牌。

Access Token 可能由组织策略设定过期日期，需按团队的凭证轮换政策维护；不能理解为永久有效。**两种授权方式二选一**：默认 OIDC 开发模式，或显式 Access Token 模式。无论何种方式，最终都必须通过真实 Vercel Cloud Sandbox + Chromium 步骤验证。

## 验收与失败判断

- **OIDC 仍过期**：检查是否用正确团队重新拉取凭证、是否重启本地进程。不要反复启动新 Sandbox。
- **OIDC 配置正常但 403**：账号/Team/Project 权限不足，应由 Vercel 团队管理员处理。有效期通过 **不** 代表云端授权通过。
- **Sandbox 已可创建但 Browser Steps 失败**：检查已授权快照和 Chromium 执行器；不要用本地截图或 `codeReady` 冒充服务端结果。
- **全部健康检查通过**：用新隔离 HTML Mission 验证原版失败的真实浏览器步骤、冻结 Candidate 运行、新旧 Hidden Holdout、Gate F、交付文件同字节下载重开。暂不操作真实业务任务或生产发布。

以上步骤需要拥有目标 Vercel 团队权限的用户本人完成，AI 无法自行延长过期的签名令牌或授予不具备的团队权限。
