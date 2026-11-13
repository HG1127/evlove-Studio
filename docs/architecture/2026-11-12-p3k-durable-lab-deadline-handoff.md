# P3-K · 隔离 Lab 持久化休眠截止与并发取消验收

日期：2026-11-12
开发工作树：D:\Downloads\evlove-studio-evolve-p0
开发分支：codex/artifact-evolution-governance-p0
独立 Lab Supabase：jnlbqgpezenmpksyklme
基线提交：2ce15c2（P3-H/I/J/K 改动仍未提交）

## 一、阶段目标

在 P3-J 已建立的单次合成 Mission 审批、最长 20 分钟许可、持久费用预算及运行中请求 Abort 基础上，补齐 Vercel Workflow 的持久化休眠截止：当 Workflow 需要等待时，无论原计划等待多久，都不能在超过许可截止时间之后继续执行下一轮模型任务。截止或审批撤销后，必须在数据库内完成受控 Job 与预算结算，不得通过新的 Mission 或重试键绕过限额。

## 二、已落地实现

1. apps/backend/src/services/lab-workflow-permit.ts：拆分不可变的许可—Mission—Job 身份核验与可撤销的运行放行/截止校验。截止或撤销授权之后，后台仍可核实原 Job 的身份并进行合法停止；不能以过期许可发起新调用。
2. apps/backend/src/services/lab-workflow-deadline.ts：纯逻辑判定 continue / deadline / disarmed / job-terminal，以服务器时钟计算剩余期限，为 Workflow sleep 提供严格上界。
3. workflows/evolution-mission/steps.ts：新增 inspectLabWorkflowDeadlineStep，当前时间与数据库 Job 读取均在 durable Step 内进行。新增 stopExpiredLabWorkflowStep，严格核对许可与 Job 身份；先执行不可逆预算取消，再对同一代 Job 执行数据库原子取消、重新确认终态；提前执行、凭据失配或取消回执无法确认时失败关闭。若另一个实例已将同一代 Job 结算，允许只读核对，绝不误认新一代 Job。
4. workflows/evolution-mission.ts：初始接管、每次计划前、sleep 前及持久化唤醒后均重新检查许可与截止。仅对 Lab 合成 Mission 将休眠时长裁剪到剩余许可时长；非 Lab 原等待路径不变。截止后停止后续规划与执行。

## 三、测试与技术验证

- P3-K 新增两份测试，共 12 项：覆盖超长等待截止、唤醒后不重新计划、撤销审批、错误 Job 元数据、提前取消拒绝、先预算后 Job 取消、预算失败不能报告已取消、并发取消竞态、不同 generation 不得误认、已完成 Job 不复活及非 Lab 兼容性。
- 最新 P3 专项回归：32 个文件 / 423 项测试全部通过（0 失败）。
- 另外单独运行原有控制 Job、执行中止及 Workflow 取消的 3 个测试文件，47 项兼容性测试全部通过（0 失败）。
- TypeScript 全工程检查通过；ESLint 全量检查及 packages 架构目录检查通过；Vite/Nitro 构建通过。第三方 @vercel/sandbox Source Map 提示仍为非阻断告警。
- 本阶段没有新的 Supabase DDL 或迁移，也没有改动、清理或重建 Lab 中的历史 Mission / Job。

## 四、独立 Lab 的只读状态

- 前期观察到的 Campaign Job workflow-control-386fdd09-0b92-46fe-afbd-bd3830e1e776 当前为 waiting，且没有新许可，不能纳入 P3-K 验收；未对它做取消或删除操作。
- Lab 两张 AI 预算账本表当前均为 0 行，两个加密模型连接角色仍保留。
- 独立 Vercel Lab Preview 最新 READY 部署仍是提交 2ce15c2，不包含 P3-H/I/J/K 的未提交本地代码。
- 未查看、复制或重新索取 MiniMax API Key；未发起真实 MiniMax 模型调用；无生产部署、代码提交、推送、合并。

## 五、未能完成的真实环境验收

1. 时间精度：Vercel 持久化 sleep 会在平台恢复时触发，唤醒可能受到平台队列和重试延迟影响；不能承诺 Job 在截止毫秒精确关闭。PostgreSQL AI 预算 deadline 才是禁止新增物理模型请求的服务端硬限制，截止前已发送的请求仍依赖活跃 Step Abort。
2. 在线状态：这是本地代码与模拟时间测试，不是独立 Lab Preview 跨实例/跨重启的真实持久化唤醒验证。
3. 供应商费用：MiniMax 账户级硬性费用上限、确切模型费率与实际账单尚未获得独立验证；EVOLUTION_LAB_AI_PRICING_POLICY_JSON 必须保持未设置，不能伪造费用额度核验。
4. 独立 Judge：已保存生成/Judge 两份模型角色，不等于真正验证其独立性和评分能力；真实三代合成实验、隐藏样本、Candidate SHA-256 和 Gate F 在线验收均未运行。
5. 并行任务：保留 waiting 的旧实验 Job，不能把以前产生的 AI 用量记录当作本轮安全预算闭环证据。

## 六、下一阶段 P3-L

优先核查并行 Lab 任务归属/状态（未经明确授权不得取消），核实 MiniMax 账户硬上限和两个模型的身份/计价，制定经审核的 Lab 放行策略；取得独立 Preview 部署授权后发布已审查的代码，再验证真实 durable sleep 跨重启/跨实例取消证据。满足供应商和预算门槛后，方可执行严格有界的真实三代合成 HTML Mission，并验证独立 Judge、Gate F、哈希谱系和供应商用量账单。

结论：P3-K 的本地休眠截止与并发治理实现及专项回归通过，真实 Preview 持久化超时和 MiniMax 多代进化仍未在线验收。
