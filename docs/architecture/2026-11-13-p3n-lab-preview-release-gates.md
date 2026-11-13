# P3-N · 独立 Lab Preview 发布门槛与验收清单

日期：2026-11-13
目标：Evlove-Studio-Evolution-Lab（仅 Lab Preview，禁止生产发布）
Lab Supabase ref：jnlbqgpezenmpksyklme
Lab Vercel 项目 ID：prj_BuJhKyI5fhoIVJRO3jEo6BzSIOhs
Lab Vercel 团队 ID：team_kK5GqMJNWpI0A7NmY6nnXgIQ
现有 Preview：dpl_GpNL7E21oXx15bDcG1KgSx4o2cbx / READY / SHA 2ce15c2
开发工作区：D:\Downloads\evlove-studio-evolve-p0
开发分支：codex/artifact-evolution-governance-p0

## 一、已经验证的安全条件

- [x] 本地 SQL 与 Lab 已登记 SQL：27/27 同名、同顺序、同 SHA-256（按 26 份末尾单 LF 规范化）。
- [x] 远端迁移版本登记与本地版本仍 27/27 不同；没有直接改写远端 migration history 或执行 db push。
- [x] P3-N 无凭据校验脚本已实现：scripts/p3n-lab-migration-preflight.mjs。
- [x] 只读快照：docs/architecture/2026-11-13-p3n-lab-migration-snapshot.json；有效期限最多 48 小时，过期拒绝继续。
- [x] 离线临时 Lab 迁移版本映射副本已测试，未更改正式迁移源码、Supabase 项目链接或数据。
- [x] Lab 订阅 Token 预算表 RLS 已启用；四个订阅预算 RPC 均为安全 search_path 的 SECURITY DEFINER，PUBLIC/anon/authenticated 无执行权限，service_role 可执行。
- [x] 两张 Lab 订阅预算表均为空；两个加密 Vault 模型角色仍然存在，旧 Campaign 和 Discovery Job 均处于 waiting。

## 二、尚未放行的发布条件

- [ ] 明确批准发布的代码提交/构建输入：P3-H 到 P3-P 仍只在独立工作区，HEAD 2ce15c2，不可把 READY 旧 Preview 冒充为新构建。
- [ ] 明确批准的目标：仅独立 Vercel Lab Preview，不得部署到 production 项目、production target、主分支或任何现有正式域名。
- [ ] 代码变更 review、版本化提交和发布流程须被明确批准，不能隐式推送或自动合并。
- [ ] 当前 vercel.json 为 codex/artifact-evolution-governance-p0 分支配置 git.deploymentEnabled=false。推送并不会自动部署 Preview；不可擅自移除该保护。
- [ ] 当前项目本地未提供 Supabase CLI；对照工具是离线校验，**不是** supabase migration list --remote 或 db push --dry-run 的真实替代。
- [ ] P3-P 新增的 `20261113103000_mission_job_parent_and_delete_audit_security_invariants.sql` 是**本地待发布的第 28 项迁移**。已在隔离 Lab `BEGIN...ROLLBACK` 验证触发器和删除 RPC，但未提交到 schema_migrations。必须经独立 Lab 审批后按顺序发布，旧 2 参数接口保留兼容；不可把回滚测试当作已生效。
- [ ] 最终只读核查发现：Lab 当前 missions 表无记录，原 project-1794471973744 已不存在，而两个 waiting Job 仍引用该 Mission。此前曾查到它为 paused；变化的执行者和原因尚不清楚。未经任务所有者确认，禁止自动取消、恢复、重建或将其纳入新实验。
- [ ] P3-O 已在本地完成只读 Lab Job 完整性 API `/api/evolution/lab-job-integrity`，以及自动对账对缺失 Mission 的阻断，但旧 READY Preview 尚未包含这些保护。发布后需管理员权限确认孤儿数和处理归属，再允许任何实验 Mission 真实启动。
- [ ] 发布前用**重新取得的** Lab 远端快照再次校验迁移版本和 SQL SHA-256，确保未有人并行修改 schema/history。
- [ ] Vercel Lab 存在 EVOLUTION_EXPERIMENT_MODE 和 operator credential 变量，但未检查秘密值；需要在隔离 Preview 上再检查实际环境身份。
- [ ] 未设置 EVOLUTION_LAB_EXPERIMENT_ARMED 与 EVOLUTION_LAB_APPROVED_MISSION_ID，真实合成 Mission 默认禁止；单纯管理员只读额度 GET 不需要武装 Mission。
- [ ] 旧 EVOLUTION_LAB_AI_PRICING_POLICY_JSON 是 USD 按量策略，M Plan Token 版不需要。禁止伪造该旧变量来解锁运行。

## 三、下次获批部署后的验收顺序

1. 验证发布目标项目和 Git SHA，确认所有构建与工作区文件完全对应。
2. 用管理员权限查看新 API：/api/evolution/minimax-subscription-quota；仅返回无秘密的 generation/Judge 路由身份、5 小时/周额度窗口百分比及时间。不得在普通 HTTP 日志打印 Key 或供应商原始响应。
3. 模拟缺密钥、额度低于 50%、额度过期、身份不匹配，验证请求在物理模型发送前失败关闭。
4. 对经审批的合成 Job 验证预算登记、并发预留、取消以及 durable sleep 在跨实例/跨重启后的终态和日志；全部结果必须绑定真实 Job ID 和数据库收据。
5. 只有在上述证据、人工审批、实验允许列表均具备后，才能评估是否启动真实有界三代 HTML 实验、独立 Judge、隐藏 Holdout 和 Gate F。

## 四、回退边界

- 这次 P3-N 只新增本地校验工具、快照和文档，不触发远端数据或部署更新，所以无需生产回滚。
- 后续若 Lab Preview 功能异常，保留之前 READY Preview，先撤销 Lab 实验武装/停止新增请求；任何回滚都只能针对获批准的 Lab 项目和部署。
- 严禁通过恢复主分支、清理旧 Mission、改写 Vault/订阅 Key、关闭预算硬约束或在生产数据库修复 Lab 迁移历史来掩盖问题。
- 使用真实模型前，应明确供应商订阅额度可能与其他应用共享；本地单 Mission Token 上限并不是全账户的硬消费保证。

结论：**独立 Lab SQL 版本对账可安全完成离线准备，但仍未获得实际 Preview 发布和真实模型执行的验收。**
