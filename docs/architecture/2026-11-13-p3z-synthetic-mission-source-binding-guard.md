# P3-Z · 单一合成 Mission 物理源文件绑定前置校验

日期：2026-11-13
Lab Mission：`lab-synthetic-html-task-filter-p3x-v1`
隔离分支：`codex/artifact-evolution-governance-p0`

## 问题与目标

P3-Y 已在 **通用 HTML Sandbox 调用前** 拦截了不可信源文件，但通用 Mission POST / CAS PUT 仍可能将伪造或错误的 `storageRef` 作为 Mission 状态先持久化。之后才在 Runner 拒绝，不仅推迟错误，还污染可审核的任务状态。

P3-Z 将同一真实源文件保管链校验前移到 **仅在 `EVOLUTION_EXPERIMENT_MODE=isolated` 且 Mission ID 精确等于上述单一合成 ID** 的 Mission 写边界：
- 新建 Mission 前，要求唯一目标 HTML、粘贴原文 2067 字节、Source 治理冻结 SHA 一致、`storageRef` 为空。因为注册 Artifact 有对 Mission 的 FK 依赖，不允许把伪造 storageRef 带入初始 Mission。
- **固定实验身份**：对照 P3-X 已冻结的源文件 ID `source-task-board`、2067 字节、SHA-256 `192abea39d167d9c0f4310fc603905905de5fa44106685fc7d6ea3d2931da8dc`；并以 SHA-256 `113111c80af41de9a10bec92c87d901d755c1810a4da5a5c817dc64b113e9eb6` 锁定目标、Rubric、可见/Hidden/Final 题集。禁止用自洽但未经审定的另一份 HTML 或改变题集内容继续使用同一合成 Mission ID。
- 上传 Artifact 仍必须经有权限的现有 `/api/evolution/artifacts/register` 并绑定 `missionId`，且文件和元数据必须可从专用 Store 回读。
- Mission CAS PUT 首次绑定前，检查源描述本身不被暗改，确保 Artifact 的 `id / missionId / kind=source / mimeType / sizeBytes / 原始 SHA / parentSha256` 及原文 UTF-8 均与 Mission 相符。任何校验失败，在 CAS 持久化前返回错误。
- 成功绑定后不允许通过通用 Mission PUT 偷换/移除源文件或修改冻结原文/源治理；不会阻断无关的普通任务元数据更新。
- 读取物理原文件的校验提取到一个复用的服务端模块，由 Mission PUT 与 HTML Runner 共用，避免两个端口的证据标准漂移；生产模式仍保留原行为。
- Lab 未绑定的安全草稿仍可保留，不意味着已上传源文件或已授权执行。

## 验证边界

专项测试使用真实 Nitro 业务路由及实际 HTML Runner 路由代码，底层 Mission / Blob / Evidence 使用**内存替身**，云 Sandbox 也始终由仅返回 `UNVERIFIED` 的替身模拟。验证注册前拒绝、CAS 前拒绝、严格源文件绑定后允许普通变更、非 Lab 兼容，且不调用真实模型。

这个结果不能代表真实 Supabase Lab RLS / Storage / 审计落账，不能宣称 Vercel 云浏览器运行过。仍需新的明确授权，才可对唯一 Mission 执行真实注册、入库和最多 6 次 MiniMax 物理调用的单代烟测。历史两个孤儿 Job 和全局完整性告警必须保留；不采用任何自动清理或绕过策略。

## 执行约束

不触碰生产、主分支、已有迁移、Vault Key、两个历史孤儿 Job；不设置 Mission armed、不调用真实 MiniMax、不执行云端 Sandbox、不执行 Git push 或任何部署。所有失败必须保持源 Mission 原 revision 和原始 bytes 不变。

## 2026-11-13 最终验证与 Lab 只读状态

- 本地专项 P3-X + P3-Y + P3-Z **41/41 PASS**；完整 P3 回归 **56 files、737/737 PASS**；相关 Mission/HTML Runner 测试 **29/29 PASS**。
- `pnpm exec tsc -b --pretty false`、`pnpm architecture:check`、全项目 `pnpm lint`、`pnpm exec vite build` 和 `git diff --check` 全部退出码 0。Vite/Nitro 仍报告依赖 `@vercel/sandbox` 缺失 source map 的非阻断告警。
- 原始 HTML SHA-256 不变：`192abea39d167d9c0f4310fc603905905de5fa44106685fc7d6ea3d2931da8dc`。
- 独立实验分支仍是 `codex/artifact-evolution-governance-p0`、HEAD `74e0c5ed64735fb01c5a0c47f8d9c4b144256c97`；P3-Y/Z 一共 **4 modified + 4 untracked**，没有提交、推送、合并或部署。
- 通过 Supabase 连接器只读查验指定 **Evlove-Studio-Evolution-Lab**（`jnlbqgpezenmpksyklme`）：状态 `ACTIVE_HEALTHY`，迁移记录 **28 项**；`missions=0`、`jobs=3`、活动 `queued/running/waiting` Job **2**、缺失父 Mission 的活动孤儿 Job **2**。指定的 `lab-synthetic-html-task-filter-p3x-v1` 真实 Mission **0**、归属 Artifact **0**、AI 预算行 **0**、订阅预算行 **0**。
- 上述在线查询只有聚合 SELECT，没有写入数据库，不读取/修改 API Key 或 Vault、也没有真实 MiniMax/Sandbox 调用。因两条孤儿活动 Job，**全局完整性告警仍不能标为清除**，不得把 scoped 诊断当成启动许可。
- 真实 P3-Z 的服务端改动尚未部署 Lab Preview；真实 Mission 注册、物理文件上传、模型生成/独立 Judge、Hidden/Final 与 Gate F **均未实测**。需要新的、与先前 P3-S 禁令不冲突的明确用户授权，才可进入下一步有边界的 Lab 实验。

