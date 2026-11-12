# P3-D · 独立 Evolve Studio 实验数据库迁移与安全验收

日期：2026-11-12
独立开发目录：`D:\Downloads\evlove-studio-evolve-p0`
开发分支：`codex/artifact-evolution-governance-p0`，基础 HEAD：`60608f7`

## 1. 实验环境身份与范围

- **唯一写入目标：** Supabase `Evlove-Studio-Evolution-Lab`，project ref `jnlbqgpezenmpksyklme`，区域 `ap-southeast-2`
- **正式 Evolve Studio：** `mlvevgdntlswxbyxmlum`，本阶段未执行任何写操作
- **RiskOS：** `kneofioqxouoqmtxdhfv`，处于 `INACTIVE`（上阶段已按用户授权暂停），本阶段未执行写操作
- 未读取、转移、重封装正式数据库 Vault 中的模型密钥；未从正式项目复制 Mission、Job、Artifact、Evidence 数据
- 未提交、合并、部署或发布 Evolve Studio 代码

## 2. 已执行的版本化数据库迁移

新实验数据库初始 `public` 表数为0，迁移数为0，Storage Bucket 数为0。之后按仓库 `supabase/migrations` 原始顺序，将全部24个 SQL 源文件逐一通过 Supabase `apply_migration` 应用；每个文件在提交前校验其读取内容完整，且仅以新实验 project ID 为执行目标。

应用的24个迁移名称：

1. backend_foundation
2. enable_realtime
3. job_metadata
4. organization_capabilities
5. evidence_ledger
6. release_approval_grants
7. server_data_plane_security
8. outcome_metric_samples
9. capability_pgvector
10. capability_sharing_rbac
11. server_vault
12. organization_member_directory
13. security_invariants
14. mission_revision_cas_security_invariants
15. job_monotonic_security_invariants
16. workflow_run_binding_security_invariants
17. job_lifecycle_security_invariants
18. artifact_identity_security_invariants
19. artifact_evidence_retention_security_invariants
20. artifact_blob_cleanup_security_invariants
21. html_campaign_start_security_invariants
22. control_mission_cancellation_fence
23. bounded_mission_page_read
24. bounded_mission_lookup

迁移后，使用 Supabase 项目历史再次核实 `24/24` 条记录、名称和顺序相符。

**后续运维注意：** Supabase `apply_migration` 为此实验项目生成了新的迁移版本时间戳（首条 `20261112020957`，末条 `20261112021352`），并非仓库 SQL 文件原有的 `202609...` / `20261103...` 前缀。因此，此实验项目的迁移 SQL 内容已部署，但迁移历史版本 ID **尚未与本地文件名对齐**。在使用 `supabase db push`、自动部署迁移或合并新开发迁移前，应通过官方迁移修复流程对齐实验项目的版本历史，绝不可盲目重复运行既有24份 SQL，也不要手工改正式库的迁移表。

## 3. 数据结构验证

`public` 下存在11张业务表：

- missions
- jobs
- events
- artifacts
- organization_capabilities
- evidence_ledger
- release_approval_grants
- outcome_metric_samples
- evolution_vault_secrets
- evolution_workspace_members
- artifact_retention_tombstones

所有11张表均为 **RLS enabled**。验证时的表统计均为0；独立 SQL 计数确认 `missions / jobs / events / artifacts / evolution_vault_secrets / evolution_workspace_members` 均为0。

权限核验：

- 11张业务表：`anon` 无 `SELECT`、`INSERT` 直接权限；`authenticated` 无 `SELECT` 直接权限
- 抽查18个与进化、任务及成果物有关的公开 Schema 函数：均未授予 `anon` / `authenticated` 的直接执行权限
- 项目目前未配置工作区成员及实验 Vault 密钥，因而不能用于真实模型任务
### 正式库结构的只读一致性核验

- 以 `information_schema.columns` 对比两项目 `public` 业务表的字段名称、类型、可空性和默认值：**154/154个字段一致**，两侧汇总签名均为 `f3716fa849666962725a168687c8da16`。
- 以 `pg_get_functiondef` 比对22个 `public` 函数：最初9个函数存在 Windows CRLF / Unix LF 换行差异；统一去除回车符后，**22/22函数定义全部一致**，没有发现业务定义漂移。
- 此核验只比较**数据库结构与函数定义**，不表示已验证全部索引、触发器、授权配置或运行中的任务行为；更不涉及任何正式业务记录的复制。

## 4. 独立 Artifact Bucket

版本化基础迁移自动创建 `evolution-artifacts`，为此**实验 Supabase 项目内部**的私有 Bucket，与正式项目的同名 Bucket 完全隔离。

另新建实验专用私有 Bucket：

- ID / 名称：`evolve-audit-p3c-lab`
- `public=false`
- 单文件上限：52,428,800字节（50 MiB）
- 初始 `storage.objects` 对象数：0

`storage.objects` 的表级 `anon` 权限在 Supabase 托管 Storage 中可显示为 true，但其 **RLS 已启用**，该表当前 **0条策略**，且没有为 `evolve-audit-p3c-lab` 授予公开访问策略；必须同时检查 RLS 和 Policy，不能仅根据表级 GRANT 推断匿名可读。

实验后端将来必须设置 `SUPABASE_ARTIFACT_BUCKET=evolve-audit-p3c-lab`，不得以默认 Bucket、正式 Bucket 或正式 Supabase URL 执行实验。

## 5. 安全顾问与已知基线问题

实验项目 Supabase Security Advisors：

- `rls_enabled_no_policy`：INFO，11张表。属于目前服务端专用数据模式的拒绝访问式 RLS 基线；**不能为了消除提示而开放匿名或所有认证用户访问**。
- `function_search_path_mutable`：WARN，3个函数：`bump_mission_revision`、`prevent_evidence_ledger_mutation`、`prevent_evolution_event_mutation`。正式项目的安全顾问也报告同样3项 WARN；这属于原有迁移基线的待修复项，不是本次测试库独有的问题。后续应以独立审查的版本化迁移修复，测试后再讨论正式库升级。

更多安全顾问信息可参照 Supabase 官方文档：
- https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy
- https://supabase.com/docs/guides/database/database-linter?lint=0011_function_search_path_mutable

## 6. 隔离实验预检结果

使用 `scripts/p3c-isolated-lab-preflight.mjs`，将新实验项目的公开地址、项目 ID、正式项目 ID、专用 Bucket 和约束上限传入独立本地预检，不输入任何真实密钥。

核验结论：

- `labProjectMatches=true`
- `staticReady=false`
- `liveCallAllowed=false`
- 唯一静态失败项：`TEST_SERVICE_CREDENTIAL_REQUIRED`
- 仍有5类运行时门槛：数据库权限、加密 Vault、独立 Judge、供应商预算/取消控制、一次性合成 HTML Mission 授权

这一预检**不是实际模型执行或安全预算执行机制**，不可将静态预算字段宣称为真实的费用防护。

## 7. 下一阶段可执行步骤

1. 在**专用隔离运行实例**配置实验 Supabase 地址、测试专用服务端凭据、专用 Bucket 和独立的 `EVOLUTION_WORKSPACE_ID`。不要修改现有 Vercel 项目的共享 preview 环境变量，因为其 `SUPABASE_URL` 曾同时作用于 production/preview，尚未确认目标实例和环境隔离。
2. 建立实验身份、RBAC 和专用加密 Vault，**不得复制正式 Vault 主密钥或把 API Key 放入聊天、仓库、日志**。
3. 经授权将既有 MiniMax 连接接入实验运行实例，独立 Judge 单独验证；任何跨环境密钥使用须通过受控服务端操作，而不是浏览器密钥复制。
4. 真实实现并验证供应商端预算限制、单次 Token 上限、调用次数上限和取消流程。
5. 对一次性合成 HTML Mission 执行最多三代真实进化，按每代 SHA-256、来源、成本、可见与隐藏评测、独立 Judge 和 Gate F 保存证据。

## 8. 本阶段操作边界

未在实验库插入任何业务 Mission/Job/Artifact/Vault 秘钥，未执行任何真实 MiniMax 调用，未重新配置正式生成模型或 Judge，未对正式 Supabase 或 RiskOS 进行写操作。除实验数据库迁移、独立 Bucket 创建及本报告外，无其他远程资源变更。
