# P3-N · Lab Supabase 迁移版本对账及安全发布前置说明

校验日期：2026-11-13
项目：独立 Evolution Lab (jnlbqgpezenmpksyklme)
开发分支：codex/artifact-evolution-governance-p0

## 检查结论

本地 SQL 文件数量：27；Lab 远端登记迁移数量：27；同名迁移匹配：27；时间版本号严格一致：0；版本不一致：27。

所有 27 项同名迁移都存在，但数据库远端版本全部不同。Supabase CLI 依据迁移时间版本号识别已经执行的 SQL，而不是仅按文件名。
如果直接对该远端运行 supabase db push，可能导致 Remote migration versions not found / 重复待应用迁移，故在版本对齐前必须阻止自动迁移发布。

## 本地文件与远端登记逐项对照

| 名称 | 本地版本 | Lab 远端版本 | 是否一致 |
|---|---|---|---|
| backend_foundation | 20260918170000 | 20261112020957 | 否 |
| enable_realtime | 20260918174500 | 20261112021001 | 否 |
| job_metadata | 20260920183000 | 20261112021006 | 否 |
| organization_capabilities | 20260921100000 | 20261112021010 | 否 |
| evidence_ledger | 20260921103000 | 20261112021014 | 否 |
| release_approval_grants | 20260921110000 | 20261112021019 | 否 |
| server_data_plane_security | 20260921111000 | 20261112021023 | 否 |
| outcome_metric_samples | 20260921113000 | 20261112021027 | 否 |
| capability_pgvector | 20260921114000 | 20261112021033 | 否 |
| capability_sharing_rbac | 20260921131500 | 20261112021126 | 否 |
| server_vault | 20260921134500 | 20261112021131 | 否 |
| organization_member_directory | 20260921143000 | 20261112021135 | 否 |
| security_invariants | 20260922183000 | 20261112021205 | 否 |
| mission_revision_cas_security_invariants | 20260923083000 | 20261112021210 | 否 |
| job_monotonic_security_invariants | 20260923093000 | 20261112021216 | 否 |
| workflow_run_binding_security_invariants | 20260923103000 | 20261112021221 | 否 |
| job_lifecycle_security_invariants | 20260924100000 | 20261112021244 | 否 |
| artifact_identity_security_invariants | 20260924113000 | 20261112021248 | 否 |
| artifact_evidence_retention_security_invariants | 20260924120000 | 20261112021254 | 否 |
| artifact_blob_cleanup_security_invariants | 20260924153000 | 20261112021315 | 否 |
| html_campaign_start_security_invariants | 20261021130000 | 20261112021320 | 否 |
| control_mission_cancellation_fence | 20261027040000 | 20261112021325 | 否 |
| bounded_mission_page_read | 20261103092302 | 20261112021346 | 否 |
| bounded_mission_lookup | 20261103101206 | 20261112021352 | 否 |
| lab_ai_budget_security_invariants | 20261112190000 | 20261112070619 | 否 |
| lab_ai_unsettled_reservation_fence_security_invariants | 20261112193500 | 20261112072412 | 否 |
| lab_minimax_subscription_quota_security_invariants | 20261112210000 | 20261112093700 | 否 |

## 安全处理原则

1. 不运行 supabase db push，不对生产项目执行 migration repair，不擅自重命名共享代码库中的 27 个既有 SQL 文件。保留当前生产所需迁移的原始时间标识。
2. 新版 P3-M 所需的 Lab 数据库函数和表已经应用并经回滚测试验证，尚未产生新的真实 Mission 订阅账单；不要因版本不一致而重复执行 schema migration。
3. 后续在明确授权的独立 Lab 范围内，先把这份对照表与远端 schema_migrations、RLS、RPC/表定义、SQL 内容复核，制作单独的 Lab migration history 映射或执行经审核的历史对齐操作。
4. 在执行任何迁移版本写操作前，做数据库备份和完整差异审查，确保不覆盖或清理现有 paused/waiting Mission 和已保存 Vault 模型。
5. 使用 Supabase CLI 的 supabase migration list --remote 和 supabase db push --dry-run 检验最终效果；只有两者与预期一致、数据库无待重复应用迁移，才可继续隔离 Preview 发布。
6. 生产数据库与原主项目数据库的迁移历史可能不同，禁止把 Lab 的历史映射自动推广到生产。

官方参考：https://supabase.com/docs/guides/deployment/database-migrations

## P3-N 执行补充：27 项 SQL 内容 SHA-256 完整验证（2026-11-13）

在前述版本号不一致的基础上，进一步**只读**检查了远端 `supabase_migrations.schema_migrations.statements[1]`，并使用 PostgreSQL `pgcrypto` SHA-256 与本地 SQL 原始字节逐项比较。

- 全部 27 个同名迁移按执行顺序一致，且远端每项只存储一条完整 SQL statement。
- 26 个本地文件仅多出最后一字节 LF（`0A`），另一个文件没有额外末尾 LF。规范化时只删除**最多一个**末尾 LF，绝不调整 SQL 内容、标识符或内部换行。
- 规范化之后，**27/27 项字节长度和 SHA-256 指纹与远端完全一致**，没有检测到 SQL 本体差异。与此前 27/27 版本号不一致同时成立。
- 验证只说明远端登记的 SQL 与本地文件内容相符，不证明任意 SQL 在生产环境已执行，更不是数据库当前业务数据/模型运行结果的证明。

新增供程序校验的只读快照：
`docs/architecture/2026-11-13-p3n-lab-migration-snapshot.json`（固定 Lab project ref + 27 个远端版本号、名称、SQL 大小、SHA-256，不含数据库凭据及 SQL 原文）。

新增脚本及测试：
- `scripts/p3n-lab-migration-preflight.mjs`；
- `scripts/p3n-lab-migration-preflight.test.mjs`。

只读检查：`pnpm lab:migrations:check`。离线实验性生成版本重映射副本：`pnpm lab:migrations:stage`，仅写入 Windows 临时目录；不会修改原始迁移、数据库迁移历史或 Supabase 连接信息，且副本没有项目链接与密钥，不允许执行 `db push`。测试：`pnpm lab:migrations:test`。

已在当前 Lab 执行对应源验证（27/27 匹配），预检脚本返回 `VERIFIED_OFFLINE_ONLY`，六项 Node 内置测试全部通过；另已成功创建一份 27 项文件的**离线临时副本**。

**重要：**校验器以快照为基准，超过 48 小时拒绝继续，避免以过期远端数据批准未来发布。在之后任何真实部署或 Supabase CLI `--dry-run` 前，必须重新从指定 Lab 只读刷新快照并核验。

## 独立 Vercel Preview 发布策略补充

- 独立 Vercel Lab 项目 `evlove-studio-evolution-lab` 当前 READY 的 Preview 仍为 SHA `2ce15c2`，不包含 P3-H 到 P3-M 的本地未提交代码。
- 仓库 `vercel.json` 显式将 `codex/artifact-evolution-governance-p0` 分支的 `git.deploymentEnabled` 设为 `false`，因此不能假设推送该分支会自动创建新 Preview。也不应为推进实验而在未经授权的情况下关闭这一保护。
- Vercel Lab 环境清单中存在旧版 `EVOLUTION_EXPERIMENT_MODE` 与操作员凭证，但缺少 `EVOLUTION_LAB_EXPERIMENT_ARMED`、`EVOLUTION_LAB_APPROVED_MISSION_ID`，所以真实合成 Mission 保持默认禁止。
- 旧的 `EVOLUTION_LAB_AI_PRICING_POLICY_JSON` 为历史 USD 按量策略，**M Plan Token 账本不要求该变量**。绝不能为绕过阻断而捏造此变量。
- 新的 MiniMax 订阅额度 GET 为 `security.admin` 只读接口，仍需在**明确授权的独立 Lab Preview 发布之后**才有资格通过现有 Vault Key 做真正的供应商配额读取。当前没有进行这项调用。

## 与 Preview 发布的关系

Vercel Lab Preview 当前代码 SHA=2ce15c2，尚未包含 P3-H/I/J/K/L/M 的本地未提交改动。当前可以完成本地构建和数据库已落地能力验证，但不能声称已经在线验收新版 API 或真实三代进化。
后续必须获得具体授权后只发布到独立 Lab Preview，再做受管理员认证的 quota 只读 API 试验；任何失败保持 fail-closed。

状态：仅检查并保存对照文件，未修改远端 migration registry，未部署、提交、推送或清理任何数据库业务对象。
## P3-N 最终本地验收记录

- Node 内置测试：6/6 通过；包含 SQL 指纹不符、未知文件、生产项目引用、远端历史重名/重复、超过 48 小时快照失效、临时副本与原始文件一致性。
- pnpm lab:migrations:check：通过，27/27 SHA-256 一致、27/27 时间版本号不同、无数据库或部署操作。
- pnpm lab:migrations:stage：成功生成 27 个仅用于离线诊断的映射 SQL 文件，均存于单独临时目录，没有写入代码库或数据库。
- 原有 Vitest P3 回归：34 文件，442/442 通过；TypeScript 全工程、pnpm lint、pnpm architecture:check、pnpm build 全部通过。
- pnpm build 的第三方 @vercel/sandbox Source Map 警告与 Browserslist 旧提示仍是非阻断信息。
- P3-N 没有执行正式 SQL 迁移、迁移历史写入、MiniMax Vault 密钥变更、旧 Job 状态变更、Vercel Preview 发布或任何生产环境操作。

**新增并行环境异常（最后只读核查）：**Lab missions 表当前无记录，但仍有两个 waiting Job 引用之前的 project-1794471973744。该 Mission 在早期回读曾为 paused，本次仅能确认目前缺失，无法确定变动来源。P3-N 未执行 Mission/Job 更新或删除。此事独立于迁移版本对账，后续不得自动修复，需先确认归属和处置权限。

**验收结论：P3-N 安全离线迁移映射与 Preview 发布准备已完成；实际 Supabase CLI 远端 dry-run、Lab Preview 发布及真实 MiniMax 额度查询未执行，继续受明确授权控制。**
