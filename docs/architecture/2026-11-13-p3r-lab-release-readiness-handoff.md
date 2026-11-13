# P3-R · 独立 Lab 上线前安全收口与验收报告

日期：2026-11-13
项目：Evlove Studio Evolution Lab
独立工作树：D:\Downloads\evlove-studio-evolve-p0
分支：codex/artifact-evolution-governance-p0
当前基线 Git HEAD：2ce15c250c5bccec9f45eb732f4395823159ac1b（P3-H 至 P3-R 均为未提交工作树改动）
Supabase Lab：jnlbqgpezenmpksyklme
Vercel Lab Preview：prj_BuJhKyI5fhoIVJRO3jEo6BzSIOhs，Team team_kK5GqMJNWpI0A7NmY6nnXgIQ

## 一、目标与不可越过的授权边界

用户的“请继续”在本阶段仅用于继续本地实现、只读核查和测试。尚无对真实数据库应用第 28 项迁移、改写迁移历史、Git commit/push/merge、Vercel Preview 发布或真实模型调用的单独明确授权。因此本阶段未实施任何这类外部变更。已有 MiniMax M Plan Subscription Key 原样复用，没有读取、打印、索取或重写 Key。

## 二、Lab 最新状态（只读）

- Supabase Lab 的 schema_migrations 已应用 27 项；P3-P 的 Mission/Job 父级防护与删除审计迁移第 28 项尚未安装。
- public.missions 为 0 行；2 个旧 waiting Job 引用已不存在的 project-1794471973744。旧 Job 所有者/原 Mission 删除原因仍然未知，不主动取消、恢复或修改。
- M Plan 订阅 Token 预算账本与物理模型调用账本都是 0 行，现有两个加密 Vault 连接角色仍保留。
- 独立 Vercel Lab 的最新 READY Preview 为 dpl_GpNL7E21oXx15bDcG1KgSx4o2cbx，对应 Git SHA 2ce15c2，不含 P3-H 至 P3-R 改动。SSO 保护所有部署；实验分支 Git 自动部署仍被显式禁止。

## 三、P3-R 实际代码改进

### 1. 对账写入必须有管理员批准和有效完整性证据

- 新增 lab-reconciliation-preflight.ts：仅当 isolated Lab 的完整 Job/Mission 盘点明确返回 clear 才允许执行会修改状态的对账；blocked、unknown 或查询错误均停止。
- jobs/reconcile.post.ts：只读 repair=false 保持原权限；isolated Lab 的 repair=true 必须额外通过 security.admin，且在修复前完成完整性审查。
- jobs/reconcile-scheduled.get.ts：定时自动修复和 Artifact 清理之前先检查 Lab 完整性；旧孤儿 Job 导致整体拒绝，避免已写入再报错。
- 该检查是应用层前置门禁，不代替每个 Job 的数据库行锁/CAS。非 Lab 原有行为不增加 Lab 专用校验。

### 2. 签名 Evidence Ledger 补录不能只依赖执行权限

- 修改 events-evidence-reconcile.post.ts：isolated Lab 中 repair=true 的签名证据写入另需 security.admin；repair=false 的只读检查仍可由 mission.execute 使用。
- 允许经审批的 MissionDeleted 事件在原 Mission 已经不存在时根据 append-only Event 补录，不应使用通用孤儿 Job 门禁阻止这一特定审计取证路径。
- 新增权限测试：普通执行者不能修复签名证据，管理员可以，原有非 Lab 行为保留。尚未在真实 Preview 使用真实签名 Key 完成在线补录。

### 3. 审计删除操作者上下文不跨调用泄漏

- 审查 P3-P 四参数 delete_mission_if_revision 函数时发现，事务内 set_config 写入的 actor_id/actor_role 如果未恢复，随后同事务运行的旧两参数删除操作可能错误继承身份。
- 在待发布迁移中保存先前 actor 设置，在有效删除后恢复；更新 supabase/tests/lab_mission_parent_delete_guard_integration.sql，增加连续两次删除的跨调用身份隔离测试。
- 仅对隔离 Lab 使用 BEGIN + 新 DDL + 合成断言 + ROLLBACK 的一次事务检验：新接口记录当前合成操作者，旧两参数接口记录明确的 unattributed-service-role；同时验证活动 Job 不能脱离父级、不能在有活动 Job 时删除 Mission，和旧接口兼容。
- 测试回滚结束，未提交 schema、迁移历史或合成 Job/Event。真实双连接并发插入/删除竞态仍需要迁移获批安装后再做独立验证。

## 四、质量验证结果

- P3 专项 Vitest：46 个文件，558/558 通过（0 失败）。
- P3-N 迁移 SHA-256 和时间版本识别工具：7/7 测试通过，27 项旧 SQL 内容相符、1 项新迁移仍待发布。
- P3-Q 发布候选指纹工具：5/5 测试通过。最终 P3-R 全部源码与本报告生成后重新计算审查指纹并通过 verify；该收据仍只是工作树审查指纹，不是 Git commit SHA 或线上部署 SHA。
- TypeScript 全工程 tsc -b：PASS；ESLint 全量检查 0 警告：PASS；packages 架构检查：PASS；Vite/Nitro build：PASS，完整进程退出码 0。
- 构建仍出现第三方 @vercel/sandbox 缺失 Source Map 和 Browserslist 数据过旧的非阻断提示；本地构建进程成功不代表 Vercel Preview 已发布。

## 五、剩余阻断与下一阶段

1. 明确批准只在 Supabase Lab jnlbqgpezenmpksyklme 应用 P3-P 新增的唯一第 28 项迁移；发布前刷新远端 SHA-256/版本记录，不能重放或修复旧的 27 项。
2. 另外明确批准只在 Vercel Lab Preview project prj_BuJhKyI5fhoIVJRO3jEo6BzSIOhs / team team_kK5GqMJNWpI0A7NmY6nnXgIQ 发布经 review 的最终 Git commit SHA；禁止生产、主分支或正式域名变更。
3. 新 Preview 上先管理员只读检查 lab-job-integrity（预期 blocked/2 orphan）；另用现有 Vault Key 只读查询 minimax-subscription-quota 的真实供应商百分比与模型元数据，确保不会暴露凭证。
4. 待新数据库和 Preview 的跨实例运行、预算、日志、删除审计与签名镜像真正通过在线验收，再申请有界的 MiniMax 三代合成 HTML Mission 生成与独立 Judge/Holdout/Gate F 验证。

结论：P3-R 本地安全性与回滚 SQL 证据已完成；真实 Lab 迁移及新版 Vercel Preview 均尚未发布，真实模型实验仍未运行。
