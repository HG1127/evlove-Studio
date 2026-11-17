# P3-X · MiniMax 单次请求用量对账证据包

核查日期：2026-11-17
状态：**待 MiniMax 服务商用量历史或人工核对；本地仍为 unknown**
项目：Evolve Studio · 独立 Lab Preview（非生产）
机密性：仅包含非敏感调用标识和业务审计数据；严禁在外部工单粘贴 Subscription Key、Vault Secret、完整 prompt、HTTP Authorization 或内部数据库凭据

## 1. 唯一物理请求的事实清单

| 字段 | 真实记录 |
| --- | --- |
| 本地 Mission | `lab-synthetic-html-task-filter-p3x-v1` |
| 本地 Control Job | `workflow-control-fadfbcce-a272-4ea5-9068-4332699e4eaf` |
| 本地 Durable Workflow Run | `wrun_01M7M5V8CWNJGFWG6MQDNV36V6` |
| 本地 Call UUID | `73ceaeb6-57d7-44a5-861b-246998a477a3` |
| 模型 / 角色 | `MiniMax-M3` / Generation（`understand` 阶段），独立 Judge **未调用** |
| OpenAI 兼容调用 | `POST https://api.minimaxi.com/v1/chat/completions` |
| 服务端开始记录 | **2026-11-17 07:17:18.331 UTC**（新加坡 15:17:18） |
| 服务端结束记录 | **2026-11-17 07:18:47.225 UTC**（新加坡 15:18:47） |
| 服务端测量耗时 | `88,701.9537 ms`（约 88.7 秒） |
| 请求结果 | `transport-error`，`provider-timeout` |
| 实际 Provider 响应 ID | **未取得（NULL）** |
| Provider usage counters | **未取得（`missing-usage`）** |
| Provider 计费结果 | **未知；既不能写 0，也不能写 23,287** |
| 本地响应/调用账本状态 | `unknown`，`measured_tokens=NULL` |
| SHA 路由指纹 | `4d20b3f8d7815a4e6df53d638b3b3f8f707e747d1b1e62f8c52e69430f41b688` |
| 额度快照（请求前） | 5 小时剩余 99%，周剩余 96%，时间 2026-11-17 07:17:18.227 UTC |
| Token 预留上界 | **23,287**；这是保守预留，并非服务商核算用量 |
| 预算整体上限 | 最多 6 次物理调用、300,000 Token、20 分钟 |
| 预算最终状态 | `cancelled`，`calls_used=1`，`held_tokens=23287`，`spent_tokens=0`（本地未确认实际消费） |
| Job 最终状态 | `failed`；Mission Revision 3、Campaign `paused`；Candidate 0 |
| 最终故障日志 | Vercel Workflow 在错误后多次执行**步骤级**重试，最后为 `budget-inactive`；**没有**后续的 MiniMax 物理调用账本 |

**重要：** 上述 UUID 由本项目在服务端生成，仅用于本地关联；由于供应商没有返回响应，尚无证据表明 MiniMax 记录该 UUID 或可以用它直接定位供应商请求。对账时应以模型、API 区域、时间窗口、已认证的账户身份和供应商内部 trace 为主要依据。

## 2. 事实不支持的结论

- 不能从本地 `spent_tokens=0` 推断 MiniMax 没有计费。
- 不能用 `reserved_tokens=23287` 作为真实用量或扣费金额。
- 不能根据共享的 5 小时 / 周剩余额度变化推断**该**请求扣量，尤其额度窗口发生重置或其他应用共享 Key 时。
- 不能用 Workflow 第 4 次步骤尝试推断发送了 4 次模型请求；目前只有 **1** 次可核验的物理 HTTP 预留记录。
- 没有 Provider 账单 / usage receipt 就不能把这笔记录从 `unknown` 标记为 `settled`。

## 3. MiniMax 官方核验入口

MiniMax M Plan 官方页：
https://www.minimax.io/m-plan

官方披露的查看方式：登录套餐用量页面查看 Usage History；`mmx quota`；只读 `GET https://www.minimax.io/v1/token_plan/remains`。其中后两者主要返回当前额度，**不能代替历史单次请求账单**。

服务商账务 / API 使用情况应以**该账号实际控制台**的历史记录或支持人员的后台核验为准。
官方的已公开支持邮箱：`contact@minimax.io`（MiniMax Open Platform Paid Services Agreement 的 Complaints and Contact）。

## 4. 给 MiniMax 支持团队的英文核验邮件（未发送）

Subject: MiniMax M Plan API – please reconcile a timed-out MiniMax-M3 request on 17 Nov 2026 (07:17 UTC)

Hello MiniMax Support,

We are investigating one API request made with our existing M Plan Subscription Key from an isolated test environment. The request did not deliver a usable response before our client timed out, and consequently we could not obtain a response ID or token usage receipt.

Would you please check whether your service accepted, executed, or deducted M Plan quota / Credits for the following call, and provide the provider-side request/trace ID and exact input/output/total usage if available?

- API region and endpoint: POST https://api.minimaxi.com/v1/chat/completions
- Model: MiniMax-M3
- Request start (UTC): 2026-11-17 07:17:18
- Client-side transport error (UTC): 2026-11-17 07:18:47
- Observed duration: approximately 88.7 seconds
- Client-side outcome: provider-timeout, no JSON response, no response ID, no usage counters
- Internal reference only: 73ceaeb6-57d7-44a5-861b-246998a477a3
- Subscription quota snapshot just before request: 5-hour 99% remaining, weekly 96% remaining

Please also advise whether the timeout was associated with model processing, a transport interruption, or another upstream condition; and where we can obtain the authoritative request-level usage record for this account.

We are not sharing the Subscription Key or any private payload by email. We can confirm our account securely through your official support channel if necessary.

Thank you.

## 5. 中文对应说明（未发送）

主题：请核对 2026 年 11 月 17 日 07:17 UTC 一次 MiniMax-M3 超时请求的实际用量

MiniMax 支持团队您好：

我们在隔离实验环境使用现有 M Plan Subscription Key 发起了一次 MiniMax-M3 OpenAI 兼容 Chat Completions 请求。客户端约 88.7 秒后超时，未取得可用 JSON 响应、服务商响应 ID 或 Token 用量回执。

请协助核实：该请求是否被 MiniMax 接收、执行以及扣减 M Plan 额度或 Credits？如有记录，请提供服务商侧请求/Trace ID、输入/输出/总 Token 用量和具体时间。同时请说明是否存在模型处理超时、传输中断或其他上游故障，以及如何查阅该账户权威的单次调用历史记录。

请求端点：https://api.minimaxi.com/v1/chat/completions；
模型：MiniMax-M3；
开始：2026-11-17 07:17:18 UTC；
超时：2026-11-17 07:18:47 UTC；
内部参考 UUID：73ceaeb6-57d7-44a5-861b-246998a477a3（**此值不是 MiniMax 响应 ID**）。

请通过官方安全渠道验证账号，我们不会通过公开邮件传递 Subscription Key、Vault 秘钥或原始任务内容。

## 6. 下一次实际验证的门禁（尚未获批准）

1. 取得供应商实际单次消费/账单记录，或明确记录仍无法核实，**原账本继续保持 `unknown`**。
2. 冻结原 Mission/Call/Job/预算证据；不可恢复或重启已 `cancelled` 的预算，不可通过复制 Mission ID 或新增另一 Mission 绕过额度。
3. 确认新 Lab Preview `b885273c73fa90b24e3d0241f698b921cbc9248f`、独立项目 `prj_BuJhKyI5fhoIVJRO3jEo6BzSIOhs`、Preview `ARMED=false`。
4. 代码层错误重试已通过 P3 回归 767/767，但尚未有第二次真实调用验收；150 秒 Preview 配置只是有界缓解措施。
5. 任何新的模型付费试验，需要另行明确审批**可追溯且不规避旧额度的单独计划**、新的幂等与防重复机制、完整独立 Sandbox/浏览器验证，并在每次请求前重新核查两窗口 >=50% 的实时余额。
6. 不更改生产、主分支、MiniMax Vault Key、历史迁移或旧任务账本。

### 依据说明

本文件第 1 节来自 2026-11-17 实际 Lab 的只读 SQL、Vercel Runtime 记录和已核对的代码接口；第 3 节来自 MiniMax 官方公开文档；第 4、5 节仅是**拟发送的询问稿**，不表示已向服务商提交，也不表示已取得供应商书面确认。
