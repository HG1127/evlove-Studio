# P3-M · MiniMax M Plan 订阅额度治理与安全加固交接

日期：2026-11-13
开发工作树：D:\Downloads\evlove-studio-evolve-p0
独立分支：codex/artifact-evolution-governance-p0
基线提交：2ce15c250c5bccec9f45eb732f4395823159ac1b
Supabase Lab：jnlbqgpezenmpksyklme
Vercel Lab Project：evlove-studio-evolution-lab

## 一、已确认的业务前提

用户确认 Vault 的 MiniMax Key 类型为 M Plan Subscription Key（订阅额度），明确无需重新索取 Key。该信息用于调整系统计量方向，不能替代实时额度 API 的实际成功回执。本阶段没有在管理工具中读取、打印、复制、重新保存或导出真实密钥。

MiniMax 官方文档：https://www.minimax.io/m-plan
额度查询为 HTTPS GET https://www.minimax.io/v1/token_plan/remains；由服务端使用已保存 Subscription Key 的 Bearer 认证。M Plan 订阅份额、Credit Pack 和按量余额属于不同计量逻辑。本阶段把 Lab Mission 从 USD 微美元策略切换为订阅 Token 预留与用量账本；旧 USD 预算记录和代码保留历史，但不用于新的 M Plan Mission。

## 二、实现与闭环

1. server-ai-minimax-subscription-quota.ts：只接受官方 MiniMax API 区域、有效成功状态、唯一 general 文本资源组；读取 5 小时与周额度剩余百分比，校验活动状态和重置时间，拒绝不可用、过期或格式异常的响应。请求 5 秒超时、拒绝跳转；不返回原始服务端响应或 Bearer。不能把视频等资源组或 0/0 计数当作文本模型额度。
2. server-ai-lab-subscription-budget.ts：在严格隔离的 Lab Postgres 数据平面，以 service_role 调用私有 RPC，分别完成预算登记、每次物理调用预留、实际 Token 结算和取消；无可变重试键，不自动重试非幂等预留。
3. 新增 Supabase Lab 两张 RLS 私有账本表及服务角色 RPC。单 Mission 最多 6 次物理调用，最多 300,000 Tokens；每次预留至多 100,000 Tokens；输出至多 12,000 Tokens，20 分钟截止；5 小时及周剩余均须不低于 50%，报价快照不得超过 30 秒。每次发送前先取得唯一 UUID 预留凭据；同一 Mission 不允许第二个未结算物理请求并行。
4. 供应商真实返回用量按照 max(input+output,total) 结算，不进行 USD 猜测；用量不明保留全部持有额并暂停；超出预留如实记账并阻断后续调用。取消预算不可重启。
5. server-ai-connection.ts：Lab 专用模型解析强制读取现有加密 Vault 的 Generation/Judge 角色，不允许环境变量、显式调试连接或会话快照替代；私密 Key 仅在服务端内存中使用。
6. lab-workflow-admission.ts：仅被明确武装的唯一合成 HTML Mission 可通过 security.admin 审批；生成与 Judge 连接都必须存在、模型不同且不能通过 Preview 别名冒充独立模型；公开路由元数据与服务端 Vault 解析必须吻合；双角色都需通过实时 M Plan 额度校验。
7. server-ai-lab-budget-dispatch.ts + server-ai-usage.ts：每次物理请求必须与对应 Vault Generation/Judge 角色的 API Key、模型、Base URL 与协议一致；物理 HTTP 只允许确切的官方 MiniMax HTTPS /v1/chat/completions 或 /v1/responses 地址，禁止其他 Origin、附加路径和重定向；然后才允许查询配额、预留 Postgres Token 和发送请求。
8. 保留此前 P3-J/K 的 Job 许可、先预算后 Workflow、20 分钟 durable sleep、跨实例终态核验及取消；将工作流所有预算调用切换到独立订阅 Token 账本。
9. 新增受 security.admin 权限保护、仅隔离 Lab 可用的 minimax-subscription-quota GET 后端接口；计划仅输出非敏感模型路由元数据、5 小时/周百分比和状态，不返回 Key。

## 三、验证记录

- 最新 P3 专项回归：34 个测试文件、442 项测试全部通过，失败 0。
- TypeScript 全工程 tsc -b：PASS。
- 全量 ESLint --max-warnings 0：PASS。
- packages 架构规则检查：PASS。
- Vite/Nitro 构建：PASS。第三方 @vercel/sandbox 缺失 Source Map 与旧 Browserslist 提示仍为非阻断告警。
- 专用 Supabase Lab 已应用 subscription quota migration，远端版本号 20261112093700，Lab 迁移总数 27。
- 数据库真实回滚测试通过：预算不可变、额度不足拒绝、过期快照拒绝、唯一物理调用预留、未知用量冻结、实际 Token 结算、超额记录、不可逆取消、仅 service_role RPC、RLS 开启。
- 两路并发数据库测试中，第一条预留成功，第二条返回 unsettled-attempt；本阶段自己创建的合成 Fixture 已删除。最终 Lab 两张订阅账本表为 0 行。
- 只读复核：历史 Mission project-1794471973744 仍 paused，旧 Campaign Job 仍 waiting；两条模型 Vault 角色仍存在，没有更改。
- 最新 Vercel Lab READY Preview ID dpl_GpNL7E21oXx15bDcG1KgSx4o2cbx，SHA 2ce15c2，不包含 P3-H 至 P3-M 这批尚未提交的工作树改动。

## 四、必须保留的限制与发布阻断

1. 用户已声明保存的是 M Plan Key，但未在新 Preview 实际查询真实账户配额，所以并未验证当前账户的 Key 有效性、模型身份、真实百分比与具体服务端返回格式。没有启动真实 MiniMax 生成或 Judge 调用。
2. 本地 Token 上限是单 Mission 的保护，不是供应商账户级硬费用上限。M Plan 共享使用、用户其他应用、订阅窗口、Credit Pack 扣除及实际供应商计量可能导致额外额度消耗，不能用该本地账本承诺整个账户消费封顶。
3. 源文件与 Lab 远端 migration registry 的版本核查证实：27 项同名迁移全部存在，但时间版本号 27/27 均不一致。本地 P3-M 文件版本为 20261112210000，远端登记版本为 20261112093700。直接进行未经核验的 Supabase db push 可能造成历史同步失败或重复迁移。完整对账表和独立 Lab 发布阻断记录见 docs/architecture/2026-11-13-p3n-lab-migration-history-reconciliation.md。
4. 当前代码没有推送、提交、合并或发布；已部署的旧 Preview 不能视作新版验收。真实跨重启 durable Workflow、三代 Candidate 的哈希谱系、独立 Judge、隐藏 holdout、Gate F 都未在线执行。
5. 不应修改旧 Mission，也不应为了跑通而放宽模型审批、实验允许列表、Token 额度门槛或数据库 isolation。

## 五、P3-N 下一阶段执行顺序

先解决数据库迁移历史对齐与当前独立 Lab Preview 发布审查。待用户明确授权只向独立 Lab Preview 部署后，发布已核验源码，用现有 Vault Subscription Key 进行管理员权限的非生成额度 GET 实测；确定实际生成和 Judge 模型元数据、两端额度及隔离规则。通过只读在线验证和预算/超时真实验收后，再在明确授权的有界条件下开展三代合成 HTML 进化、隐藏测试和 Gate F，不触碰生产。

P3-M 结论：本地代码、安全加固、Postgres 实测和测试构建均完成；真实 MiniMax 使用和新版 Vercel Preview 验收仍未完成。
