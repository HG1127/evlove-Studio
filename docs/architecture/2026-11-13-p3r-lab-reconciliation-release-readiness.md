# P3-R · Lab 自动对账前置保护与真实发布阻断验收

日期：2026-11-13
独立工作树：D:\Downloads\evlove-studio-evolve-p0
分支：codex/artifact-evolution-governance-p0
源码基线 HEAD：2ce15c250c5bccec9f45eb732f4395823159ac1b
Supabase Lab：jnlbqgpezenmpksyklme
Vercel Lab Project：prj_BuJhKyI5fhoIVJRO3jEo6BzSIOhs
Vercel Team：team_kK5GqMJNWpI0A7NmY6nnXgIQ
发布权限：尚未取得两项明确授权，仍只做离线开发与只读查验。

## 一、真实隔离 Lab 状态

本阶段再度通过只读查询证实：27 项远端迁移已经登记；P3-P 的第 28 项仍未生效；M Plan 订阅预算及物理调用账本均为 0 条；现有 Vault generation/Judge 两个角色仍存在，未读取、重新保存或输出其密钥；两个历史 waiting Job 因 parent Mission 不存在成为孤儿，保持原状态。

现有 Vercel Lab Preview READY / SHA 2ce15c2，SSO 保护启用，但不是当前工作树源码；实验分支 vercel.json 的 git.deploymentEnabled 仍为 false。

## 二、发现并修复的发布前风险

之前自动定时对账的实际顺序为：调用 runScheduledJobReconciliation（可能修改其他 Job）→读回报告→发现 orphaned>0 后返回 503。因此尽管孤儿 Job 本身不会被自动修复，检测可能发生得太晚。

本阶段新增应用层 Lab 专用前置门禁：
- apps/backend/src/services/lab-reconciliation-preflight.ts：只读调用原有 inspectLabJobIntegrity。只有 status=clear 才允许后续写操作；blocked、unknown、盘点失败或数据层拒绝均失败关闭；非 Lab 保留既有业务行为。
- apps/backend/server/api/evolution/jobs/reconcile-scheduled.get.ts：校验 CRON_SECRET 后，先执行 Lab 完整性扫描，未通过则立即 503；**在任何 Job 修复和 Artifact Blob 清理之前**停止。
- apps/backend/server/api/evolution/jobs/reconcile.post.ts：Lab 用户主动 repair:true 时，需要 mission.execute 和额外 security.admin 权限，再通过完整性门禁，才允许进入对账服务；repair:false 只读不引入额外写权限；非 Lab 行为保持不变。
- 新增 lab-reconciliation-preflight.test.ts、jobs-reconcile-lab-guard-route.test.ts，并扩充 scheduled-reconciliation-route.test.ts、vitest.p3.config.ts。测试覆盖认证失败、阻断检查、查询不可用、unknown、clear、执行顺序和非 Lab 兼容。
- 既有 P3-O 的 per-Job CAS 和 Mission 存在性复核继续保留，作为前置快照检查后可能出现状态变化时的第二层保护。它不是单个跨表事务，因此不能承诺本地门禁解决所有并发竞态。

## 三、已完成的验证

- 新增/相关专项回归 3 文件 16 项测试全部通过。
- P3 全量回归 45 个测试文件 552/552 通过，失败 0。
- Git 改动只在独立 Lab 工作树，未产生新的部署，且没有清除、取消或重建两个历史孤儿 Job。
- TypeScript 全工程 tsc -b：PASS；ESLint 全量检查：PASS（0 警告）；packages 架构检查：PASS；Vite/Nitro build：PASS。第三方 @vercel/sandbox Source Map 缺失和旧 Browserslist 数据提示为非阻断告警。
- P3-N 迁移 SHA-256 校验仍为 27 项已应用、1 项未应用；P3-R 新增源码及测试后已重新生成离线发布审查收据，不复用之前 73 个文件的旧结果。最新文件数、aggregate SHA-256 与批准状态均以 docs/architecture/2026-11-13-p3q-lab-release-fingerprint.json 的实时 verify 为准。

- 最终 P3 专项回归：45 个测试文件、552/552 项通过，0 失败。上述两条 Lab 修复入口与门禁已编译并进入回归集。

## 四、后续真实环境操作的明确授权边界

第一项：仅在 Supabase Lab jnlbqgpezenmpksyklme 经过最终 SQL 审核后应用 P3-P 的唯一新迁移，保留原 27 项远端迁移登记版本和全部历史 Job/Event/Vault 记录。首次真实应用必须能够检测回读两个 Trigger 和四参数删除 RPC，不能因 SQL 曾在回滚测试通过而宣称已经上线。

第二项：仅在 Vercel Lab Project prj_BuJhKyI5fhoIVJRO3jEo6BzSIOhs 的 Preview target 发布已审查且固定了 Git SHA 的源码版本，不发布主分支、Production 或正式域名，不改原项目。部署后在 SSO 下确认准确 commit SHA、运行时隔离配置与管理员权限。

两项写入需分别获得明确授权。本阶段用户只说继续，不将其扩展为已经批准远端写入或部署。

## 五、在线验收建议顺序

1. 管理员只读 GET /api/evolution/lab-job-integrity，预期仍 blocked，报告两个历史孤儿 Job，**不可据此取消它们**。
2. 以合法 Cron 权限验证 Lab 定时修复在第一个写操作前被门禁阻断；确保没有历史任务重启、改写或文件清理。
3. 在已授权条件下，管理员只读 GET /api/evolution/minimax-subscription-quota；仅返回安全模型元数据、M Plan 5 小时及周额度窗口，不打印 MiniMax Subscription Key。
4. 审核 P3-P 新触发器在 Lab 的真实两连接竞争、DELETE 时 append-only Event 的可验签补录、实际 M Plan 预算/调用账户记录与 durable Workflow 超时。
5. 三代合成 HTML 进化、独立 Judge/隐藏 Holdout/Gate F 需要独立的真实模型执行与额度授权；不与 Preview/SQL 发布批准自动绑定。

结论：P3-R 解决了隔离 Lab 自动修复“先修改再发现孤儿”的顺序问题；本地专项与全量测试通过。仍未发布新数据库迁移或 Preview，生产环境、旧 Job 和 MiniMax 密钥均保持不变。
