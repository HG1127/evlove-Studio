# P3-O · 隔离 Lab 缺失 Mission / 孤儿 Job 运行完整性门禁验收

日期：2026-11-13
工作树：D:\Downloads\evlove-studio-evolve-p0
分支：codex/artifact-evolution-governance-p0
当前基线 HEAD：2ce15c2（P3-H 至 P3-O 修改尚未提交）
Lab Supabase：jnlbqgpezenmpksyklme
Lab Vercel Preview：evlove-studio-evolution-lab，仍为 SHA 2ce15c2

## 一、只读排查发现

独立 Lab 在本阶段查询时，public.missions 没有任何记录；public.jobs 仍包含：
- workflow-control-386fdd09-0b92-46fe-afbd-bd3830e1e776，type=campaign，status=waiting，mission_id=project-1794471973744；
- project-1794471973744:runner-discovery:default，type=other，status=waiting，mission_id=project-1794471973744；
- parse-7f2eecd8-d4eb-4635-8a9a-7629399060cb，type=parse，status=completed，mission_id=null。

前两个 waiting Job 的 parent Mission（project-1794471973744）不存在。此前只读观察该 Mission 为 paused，但无法通过现存事件确认谁或哪次操作将其移除。Postgres pg_constraint 检查显示 jobs 表没有用于保证 mission_id 必须存在于 missions 的外键。**不得据此推断具体删除来源或自动恢复历史内容**。

历史事件继续保存着该 Campaign 的旧模型执行、暂停/等待人工处理凭证。此旧任务不携带 P3-J 的合成实验许可，不能将它当作已受 P3-M Subscription Token 预算保护的进化任务。

## 二、P3-O 落地措施

1. apps/backend/src/services/job-reconciliation.ts
   - 自动对账检查 Workflow 是否存在/成功之前，对任何有 missionId 的工作流 Job 先做受控 Mission 读取核验。
   - 若 Mission 不存在，将其标记为 mission-missing，不读取 Workflow 作为补偿依据，不调用状态迁移，不自动标记成功、失败、取消，也不删除历史。
   - 若 Mission 查询接口出错，标记 mission-inspection-failed 并计入 inspectionFailures，禁止猜测其父级不存在或存在，原始服务端错误不进入公开结果。
   - 同一批任务中相同 Mission ID 的结果缓存于单次对账范围，以减少冗余查询。
2. apps/backend/server/api/evolution/jobs/reconcile-scheduled.get.ts
   - Scheduled auto-repair 若发现 orphaned 数 >0，立即返回 503 和聚合计数，不继续运行后续 Artifact 清理；禁止静默把孤儿任务视为正常。
3. apps/backend/server/api/evolution/jobs/reconcile-preview-scheduled.get.ts
   - Dry-run 预览增加 orphanedJobs 聚合计数；遇到孤儿 Job 则 503 降级，无写入。
4. apps/backend/src/services/lab-job-integrity.ts
   - 新增只读 Lab 全类别 Job-Mission 关联审计，不限于 workflow-control 的 Campaign，也涵盖 type=other 的 waiting Discovery Job。
   - active 为 queued/running/waiting，有 Mission ID 才检查；历史已结束的无 Mission Parse Job 不误判。
   - 存在丢失父 Mission 返回 status=blocked、reason=orphan-active-job；Mission 查询失败返回 unknown；Jobs 盘点超 100 条返回 unknown，不能把截断结果宣称为全量通过。
   - 只读扫描，无取消、无恢复、无任务状态修改。
5. apps/backend/server/api/evolution/lab-job-integrity.get.ts
   - 新增仅隔离 Lab、需 security.admin 的服务端只读 API。未经身份认证、非 Lab 部署、上游查询故障均失败关闭。不读取或暴露 MiniMax Vault 密钥。
6. vitest.p3.config.ts
   - 将新诊断测试及已有对账、定时路由测试加入完整 P3 回归。

## 三、本地验收记录

- P3-O 对账与只读诊断专项 5 个测试文件、35 项测试通过。
- P3 专项全量回归：39 个测试文件、477 项测试通过（0 失败）。
- TypeScript 全工程 tsc -b：PASS；ESLint 全量检查 0 警告：PASS；packages 架构检查：PASS；Vite / Nitro build：PASS（第三方 @vercel/sandbox Source Map 和旧 Browserslist 数据提示未阻断构建）。
- 不修改 Lab 的任何已有 Mission、Job、Event、Vault 或 Subscription Token 预算；不进行真实 MiniMax 调用。
- 依然保留 P3-N 27/27 SQL SHA-256 校验通过、27/27 时间版本号不同的事实；未经审批不改写远端 migration registry。

历史事件额外只读检查：目前保存的历史 Event 类型包括 JobUpdated、AttentionRequired、CheckpointCreated、ActionPlanned、ActionCompleted、JobProgress、JobStarted、JobQueued；未观察到能够证明谁删除 Mission 的事件。不能用不存在的删除日志推断责任人。

## 四、线上阻断和后续风险

- P3-O 代码目前仅在独立工作树，尚未部署：旧 READY Preview 没有新的自动对账门禁和管理员诊断 API。因此 **不能声称旧 Preview 已禁止 orphan Job 的自动对账修改**。
- 只读查询和后续的状态迁移之间仍存在有限竞态窗口。完整数据库级无效 Mission 防护，需要在理清旧孤儿记录归属、可行性和兼容范围后另行制定前向数据模型/原子 RPC 方案，不能直接强加会拒绝旧数据的外键。
- 只读审计当前通过 runtime.jobs.list 扫描全部 Lab Job 并在 100 条以上保守返回 unknown。只适合独立小型 Lab，不可在未经性能与权限验收前扩展为生产全量扫描。
- 继续保持旧的两个 waiting Job 原样等待人工判定，不能自动删除或标记失败。需先找到并确认其创建/所有者、是否需要从历史 Artifact 恢复原 Mission，再决定合法的处理动作。
- 仍需经过明确的独立 Preview 发布授权、受控发布、管理员只读额度 GET、真实跨实例 Workflow/数据库验收，才可能打开下一阶段的合成三代 MiniMax 实验。当前不实施真正的三代生成、Judge、隐藏 Holdout 或 Gate F 验收。

## 五、下一阶段 P3-P

先就 Lab 孤儿 Job 做所有权与残存证据链取证（只读），决定恢复原 Mission、终止旧 Job 或永久保留历史的合规策略；审核 P3-O Git 变更、测试快照和迁移版本对账后，只在获批的 Lab Preview 上部署。优先检查新的 /api/evolution/lab-job-integrity（应是 blocked），再对已保存 Vault M Plan 角色运行管理员只读 quota 检查；合成 Mission 必须重新明确审批、创建、预算初始化，不能借旧 Job 继续尝试。

结论：P3-O 当前新增孤儿 Job 检测与自动对账阻断已完成本地实现；真实在线部署和缺失 Mission 的历史恢复仍未执行。
