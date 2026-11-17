# P3-X 真实 MiniMax 调用超时与 Workflow 重试阻断修复

日期：2026-11-17；范围：仅 Evolve Studio 独立 Lab 实验分支 `codex/artifact-evolution-governance-p0`。

## 一、真实事故与可验证边界

唯一 Mission：`lab-synthetic-html-task-filter-p3x-v1`；原始 HTML Artifact 已受审计登记并绑定，SHA-256 为 `192abea39d167d9c0f4310fc603905905de5fa44106685fc7d6ea3d2931da8dc`（2,067 字节）。

2026-11-17 07:16:30 UTC 创建 Control Job `workflow-control-fadfbcce-a272-4ea5-9068-4332699e4eaf` 与 Durable Run `wrun_01M7M5V8CWNJGFWG6MQDNV36V6`。订阅预算 maxCalls=6，maxTokens=300,000，截止时间为 07:36:30 UTC。MiniMax-M3 在 `understand` 步骤发生**一次**真实 HTTP 物理调用：`73ceaeb6-57d7-44a5-861b-246998a477a3`，预留 23,287 Tokens。响应约 88.7 秒后记录 `transport-error/provider-timeout`；无 Provider JSON 或用量数据；账本变为 `unknown`，预算被取消；`spent_tokens=0` **不代表供应商实际未扣费**。

Vercel Workflow 日志随后显示 `executeServerControlStep` 在第 4 次步骤尝试后报 `budget-inactive`。框架重试不是另外三次物理 HTTP 调用，数据库仅有一笔预留记录。最终 Control Job 为 `failed`，Mission Revision 3、Campaign `paused`，Candidate 0，独立 Judge 未执行。原失败记录不可删除、重置、重放或以新 Mission 换取预算。

## 二、最小修复

1. **Workflow 步骤重试围栏。** `workflows/evolution-mission/steps.ts` 在原 `ServerControlExecutionStoppedError` 安全停止分支之后、普通能力等待/重试逻辑之前，仅当 `input.labExperiment` 存在时，把剩余步骤错误转换为 SDK 原生 `FatalError`。Workflow SDK 对 `FatalError` 不做默认三次步骤重试；普通非 Lab 工作流原有行为不变。
2. **安全错误摘要。** 新增 `workflows/evolution-mission/lab-control-step-failure.ts`。只显示经过白名单过滤的 `LAB_*`、`SERVER_AI_PROVIDER_TIMEOUT`、`SERVER_AI_PROVIDER_NETWORK_ERROR`、`AI_USAGE_START_NOT_RECORDED` 代码；其他情况统一 `LAB_CONTROL_STEP_FAILED`。绝不回显 Provider 原始消息、Header、Vault Key 或模型输出。此次不改变单次请求的持久化 Token 预留/结算、失败冻结和跨实例取消规则。
3. **有界超时缓解。** 代码现有 `serverAiTimeoutMs()` 默认 90,000ms，且保存的 Vault 连接在请求时从服务端读取该配置，HTTP 使用 `AbortSignal.timeout(config.timeoutMs)`。只在 Vercel 独立 Lab 项目 **Preview** 环境新增 `EVOLUTION_AI_TIMEOUT_MS=150000`（仍受 20 分钟 Mission 截止与最大 300,000ms 服务端上限控制）。这属于针对观察到的接近 90 秒超时的受限缓解，**不能证明供应商或网络故障已经消失**；不修改任何模型 Key、模型路由或普通生产环境的超时。
4. **结束实验许可。** 已将同一 Lab Preview 的 `EVOLUTION_LAB_EXPERIMENT_ARMED` 设为 `false`；唯一 Mission 白名单仍保留作来源记录，但未来新 Preview 不会默认允许再次启动。注意：先前已部署的历史 Preview 持有创建时环境快照，不能声称历史 URL 已自动撤销。用户和执行器不得从历史 Preview 重启已失败实验。

## 三、验证与交付边界

- `apps/backend/src/services/lab-control-step-failure.test.ts`：12 项 SDK `FatalError`、错误代码和敏感信息隐藏测试。
- `apps/backend/src/services/lab-provider-timeout-config.test.ts`：3 项服务端超时默认、Preview 配置和上下限测试。
- 与既有 MiniMax 物理 HTTP 重试围栏测试合计 22 项通过；P3 整体回归 58 个文件、767 项通过。
- 仅源码、配置、测试与 Lab Preview 发布；不重试既有 Control Job，不创建新的 Subscription Budget，不请求或打印 Key，不对供应商发新请求，不修改主分支、生产或已有 Supabase 迁移。

**未闭环事项：** 未取得供应商对该超时物理请求的实际计费/Token 用量确认，也未实证 150 秒配置能够使 MiniMax-M3 完成真实回答。新一轮模型调用需要另行审批新实验的精确预算与防重放路径；不得沿用或恢复已取消的 P3-X 预算。本次修复的验收限于“隔离 Lab 错误不再被 Workflow 盲目重试”和“后续新 Preview 处于 disarmed 状态”。
