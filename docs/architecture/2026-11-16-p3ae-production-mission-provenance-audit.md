# P3-AE · 生产 Mission 数据来源与浏览器缓存隔离验收

日期：2026-11-16
独立分支：`codex/artifact-evolution-governance-p0`
修复起点：`29cc9387dba183fff53834b72ee1ab88175de863`

## 一、真实缺口

P3-AB 已在 HTTP 模式排除了内置 `demo`，但原有 `composeProjects()` 仍返回 `listLocalProjects()` 中非 demo 的项目。项目列表、全局搜索、工作台、问题中心、经验与系统洞察均依赖它；与此同时 `ProjectLoader` 通过 `readProductionMission` 读取服务端，导致浏览器历史缓存可能混入真实业务统计，且点击后返回“项目不存在”。

生产模式下，浏览器缓存不是 Mission 真实存在的充分证据。必须同时具备本轮 HTTP Mission 同步成功、服务端当前目录的身份确认及未处于删除状态。

## 二、实施范围

1. `src/features/evolve/runtime/use-local-projects.ts`：HTTP 模式仅在 `productionSyncStatus().realtimeStatus === 'http-polling'` 时，允许 `missionSyncJournal().knownRemoteIds` 中的非 demo、非 pendingDelete ID 进入已确认项目数组。同步失败或尚未完成时返回空的“已确认”项目集，不再把未确认缓存视为真实记录。监听 `evolve-production-realtime-status`，跟随服务端核验状态重算。Local 原型模式保持旧行为。
2. `src/features/evolve/components/projects-list.tsx`：把真实项目和非已确认的浏览器项目分区。服务端状态未核实时显示“尚未核验”，而不是把暂时空列表宣称为服务器没有项目；本地缓存／待同步草稿独立保留，支持导出 JSON，但不提供虚假的服务端 Mission 详情链接，也不计入已确认项目数量。
3. `src/features/evolve/runtime/use-local-projects.test.ts`：测试真实 Mission ID 与 demo、缓存孤儿、pending delete 的隔离，以及同步中断时的 fail-closed 行为。
4. `src/features/evolve/components/projects-list-authority.test.tsx`：页面级测试验证本地记录保留但不进入服务端统计和详情链接，以及已确认项目正常展示。

## 三、安全和一致性约束

- 不删除、不清空、不覆盖 LocalStorage / IndexedDB 中既有用户资料；没有改变 `production-sync.ts` 的 Mission POST/PUT/自动同步策略。本轮只是浏览器 UI 的**只读身份展示隔离**。
- 存在未处理的后续风险：`production-sync.ts` 的 `pollHttpProjection()` 会将未知的本地项目纳入 `localToPush`，随后调用 `pushLocalProjection()`；如果把某条历史缓存误认为有意新建的离线草稿，可能被自动注册到服务端。**本次修改没有阻止自动注册**，因此不能称后端“真正只由服务端决定”；下一阶段需要明确“离线新建草稿”和“未知历史缓存”的不同意图，再设计审批/登记和可靠同步收据，严禁直接删除本地资料或绕过当前权限。
- 已确认与未确认项目分开统计，不代表项目的所有 Evidence、Artifacts 和工作流状态都经过在线回执验收。系统的真实业务闭环与 Browser/Sandbox/Minimax 生成和 Judge 仍需要单独授权并核验。
- 本阶段不改变旧迁移、Lab 或生产数据库、Vault Key、历史两条孤儿 Job、主分支和生产环境；不触发真实 AI/云 Sandbox/Browser 执行，不部署生产或 Lab Preview。

## 四、自动化验证

- 相关五份测试文件（含新组件测试）：**16/16 PASS**；`tsc -b --pretty false`：PASS。
- P3 隔离治理回归：**56 文件，752/752 PASS**。
- `pnpm architecture:check`、全项目 `pnpm lint`、`pnpm exec vite build`、`git diff --check`：退出码 0；第三方 Vercel Sandbox 缺失 source map 为非阻断构建告警。
- 全仓库 root Vitest 八分片：`pnpm exec vitest run --config vitest.config.ts --shard=N/8 --maxWorkers=2 --reporter=dot`，使用两个并发的 Runner Job、N=1..8。**515 个测试文件全部获得退出码 0，4,628 项通过、3 项跳过、0 项失败，4,631 项共计**。
- 分片明细：1/8：65 文件、687/687 通过；2/8：65 文件、535 通过／1 跳过；3/8：65 文件、461 通过／1 跳过；4/8：64 文件、587/587 通过；5/8：64 文件、569/569 通过；6/8：64 文件、591/591 通过；7/8：64 文件、612 通过／1 跳过；8/8：64 文件、586/586 通过。总计各组文件数 515，没有重复分片或未完成任务。
- 8 组分别耗时约 85.37、86.21、96.96、99.42、87.97、86.04、76.13、78.89 秒。三项跳过原样保留，**不应当计入通过数**。

## 五、线上验收与下一步

目前线上 Lab Preview 仍需在发布精确经审计的新 SHA 后单独复验。复验应检查：未注册缓存不产生可打开的真实 Mission；服务器真实 0 Mission 时问题／成果等统计不混入历史数据；断线时展示未知而非虚构的 0；本地草稿可导出且不丢失；模型连接、版本和运行治理 F03–F07 修复不退化。

完整八分片根回归、P3 回归和构建通过只证明本地代码基础，不替代已授权 Chrome 真实在线验收、生产准入或 MiniMax 真实进化闭环测试。此前全局两个历史孤儿 Job 的治理阻断仍需独立处理。