# P3-L · 隔离 Lab 真实验收前置核查与发布阻断

日期：2026-11-12
项目：Evlove-Studio-Evolution-Lab
Supabase Project Ref：jnlbqgpezenmpksyklme
Vercel Project：evlove-studio-evolution-lab
开发工作树：D:\Downloads\evlove-studio-evolve-p0
分支：codex/artifact-evolution-governance-p0
基线 HEAD：2ce15c250c5bccec9f45eb732f4395823159ac1b
本阶段结论：P3-L 只读核查完成；真实 Preview 发布与 MiniMax 三代运行保持阻断。

## 一、Lab 运行状态与旧并行任务

Supabase Lab 项目状态 ACTIVE_HEALTHY，PostgreSQL 17.11，当前有 26 项迁移。P3-H/P3-I 两项预算迁移仍在 Lab 数据库中。

只读核查到一个此前存在的并行 Mission：
- Mission：project-1794471973744，状态 paused。
- Campaign Job：workflow-control-386fdd09-0b92-46fe-afbd-bd3830e1e776，状态 waiting，generation 1，attempts 1，没有 labExperiment permit。
- Discovery Job：project-1794471973744:runner-discovery:default，状态 waiting，generation 2，attempts 2。
- Parse Job：parse-7f2eecd8-d4eb-4635-8a9a-7629399060cb，状态 completed。
- Campaign 的 AttentionRequired 事件明确要求人工确认两个高影响问题，因此它是等待人工的既有工作，不是本轮 P3-L 启动的实验。

该 Campaign 在 2026-11-12 08:28:05 UTC 有一条模型请求开始记录，路由模型为 MiniMax-M3；08:29:10 UTC 的结果记录为 usage.status=complete，报告 8,727 input tokens、5,108 output tokens、responseModel MiniMax-M3。该请求发生时 P3-I 预算账本为空，因此它是历史未纳入 P3-H/I 预算账本的调用证据，不能当成本轮预算闭环或三代实验验收。没有可靠证据识别该任务的发起人或所有者。

两张预算账本当前均为 0 行；旧 Campaign 未携带新许可。**本轮没有取消、修改、重试或删除上述并行任务及其 Mission。**

## 二、Vault 模型连接核查边界

Lab Vault 中仍有两个独立加密角色：
- `server-ai-default-connection-v1`：后端默认模型，version 4，AES-256-GCM，scope `ai:default-connection`。
- `server-ai-judge-connection-v1`：独立验收模型，version 2，AES-256-GCM，scope `ai:judge-connection`。

两条记录位于 workspace `lab-evolve-p3c-test`，由 browser-operator 创建。当前 Supabase Vault 表仅回读了非敏感元数据；**没有读取 ciphertext、IV、auth tag、解密密钥或 API Key**。由于连接明文只在服务端解密，单凭 Vault 元数据无法证明实际 model ID、Base URL、协议、key 类型或生成/Judge 是否真正独立。历史 Mission 的 MiniMax-M3 路由不等同于当前已保存角色的实际模型身份。

## 三、MiniMax 官方公开价格与限额证据

核对 MiniMax 官方公开资料：
1. Token Plan/API 定价页列出 MiniMax-M2.7-highspeed 的标准按量价格为输入 USD 0.60 / 百万 tokens、输出 USD 2.40 / 百万 tokens；页面同时列出 MiniMax-M3 标准价格。公开价格只能作为该模型/计费模式的参考，不能替代当前 Vault 实际模型与账户计划核验。
   官方页面：https://platform.minimax.io/subscribe/token-plan?tab=api-enterprise
2. 官方 M Plan 页面列出 M3.1 Flash 作为订阅模型，并说明可通过 usage 页面、`mmx quota` 或 `/v1/token_plan/remains` 查询订阅额度；Subscription Key 使用 M Plan/credit pack 配额，达到订阅额度后使用剩余 credit pack，而账户余额只会在使用 pay-as-you-go API Key 时扣款。M Plan 配额并不等同于可证明的 USD 5 账户硬支出上限。
   官方页面：https://www.minimax.io/m-plan
3. 官方 Paid Services Agreement 说明按量 API 调用按实际使用从账户余额或资源包扣款；如平台提供余额提醒，可设置提醒阈值；平台可能无法在请求前准确确定任务成本。该条款未提供可验证的、对所有 API Key 生效的账户级硬支出上限证明。
   官方条款：https://platform.minimax.io/protocol/paid-agreement

因此当前不能证明 Vault 中保存的是 M Plan Subscription Key 还是 pay-as-you-go API Key；也没有证据证明该账户可配置并已启用 USD 5 的硬支出上限。不得将“价格表”“余额提醒”“订阅配额”冒充成账户级硬限额。

## 四、Vercel Lab Preview 核查

- Vercel Project：`evlove-studio-evolution-lab`，framework Nitro。
- SSO protection enabled，覆盖所有部署。
- 最新 READY Preview：`dpl_GpNL7E21oXx15bDcG1KgSx4o2cbx`，Git SHA `2ce15c250c5bccec9f45eb732f4395823159ac1b`，branch `codex/artifact-evolution-governance-p0`。
- 此部署早于 P3-H/P3-I/P3-J/P3-K 当前未提交工作树改动；它不包含持久预算、预算调度和 P3-K 持久化 sleep 截止实现。
- Vercel 环境变量清单（仅元数据，decrypt=false）共 28 项。存在旧版通用 `EVOLUTION_EXPERIMENT_*` 变量与 operator credential；缺少 P3-J admission 明确要求的 `EVOLUTION_LAB_EXPERIMENT_ARMED`、`EVOLUTION_LAB_APPROVED_MISSION_ID`、`EVOLUTION_LAB_AI_PRICING_POLICY_JSON`。
- 当前工作树仍 dirty，P3-H/I/J/K 改动没有提交到 Git，也没有推送。不能把旧 SHA 的 READY 部署当作新代码验收证据。

本轮没有提交、推送、创建 Preview、改 Vercel 环境变量或部署。用户的“继续”没有指定本轮要发布的具体部署目标和发布动作，因此保留发布授权门槛；生产项目绝不触碰。

## 五、P3-L 结果

**已完成：** 隔离 Lab 状态、历史并行任务、Vault 安全元数据、官方公开定价/订阅限额规则、Vercel Preview SHA/SSO/环境变量名称核查。

**未完成且不可伪造：**
- 实际保存的生成模型/Judge 模型 ID、Base URL、协议和 key 类型。
- MiniMax 账户级 USD 5 硬支出上限及其已生效的证明。
- P3-H/I/J/K 当前工作树代码在 Vercel Lab Preview 的在线验收。
- 持久化 sleep 跨重启/跨实例运行证据、真实模型调用、三代 Candidate 哈希谱系、独立 Judge、隐藏 holdout 和 Gate F。

**安全结论：** `EVOLUTION_LAB_AI_PRICING_POLICY_JSON` 必须保持缺失；Lab 实验许可也保持未武装。不得启动真实三代 Mission，不得为绕过阻断而使用旧的无预算 waiting Campaign。

## 六、继续 P3-M 前的最小必要事项

1. 由任务所有者确认旧 Mission 是否还需要继续；未经确认不取消、不复用。
2. 在现有受保护管理界面确认两个 Vault 角色的 model ID、Base URL、协议和 API Key 类型，只查看非敏感连接元数据，不导出密钥。
3. 在 MiniMax 账户控制台确认 key 属于 M Plan Subscription Key 还是 pay-as-you-go API Key，以及是否存在真正的硬消费上限；只提供计划/限额信息，不提供 API Key。
4. 对当前独立分支进行最终 review 后，取得**明确的 Lab Preview 部署授权**，再安排新代码部署与在线验证；该授权不包含生产部署。

结论：P3-L 公开资料和隔离环境只读核查已完成，但模型账户限额、真实模型路由身份和新代码在线验收仍被证据/发布权限阻断。
