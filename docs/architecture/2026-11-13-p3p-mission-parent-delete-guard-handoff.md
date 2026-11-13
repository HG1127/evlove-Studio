# P3-P · 孤儿任务证据追溯与 Mission 删除数据库级防护

日期：2026-11-13
工作树：D:\Downloads\evlove-studio-evolve-p0
独立分支：codex/artifact-evolution-governance-p0
基线 HEAD：2ce15c2
Supabase Lab：jnlbqgpezenmpksyklme
Vercel Lab：evlove-studio-evolution-lab

## 一、调查范围与事实

所有数据库读取均为隔离 Lab 的只读查询。本阶段没有重试、恢复、取消、删除旧任务，也没有调用实际 MiniMax 模型。

当前 Lab 的 public.missions 为 0 行，但两个 active/waiting Job 继续引用已不存在的 Mission project-1794471973744：

- Campaign Job：workflow-control-386fdd09-0b92-46fe-afbd-bd3830e1e776，generation 1，attempts 1，status waiting，output_ref wrun_01M77DXFST67C5612KVXFKQMXR，checkpoint_id server-checkpoint-57c689a7-73。历史事件显示已生成两轮，第三轮要求人工确认两项业务边界和审批语义。
- Discovery Job：project-1794471973744:runner-discovery:default，type other，generation 2，attempts 2，status waiting。保存的历史错误提示当时尚未配置 EVOLUTION_TARGET_RUN_URL，不能仅凭该历史错误断言当前服务器仍未配置。

历史 Event 表为该 Mission 保留 JobQueued/Started/Updated、ActionPlanned/Completed、CheckpointCreated、AI usage 及 AttentionRequired。签名 evidence_ledger 中有 18 项连续记录（sequence 1..18），前后链 previous_hash 连续，chain_hash 与 signature 字段存在，单一签名 key ID。**仅通过只读 SQL 校验了链序与签名字段存在性；没有读取 HMAC 密钥或进行加密签名重算，因此不声称签名已经密码学验签通过。**

public.artifacts 中该 Mission 的记录数为 0；evidence_ledger.artifact_refs 中仍有 5 个事件挂接的字符串哈希引用，但它们不是自动恢复原 Mission JSON 的完整证据。未观察到原 Mission 对应的 MissionDeleted / 删除事件，无法追溯具体发起者或实际删除入口，不能归咎特定并行会话。

## 二、已确认的缺口与已采取的措施

旧数据库 delete_mission_if_revision(text,bigint) 只按照 revision CAS 删除 Mission，未阻止仍存在 queued/running/waiting Job，也不会为删除动作生成 MissionDeleted 事件；jobs 表没有强制 parent Mission 存在的 FK。这套语义可能造成孤儿任务，但当前证据不足以确认它就是历史 Mission 消失的直接原因。

P3-O 已完成应用层的孤儿 Job 对账拦截；P3-P 补充一个**尚未发布的前向数据库迁移**：

supabase/migrations/20261113103000_mission_job_parent_and_delete_audit_security_invariants.sql

1. 对新建 Job 或更新 Job 的 mission_id/status 安装 BEFORE trigger：存在有效父 Mission 时获取 FOR KEY SHARE 行锁，防止与删除 Mission 的 FOR UPDATE/DELETE 发生竞态。无父级的普通 parse Job 继续允许；已存在的历史孤儿 Job 可终态化（failed/cancelled/completed），不可重新进入 queued/running/waiting，也不能以把 mission_id 设置为 null 逃避删除保护。
2. 对 Mission 删除安装 BEFORE trigger：检查所有 active Job，未清零则拒绝删除；删除成功必须在同一事务插入 append-only MissionDeleted Event。
3. 新增四参数审计删除 RPC，带由后端 RBAC 签发的 actorId 和 actorRole；当 active Job 存在时返回 blocked_reason=active-jobs 和计数。原两参数 RPC **保留**，供旧 Preview 兼容使用；它仍经过同一数据库删除触发器。旧接口直接删除无活动 Job 的 Mission 时使用明确标识为 unattributed-service-role 的审计 actor，不能冒充已核验的真人。
4. 更新 Event 合约，增加 MissionDeleted；生产运行时将实际管理员/操作员身份绑定到四参数 RPC，接口对活动 Job 冲突返回 HTTP 409，而不是成功删除。
5. 直接数据库事件审计并不等价于 Evidence Ledger HMAC 签名镜像。原有 Evidence Ledger 的完整签名归档仍须后续以经审核的 outbox/服务端镜像方式补齐；不能声称本轮已实现审计签名闭环。

## 三、验证实绩

- 只对隔离 Lab 使用 BEGIN + 新迁移 DDL + 合成数据断言 + ROLLBACK 的单事务测试。SQL 保持回滚，不提交 schema 或测试 Mission/Job/Event。
- 回滚断言通过：新活动 Job 能创建；4 参数删除因活动 Job 被拒绝；旧 2 参数删除无法绕过同一触发器；活动 Job 不能将 mission_id 清空；Job 终态后可以合法删除，且同事务写入带 actor 的 MissionDeleted Event；已无父级的 Job 禁止恢复 waiting，新的无父级 Job 无法创建；新 RPC 服务端角色可调用而 anon/authenticated 不可调用。
- 应用测试：独立 Mission 删除 API + runtime 适配测试 2 文件、43 项全部通过。
- 整套 P3 新回归：41 文件，520/520 通过（0 失败）。
- P3-N 离线迁移校验：应用过的 27 项 Lab 迁移仍以相同 SHA-256 验证；待发布迁移 1 项被明确列为 pending。Node 7/7 测试通过；不会将新的 SQL 误当成已发布。
- TypeScript 全工程（pnpm build 中 tsc -b）PASS；全量 ESLint（0 警告）PASS；packages 架构检查 PASS；Vite / Nitro 构建 PASS；Git diff --check PASS。构建仍有第三方 @vercel/sandbox Source Map 和 Browserslist 数据提示，不阻断构建。
- P3-P 的真实数据库两连接插入/删除并发竞态尚未在线验证；回滚单事务验证证明触发器与兼容性可运行，但不能代替生产级并发压力测试。

最终只读验收（隔离 Lab）：27 项远端 migrations 未变；P3-P 新 trigger=0、新四参数 RPC 不存在、MissionDeleted Event=0；M Plan 预算/调用账本均为 0；两个等待中的孤儿 Job 仍在，两个模型 Vault 角色仍保留。Vercel Lab 最新 READY 仍为 SHA 2ce15c2。本地离线 P3-N 映射副本现包含 27 项已应用 + 1 项 P3-P 待发布，共 28 个 SQL 文件。Git 未提交/暂存/推送、lockfile 未变。以上结果与“仅事务回滚验证”一致，不是线上部署证明。

## 四、必须保持的发布/运维边界

1. 新 Migration **没有提交到 Lab Supabase 正式 schema**，故两个旧孤儿 waiting Job 与旧版本 Preview 仍处在未安装数据库级新防护的环境。不得向用户声称线上已修复。
2. Vercel Lab Preview 当前 READY 代码 SHA 仍为 2ce15c2，未包含 P3-H..P 的代码。新 API/Workflow/删除保护未在线验收。
3. 只有明确批准的独立 Lab 迁移发布与专用 Vercel Preview 部署，才能开始真实线上验证；不能通过 git push 猜测自动部署，因为 vercel.json 在实验分支禁用了 git auto-deployment。
4. 若需要处理两个旧 Job，应先确认所有权、历史回溯/业务价值与恢复策略，不能无依据重建 Mission、覆盖旧 Job 或删除签名 ledger。当前新触发器只防止新错误，不会回填或修复已有错误状态。
5. 新的 P3-P Migration 是额外 1 项待发布；P3-N 27 项远端 registry 版本与本地版本仍全部不同。发布前必须刷新只读快照、复核映射和 dry-run，禁止直接对原目录执行 db push。
6. MiniMax Vault M Plan Subscription Key 坚持复用并保持加密；本阶段不解密、打印或重新索取 Key，没有真实模型调用、3 代实验、独立 Judge/Holdout/Gate F 验收。

## 五、下一阶段 P3-Q

先核实新 Migration 的实际兼容性审查、当前独立 Lab 的权限和只读历史。经明确的 Lab 专用部署审批后，先做数据库版本映射与新前向迁移（保留旧 Job，不影响生产），再将相同 SHA 的 P3-H..P 代码发布到 SSO 保护的独立 Lab Preview。优先用管理员只读 API 检测当前两个 orphan Job 并得到 blocked，再核实 MiniMax Subscription Key 的配额响应和生成/Judge 路由。只有取消/审计/预算/持久超时在线证据齐全且明确授权有界真实实验，才允许执行三代合成 HTML + 独立 Judge + 隐藏 Holdout + Gate F。

**结论：P3-P 证据追溯、前向防护代码、隔离 Lab 回滚式 SQL 断言及应用测试通过；新防护仍未在线生效，真实实验仍未运行。**
