# P3-V · 三代 HTML 进化物理模型调用预算审计与零调用就绪验收

日期：2026-11-13
系统：Evlove Studio Evolution Lab
工作树：D:\Downloads\evlove-studio-evolve-p0
隔离分支：codex/artifact-evolution-governance-p0
本轮之前 SHA：f29b2896efb51372c8f9e2a4deb6964f7155d46a
隔离 Supabase：jnlbqgpezenmpksyklme
隔离 Vercel Lab：prj_BuJhKyI5fhoIVJRO3jEo6BzSIOhs

## 一、问题与结论

P3-U 提示了 3 代生成 + 每代一次独立 Judge 的名义六次调用预算等于单个 Mission 上限六次。P3-V 核查真实源码后进一步确认：当前完整 Durable Workflow 涉及多种**可能消耗物理模型调用**的环节，而一次逻辑操作还可能因网络重试、输出格式纠正、Candidate 构造修正、Judge 分片、Paired 双序而进行额外的物理尝试。

因此，**不能证明三代 HTML 生成 + 独立 Judge + Baseline/Hidden/独立 Final Holdout/Gate F 全部能够在 6 次物理调用/20 分钟内结束**。这并不是额度不足的结论，而是“运行工作量尚未实测、现有试验上限不足以保证整套流程”的严谨结论。

本轮只增添零网络调用的源码索引、名义预算计算和可追溯测试。不得以模拟结果代替实际 MiniMax 的供应商用量证据。

## 二、源码验证过的可能调用路径

| 阶段 | 逻辑操作或调用入口 | 已确认源码 |
| --- | --- | --- |
| 理解与准备 | understand、rubric、eval-suite | workflows/evolution-mission/steps.ts |
| 问题与计划 | problem-analysis、diagnose、plan | workflows/evolution-mission/steps.ts |
| Baseline | execute-artifact-batch、Judge evaluate（取决于测试执行模式） | apps/backend/src/services/server-baseline.ts；server-evidence-judge.ts |
| Candidate 生成与修复 | build-candidate、repair-artifact、execute-artifact-batch、evaluate | server-experiment-artifacts.ts；server-artifact-acceptance.ts；server-experiment.ts |
| 可选成对评审 | evaluate-paired；按正反顺序两次物理评审 | server-paired-evidence-judge.ts |
| Hidden Holdout | Original/Candidate 语义执行、独立评分及 release-review | server-holdout.ts |
| Final Holdout | 冻结最终题集生成 eval-suite，随后调用相同 Holdout 执行组件 | workflows/evolution-mission/steps.ts；server-independent-final-holdout.ts |
| 运行后学习 | distill、next-queue | workflows/evolution-mission/steps.ts |

**上述为代码路径清单，不等于每次运行都会调用所有环节。** 实际模型调用数量依赖已冻结的 Mission 输入、真实执行能力、AI 输出、审批状态、不同执行模式、候选数量和失败重试。

## 三、物理 HTTP 预算与单次逻辑调用的区别

真实 provider HTTP 发送统一经由 server-ai-usage.ts 的 beforeAttempt 调用 reserveLabAiDispatchAttempt，先申请不可抵赖的 Lab 订阅预算记录，再进行尝试，结束后按可信 provider usage 结算。如果一条逻辑请求因传输问题再次发起物理 HTTP，请求仍需新的预留和额度核验。

重复调用来源包括：
- packages/adapters/src/ai-provider-request.ts：一次可重连的网络/容量失败会触发后续物理尝试。
- apps/backend/src/services/ai-gateway.ts：无效 JSON 或结构化输出可在受控策略允许时进行一次格式修正请求。
- apps/backend/src/services/server-experiment-artifacts.ts：Candidate 材料化/构造预检查失败后，可能进行一次模型纠正请求。
- apps/backend/src/services/server-artifact-acceptance.ts：受策略约束的修复构造纠正可能进行额外模型请求。
- apps/backend/src/services/server-evidence-judge.ts：Judge 输出失效后，可按 Criterion 递归分片重新评审。
- apps/backend/src/services/server-paired-evidence-judge.ts：成对 Judge 要求两个相反顺序的独立物理评估，不能按一次计算。

这些机制在原本“最多六次”的物理模型调用预算控制下均不得免费放行。**物理调用次数与 Token 消耗是不同的预算维度，且不能把一个模型调用总数视为 Token 上限已足够。**

## 四、零真实调用的两种预算情景

P3-V 新增纯函数 assessLabPhysicalCallFeasibility，所有结果都标记 kind=unbilled-scenario、performedProviderRequests=false、fullLifecycleProven=false。

| 明确的名义情景 | 生成物理调用 | Judge 物理调用 | 额外 AI 物理调用 | 名义调用合计 | 六次限额结论 |
| --- | ---: | ---: | ---: | ---: | --- |
| 三代各一次生成+一次独立 Judge | 3 | 3 | 0 | 6 | 仅理论上正好用满，无重试余量 |
| 同上 + 一个规划/Baseline/Holdout/重试请求 | 3 | 3 | 1 | 7 | 超出当前上限，必须拒绝 |
| 一代生成 + 一次独立 Judge 的受控烟测 | 1 | 1 | 0 | 2 | 名义剩余 4 次，但不表示完整任务获批 |

这只是**指定情景的算术模拟**。真实三代可能表现为首次 build-candidate + 两次 repair-artifact，而不是三次 build-candidate；各自可能需要修正调用。Baseline、Hide/Final 验收可通过确定性执行减少部分模型请求，也可能因证据模式需要更多请求。此表不能推出精确生产费用、物理调用数或必然成功。

## 五、实现与防误用

- 新增 apps/backend/src/services/lab-physical-call-feasibility.ts：源码定位数组 LAB_MODEL_CALL_SITES、重复物理尝试证据 LAB_PHYSICAL_ATTEMPT_GUARDS，以及纯名义预算计算。
- apps/backend/src/services/lab-three-generation-readiness.ts：现有管理员只读检查增加 physicalCallPlan，不改 Lab 预算、不调用 MiniMax、也不启动 Mission；仍保持原 status/blockers/历史孤儿保护。
- 新增 lab-physical-call-feasibility.test.ts：代码位置与运行实际源码逐条比对，6 次/7 次/2 次情景、异常输入拒绝、零网络调用；加入 vitest.p3.config.ts。
- 不修改物理预算拦截、Lab Permit、正式启动审批逻辑、数据库迁移、Mission 数据、旧孤儿 Job 或模型 Vault Key。

## 六、P3-V 完成判定与后续路径

验收需依次确认：
1. P3 相关测试全部通过，重点是源码索引不过时、一次额外模型调用必然触发“名义超六次”的提醒；
2. TypeScript、ESLint、架构检查及构建通过；
3. 隔离分支 Git SHA 固定，仅 Preview 发布且 SSO 不变；
4. 浏览器登录后同源打开 /api/evolution/lab-three-generation-readiness，检查 physicalCallPlan 返回名义六次用满、fullLifecycleProven=false、全局两条孤儿异常仍 blocked；
5. Supabase Lab 的两条历史孤儿 waiting Job 保留，预算/物理调用账本仍零。

**下一步真实调用计划（需单独授权）：** 先在唯一获批的新合成 HTML Mission 上执行有上限、可停机、以事实为依据的极小规模模型烟测，收集实际调用与 Token 证据，评估后再单独决定完整三代 Gate F 是否需要调整上限或拆分治理范围。不能利用反复创建 Mission 绕过每 Mission 预算，也不能降低 Hidden/Final/Gate F 证据门槛来凑六次。

结论：P3-V 完成的是**零付费模型调用的工作量审计能力**，而不是完整三代线上成功证明。