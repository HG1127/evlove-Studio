# P3-AF · 明确新建 Mission 同步许可与历史浏览器缓存隔离

日期：2026-11-16
工作树：`D:\Downloads\evlove-studio-evolve-p0`
分支：`codex/artifact-evolution-governance-p0`
起始 SHA：`df25ae9bdc6b527c20d422e17eeb06f57cf20f88`

## 一、背景与风险

P3-AE 解决了旧浏览器缓存混入生产项目列表、搜索和统计的问题，但 `production-sync.ts` 的三类写入路径（启动合并、周期轮询、用户更新后的直接同步）仍可能将服务端未知的所有本地项目当成新任务自动登记。原先仅凭“不在 knownRemoteIds”就允许首次写入的规则无法区分用户主动创建的离线草稿与多年遗留的 LocalStorage/IndexedDB 缓存，可能误注册历史资料并触发后续 Job/Event、文件上行。

## 二、P3-AF 已实施的控制

1. `project-database.ts` 的 Mission 同步 journal 新增 `pendingCreateIds`，旧版无此字段的 journal **默认空数组**，不能因为历史数据存在而推断已经同意注册。明确创建标记 `markExplicitMissionCreation` 不接受 `demo`、已确认服务端 ID 或待删除 ID；去重持久化，随当前 IndexedDB/LocalStorage journal 保存。
2. `evolution-composer.tsx` 在用户真正通过 Composer 创建新任务且本地保存后才登记新的同步意图；本地原型模式不使用服务端许可。
3. `production-sync.ts` 的 startup、poll 和 direct-write 三条路径只会首次上传服务端未知且有明确 `pendingCreateIds` 的项目；已由本轮服务器目录确认的 Mission 仍可按原有 CAS 规则更新。服务端成功保存后把 ID 登记为已知并消耗 pending-create 收据。已经从服务器删除的历史 Mission 不会通过普通本地缓存重新注册。
4. 离线新建的明确意图在 401/503 等网络阻断下保留；恢复后轮询可继续同步。尚未同步就被用户删除的新任务会撤销待创建意图，避免错误远端 DELETE 或随后的隐式重建。
5. 首次启动时的历史 Source/Candidate Artifact 迁移队列只加入此次服务器目录已确认或明确排队创建的 Mission 关联文件，不再因无关旧缓存的 Source ID 而新增迁移项。
6. `production-sync.ts` 的点读取严格区分服务器真实 404 与本地缓存：服务器不存在就返回 `undefined`，不能用浏览器 draft 假冒已登记 Mission。成功保存会发出 `evolve-mission-registration-changed` 事件以便详情页重新读取。
7. `project-loader.tsx` 对用户新建但尚未登记的项目显示“正在登记新建任务”，而不是假装服务端已注册；收到保存回执后重试服务器查询，其他真正缺失的任务仍显示不可用。
8. `projects-list.tsx` 把未知缓存/导入备份作为本地记录保留，支持导出；用户通过“登记为新任务”加二次确认才可进入新 Mission 同步队列，且必须先建立可信的服务端同步状态。导入备份本身不授予上传许可；与现有真实项目、旧缓存或 demo ID 冲突时避免覆盖。本次确认不会调用模型或执行 Workflow。

## 三、测试策略与保留的旧功能

- 既有服务器 Mission 的编辑、CAS 冲突和删除、远端删除后的防复活、离线新建后恢复、离线删除、Job generation 恢复及 Artifact 源文件恢复等测试保留，不静默降低旧功能。
- 新增/更新专项测试验证：旧 journal 无许可、旧缓存跨启动与轮询不上传、新建明确标记能成功登记且回执一次性消费、用户在线主动登记、网络中断后恢复、登记前删除、浏览器本地详情不能伪造服务端 200、需要二次确认与被阻断的离线 UI 状态。
- 真实 MiniMax、独立 Judge、Vercel Sandbox、Hidden/Final、Gate F 及云端服务端写入均未执行，本阶段所有服务器持久化验证使用模拟 ports。完整环境的 RLS/Vault、文件授权与运行治理尚需独立在线审批。

## 四、仍需独立治理的边界

- `artifact-blob-store.ts` 的**既有待上传 Outbox**及用户上传前置文件可能绕过本轮的 Mission 创建许可；本阶段仅限制“启动历史迁移队列新增任务”的来源，不更改当前解析、预上传或旧待传文件的结构。后续应评估并绑定每份文件的 Mission/用户授权/用途，不可直接删除旧文件。
- `pushLocalJobs` / `pushLocalEvents` 保留原有离线执行及证据恢复机制；它们是否会对无服务端父 Mission 的历史本地记录进行无效上行，仍需明确父子身份检查与兼容性复验。本阶段不擅自更改这些独立数据流，也不处理既有的两条历史孤儿活动 Job。
- 备份恢复中涉及旧 Mission ID、冻结 Artifact、历史 Evidence 和 Candidate 关联身份；二次确认只表示用户同意提交新 Mission，**不代表**全部关联文件和安全验收已通过。服务端规则不满足时应保留本地资料及错误证据，不关闭或绕过安全检查。
- 在未授权的新版本发布之前，在线 Lab Preview 仍运行上一版本；所有本次通过的测试都不能当成真实浏览器端到端证据。

## 五、验证登记

- 初轮同步、断线和本地存储测试：30/30 PASS；加强 404 读取及项目详情后：29/29 PASS；二次确认与列表 UI 后六个关联测试文件：41/41 PASS。
- 完整根 Vitest 八分片：**515 个测试文件、4,635 项通过、3 项原样跳过、0 失败，8 个分片退出码均 0**。第 1 组 688/688，第 2 组 535 通过/1 跳过，第 3 组 461 通过/1 跳过，第 4 组 587/587，第 5 组 569/569，第 6 组 591/591，第 7 组 612 通过/1 跳过，第 8 组 592/592。命令模板 `pnpm exec vitest run --config vitest.config.ts --shard=N/8 --maxWorkers=2 --reporter=dot`，两个分片并发，N=1..8。
- 独立 P3 治理测试：**56 文件、752/752 通过**。
- TypeScript `pnpm exec tsc -b --pretty false`、`pnpm architecture:check`、全项目 `pnpm lint`、`pnpm exec vite build`、`git diff --check`：**全部退出码 0**；`@vercel/sandbox` 第三方 source map 缺失仍有非阻断告警。
- 复用的关键同步/详情/UI 六份测试：**41/41 通过**；这些基于内存端口，不代表真实 Vercel 或 Supabase Lab 写入成功。

## 六、边界承诺

本阶段只允许独立实验分支的本地代码和模拟测试，不允许 Github push、Vercel Lab/Production 部署、Supabase Lab/生产数据写入、历史迁移改动、Vault Key 操作、旧孤儿 Job 变更或任何真实模型/云 Sandbox 调用。完成后以精确 SHA 交接，后续 Lab Preview 发布和真实闭环必须另行授权。
