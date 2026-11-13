# P3-U · 独立合成 Mission 隔离研判与物理模型调用预算可行性

日期：2026-11-13
系统：Evlove Studio Evolution Lab
独立项目工作树：D:\Downloads\evlove-studio-evolve-p0
唯一开发分支：codex/artifact-evolution-governance-p0
本阶段开始前 Lab Preview：dpl_3EqYxDpooQzPtQRyQgTKYpVd6K2J，Git SHA 81c931e2b53fc50795c3f89c55029444832278f7
Supabase Lab：jnlbqgpezenmpksyklme
Vercel Lab Project：prj_BuJhKyI5fhoIVJRO3jEo6BzSIOhs

## 一、需要纠正的假设

P3-T 只读预检在 Lab 发现历史孤儿 Job 后返回 status=blocked。**这并不意味着新 Mission 必须复用、取消或删除原来的两个 Job 才能开展独立实验。**

后端的正式 /api/evolution/start 启动逻辑按目标 Mission ID 检查活跃 Campaign，使用 durable Job 创建 RPC 和每次物理调用的 Token 预算、身份与模型路由检查。全局 Mission/Job 完整性阻断主要保护通用定时对账、人工修复操作，防止历史孤儿 Job 被误改；它不是所有新 Mission 的通用启动前置检查。

本阶段不调整 /api/evolution/start 的审批语义，不关闭/绕过全局对账安全门槛，不更改历史 Job。需继续核实新 Mission 的源文件、审批身份、控制 Job、预算及持久 Workflow 能否在独立范围正常运行。

## 二、隔离 Lab 实际只读数据

- 28 项数据库迁移已经应用，Mission 现有 0 个。
- 保留的 waiting Job 两个，均引用已不存在的 project-1794471973744：
  - project-1794471973744:runner-discovery:default（type=other）
  - workflow-control-386fdd09-0b92-46fe-afbd-bd3830e1e776（type=campaign）
- M Plan 专用预算/物理调用表均为 0 行，已保存加密 Vault 角色 2 个。
- 两个历史 Job 未恢复、取消、修改、删除或迁移给新 Mission；现有签名证据和 Event 也保持原状。

## 三、P3-U 新增只读 Mission 隔离判定

对 apps/backend/src/services/lab-three-generation-readiness.ts 扩展但**不改变接口性质**。

原有全局报告 status=blocked 及 LAB_ORPHAN_ACTIVE_JOBS 会继续保持。新增 candidateScopeStatus、candidateActiveCampaigns、unrelatedHistoricalOrphans 的只读研判：

1. 仅在管理员已指定审批 Mission ID 的情况下，再按该 Mission ID 查询已有活跃 Campaign（queued/running/waiting），最大 100 条。返回满页、未知、错误时一律不能当作完整数据。
2. 当历史孤儿 Job 均具有有效的 parent Mission ID、其 ID 与候选 Mission 不同、候选 Mission 自身确实存在且为可执行 HTML、并且没有其他活跃 Campaign，结果可为 reviewable-with-global-alert。**它只表示可以继续人工评审，不是隔离许可、任务启动许可、模型调用许可或对旧异常的豁免。**
3. 如果同一目标 Mission 的 Job 异常、已经存在活跃 Campaign、Mission 不存在、不属于可执行 HTML、列表截断或来源不明，candidateScopeStatus 应为 blocked 或 unknown；保持所有预算/密钥的原有强制约束。
4. 全局 integrity 检查还是独立执行，blocked/unknown 依然禁止自动修复和定时清理旧 Job。没有建立任何新的“白名单跳过”或自动隔离操作。
5. 无论 candidateScopeStatus 如何，响应始终 executionAllowed=false、requiresSeparateModelAuthorization=true、modelCallsPerformed=false、providerQuotaChecked=false。该诊断不会读取或输出任何 API Key，不调用供应商，不做数据库写入。

## 四、3 代 Candidate + 独立 Judge 的物理模型调用下限

本次把 Lab 的 6 次物理调用上限收敛为唯一常量，与 createLabWorkflowPermit 使用相同基准。

针对期望的“每代一次生成、每代一次独立 Judge”计划：
- 三代 Candidate 的最低生成调用预算：3 次。
- 三次独立 Judge 的最低调用预算：3 次。
- 上述两个活动的**计划下限合计 6 次**，已占满当前单 Mission 的 6 次物理调用额度。
- Baseline、理解/评估集/规划、Holdout、独立 Final Holdout、修复重试或 Gate F 评审，如其中任何环节再产生物理 AI 调用，则同一 6 次额度无法保证完成全部链路。
- 因为目前尚未完整测量真实 Workflow 每阶段的物理模型调用次数，callFeasibility.fullLifecycleWithinCallCap 固定为 unverified；不承诺一次 20 分钟、6 次调用即可获得 Gate F 通过。
- 不为适配目标而偷偷提高 Token/调用次数上限，更不能通过另建 Mission 或反复重试重置预算。后续如需扩容，必须重新审查额度与明确取得用户授权。

## 五、测试与上线验收范围

新增/强化的单元测试覆盖：
- 原有两个孤儿 Job 与目标 Mission 不同：全局 blocked 不变，目标可被报告为 reviewable-with-global-alert，但 executionAllowed 仍为 false。
- 孤儿 Job 所属 ID 与目标 Mission 相同：目标范围 blocked。
- 已经存在同一 Mission 的活动 Campaign：拒绝推荐启动。
- 活跃 Campaign 查询失败或 100 条满页：返回 unknown，不输出服务端错误。
- 历史孤儿 Job 缺少父 Mission ID / 全局完整性结果自相矛盾：不判定“已安全隔离”。
- 目标 Mission 缺失或不为可执行 HTML：不得报告可评审。
- 三代与三次 Judge 仅是物理调用计划下限，剩余预算 0；整套 Gate F 生命周期可行性 unverified。

本次未调用任何真实 MiniMax 生成/Judge，没有初始化任何 Lab 预算，也没有修改旧 Job。

### 实际测试记录（2026-11-13）

- P3 全量专项回归：52 个测试文件、682/682 项通过。
- Mission 范围与 Permit 关联专项：3 个测试文件、23/23 项通过。
- TypeScript 全工程检查、ESLint 全量检查（0 警告）、packages 架构检查和 Vite/Nitro 构建：全部退出码 0。
- 第三方 @vercel/sandbox 缺失 Source Map 和 Browserslist 数据较旧的提示仍是非阻断构建日志。
- Lab 迁移 SQL SHA-256：28/28 验证通过，未执行新迁移，也未改写历史。
- 现场只读复核：旧 orphan waiting Job 两个、Mission 零条、M Plan Token 预算及调用账本均零条，两个 Vault 角色保持不变。

## 六、下一步 P3-V 前的明确门槛

1. **新 Mission 来源与内容：** 仅合成 HTML，不包含客户资料或真实投研策略；源 HTML、目标行为、受保护区域、已冻结可见/隐藏/独立最终测试、唯一新 Mission ID 都必须可核验。
2. **模型与审批：** Generation MiniMax-M3、独立 Judge MiniMax-M3.1-Flash，复用现有加密 Vault；人工单次审批、新 Mission 绑定和实验武装需要单独授权。
3. **预算可行性：**先以合成 Workflow 逐步验证物理调用需求，区分六次之内可完成的受控实验段与可能需要更多调用的 Baseline/Holdout/Gate F，不得把整个目标塞进未验证的 6 次额度。
4. **安全执行：**只操作受控 Lab Mission；历史两个孤儿 Job 不应成为新实验的父级，也不得被自动对账操作修改。身份、额度、用量、恢复、时间上限核验失败时立即停机并保留证据。
5. **真实运行许可：**此次“继续下一阶段”不构成真实 MiniMax 调用许可。下一阶段必须由用户明确批准唯一合成 Mission、最多物理调用及时间/Token 上限和是否包含独立 Judge。

**结论：P3-U 的范围隔离与调用预算可行性研判属于只读、零模型调用的可审查成果；真实 3 代 AI 进化、Judge 与 Gate F 未授权也未执行。**
