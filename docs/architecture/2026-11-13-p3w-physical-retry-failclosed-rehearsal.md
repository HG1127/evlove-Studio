# P3-W · 独立 Lab 物理模型请求失败保护与持久证据合成演练

日期：2026-11-13
项目：Evlove Studio Evolution Lab
独立工作树：D:\Downloads\evlove-studio-evolve-p0
隔离分支：codex/artifact-evolution-governance-p0
阶段基线 Git SHA：1a0705f4f2eab5ac954765504194727c2d59ebaf
隔离 Supabase Lab：jnlbqgpezenmpksyklme
隔离 Vercel Lab 项目：prj_BuJhKyI5fhoIVJRO3jEo6BzSIOhs

## 一、任务边界与证据级别

P3-V 已静态确认完整三代 HTML 进化 + 独立 Judge + Hidden/Final Holdout/Gate F 的真实调用次数无法保证落在当前 6 次物理调用上限之内。本轮 P3-W 聚焦接近实际 HTTP 出口的**合成网络故障演练**：确保每次物理发送前有独立预算预留与 AI 用量起始收据，在失败或重试期间不会无凭据继续发请求。

所有 provider HTTP 响应均由 Vitest 的 `vi.stubGlobal("fetch", syntheticFn)` 生成；实验上下文、MiniMax 模型名称、API Key 均为**合成数据**，并没有访问 MiniMax 服务或真实 Vault；`reserveLabAiDispatchAttempt`、`settleLabAiDispatchAttempt` 的网络数据库边界均用模拟函数替代。因此结论是**真实应用模型请求管线在合成输入下的控制流验证**，不是实测订阅额度消耗，也不等于真实 DB 或模型运行端到端已经完成。

不更改数据库迁移、实际 Mission、历史两条等待的孤儿 Job、Vault 密钥、模型路由、主分支或生产环境。不创建/激活 EVOLUTION_LAB_EXPERIMENT_ARMED，也不设置获批 Mission ID。

## 二、新增模拟演练

新增文件：
`apps/backend/src/services/server-ai-lab-retry-fencing.test.ts`

将此文件纳入 `vitest.p3.config.ts` 的完整实验安全回归。

直接以源码服务 `fetchServerAiProviderUsage`、`withServerAiUsageScope` 驱动真实控制流；模拟输入为 MiniMax-M3 中国区官方模型 API 路径，使用合成凭证。主要验证：

1. **网络错误后的两次物理尝试**：在模拟预算服务明确允许继续时，首次模拟 ECONNRESET 后第二次尝试会获得不同的 `callId` 和新的预留，持久使用收据顺序为 `start(1) → result(1) → start(2) → result(2)`，两次均各自结算。**这仅证明代码可以在预算服务明确允许时按预期重试，不代表真正未知用量可被当作安全可重试。**
2. **第二次预算拒绝**：第一请求发生网络错误，第二次的模拟预算预留拒绝时停止，外部 `fetch` 仅调用一次；不会以同一个调用 ID 隐式重试。
3. **服务容量拒绝**：在模拟持久结算明确允许时，首个 503 `model is at capacity` 的后续请求也必须得到新预留，旧失败响应及新成功响应都分别产生调用记录。
4. **未知 Token 计量拒绝继续**：当模拟服务对网络断连后的用量判为 `LAB_SUBSCRIPTION_USAGE_UNVERIFIED` 并拒绝结算时，真实请求管线立即停止，不发第二次请求。对应已有 `server-ai-lab-budget-dispatch.test.ts` 覆盖“未获可信 Provider 用量则以 null 结算并暂停预算”的服务逻辑。
5. **容量失败的用量不明**：当 503 的用量结算也被判为不可信时，自动终止重试，而不是假定 503 必然不计费。
6. **起始用量记录持久化失败**：即使模拟预算预留成功，若 `request-start` 写入失败， provider `fetch` 调用次数保持零，返回 `AI_USAGE_START_NOT_RECORDED`。其安全副作用是已预留但无成功起始收据的预算应继续停机待人工核验，不能擅自清算。
7. **普通 HTTP 429 响应**：未经容量拒绝特征核实的 429 不会被伪装成成功，也不自动反复重试；实际调用方必须根据 HTTP 状态处理失败。

以上七个专项测试，不读取服务端真实密钥、也不启动 Workflow 的任何写数据库或模型生成分支。

## 三、当前物理预算限制（保持不变）

- 仅隔离 Lab 下的精确批准合成 Mission 可进入真实 Workflow；
- 单次批准最多 **6 次物理模型请求、300,000 Token、20 分钟**，订阅 5 小时/周剩余额度需达到 **50%**；每次新的物理调用先独立重新查询配额并预留；
- **3 代生成 + 每代一次独立 Judge** 的名义调用为 6 次，无规划、额外纠错、Baseline/Hidden/Final Holdout、网络重试的余量；
- 不允许靠拆成额外 Mission 重置预算，亦不得省略 Gate F 或复用不可信的旧结果。
- 现在正确的判断是：完整生命周期实际物理模型调用数 **尚未测量，且不保证 6 次可以完成**。

## 四、验收级别与剩余步骤

已知既有 P3 保护测试还有独立的真实路由合法性、额度不足、单次 Token 限制、Vault 角色分流、调用前预算预留、用量缺失暂停、20 分钟 Durable Deadline、事件收据、防重复 Job、三代合成成果字节冻结和 Gate F 独立最终盲测约束。P3-W 重点补齐**同一个逻辑调用在多次物理尝试之间**的异常行为，而不是重复旧的代码检查。

新版本在线只读验收应继续检查：
`GET /api/evolution/lab-three-generation-readiness`
只允许已登录独立 Lab 管理员读取；必须保持 `executionAllowed=false`，`physicalCallPlan.fullLifecycleProven=false`，历史孤儿 Job 全局阻断未解除，不能泄露 API Key。

下一阶段真正需要的不是新增系统模块或重新配置 MiniMax Key，而是由用户**单独明确批准**一个新合成 HTML Mission 的有限真实实验、最多物理调用与 Token/时间上限；先评估最小生成 + 独立 Judge 实际用量，再决定是否可能运行三代全链路。此前所有判断均属于零真实模型调用的合成证据，不得宣传为真实三代自动进化成功。

## 五、文件与实施口径

- 代码变更限于专用测试及 P3 运行回归配置，以及本交接文档；
- 不修改现有 provider 请求执行代码、Token Ledger 或后端正式放行逻辑；
- 发布只允许受 SSO 保护的 Vercel Lab Preview，必须固定并核对完整 Git SHA；
- 生产 Supabase 与 Vercel、主分支、两个历史 orphan waiting Job 保持不变。
