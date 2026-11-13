# P3-Q · 独立 Evolution Lab 发布候选与签名审计验收

日期：2026-11-13
独立工作树：D:\Downloads\evlove-studio-evolve-p0
分支：codex/artifact-evolution-governance-p0
基线：2ce15c250c5bccec9f45eb732f4395823159ac1b
Supabase Lab：jnlbqgpezenmpksyklme
Vercel Lab：prj_BuJhKyI5fhoIVJRO3jEo6BzSIOhs
Vercel Team：team_kK5GqMJNWpI0A7NmY6nnXgIQ

## 一、阶段目标与权限边界

P3-Q 只执行离线发布候选准备、真实环境只读核查和代码/单元测试。现有 MiniMax M Plan Subscription Key 不重新索取、读取或改写。未经单独的 Lab 发布授权，不执行 Git 提交、推送、合并、Supabase migration repair/db push/apply_migration、Vercel Preview 部署、生产环境更改或真实 MiniMax 生成/Judge 调用。

## 二、已核实的隔离 Lab 状态

数据库已应用 27 项迁移，P3-P 的第 28 项 Mission/Job 删除保护 SQL 仍待发布。public.missions 当前 0 行，原 Campaign 与 Discovery 两个 waiting Job 仍因缺失父 Mission 而处于孤儿状态。订阅 Token 预算与调用账本均为 0 条；生成和 Judge 加密 Vault 角色保留 2 个。独立 Vercel Lab 所有部署受 SSO 保护，最新 READY Preview 仍为提交 2ce15c2，不包含 P3-H 至 P3-Q 未提交工作树内容。vercel.json 明确对实验分支关闭 Git 自动部署。

## 三、发布候选源码指纹

新增 scripts/p3q-lab-release-fingerprint.mjs 及对应 Node 测试。此脚本仅通过 Git 只读命令检查分支、提交、受审查文件，结合 P3-N 的 Lab migration snapshot 和 vercel.json，生成单独的本地源码审查指纹。

操作：pnpm lab:release:test 执行工具测试；pnpm lab:release:check 只读检查；pnpm lab:release:write 只写指定 JSON 收据；pnpm lab:release:verify 再读当前源码逐项核对。收据路径为 docs/architecture/2026-11-13-p3q-lab-release-fingerprint.json。

收据仅包含路径、文件字节数及 SHA-256，固定 Vercel Lab Project/Team、Supabase Lab、Preview-only 和 Production 禁止标记，固定分支与 HEAD，明确 27 项已应用/1 项未应用迁移。工具拒绝秘钥文件、异常目录、未知非源码二进制、超大文件、符号链接、混合 Git 暂存区、变动后的源码与部署保护配置。实际部署前仍须将这份未提交工作树的审查指纹升级为经审核的 Git commit SHA 身份，不能仅凭本地收据宣称发布成功。

## 四、MissionDeleted Event 的签名补录

系统现有 Event Evidence reconcile 机制能够在 Mission 被删除后，独立读取其 append-only MissionDeleted Event，先只读报告缺少证据镜像，再在人工授权 repair 的情况下用服务端 Evidence Ledger Signing Key 补录。新增回归验证了合成 Event 可以产生可验证的 HMAC/chain 签名镜像，对 actorId 或 deletedRevision 的篡改会导致验签失败。

测试使用的是合成签名测试 Key，并未读取真实 Vault。当前 SQL 迁移只负责原子写入数据库 Event；它不会自动签名入 Ledger，仍需要 Event Evidence 补录操作与结果核验。不可将可补录等同于已经在线签名完成。

## 五、验收范围与后续门槛

上一阶段 P3-P 完成 41 文件/520 项回归和 7 项 P3-N 离线迁移工具测试。P3-Q 新增源码指纹安全测试与 Event Evidence 补录回归；最终完整测试、TS、ESLint、架构和构建结果以本阶段最新独立执行记录为准。

后续获批次序：重新读取独立 Lab migration registry 与 SHA-256 并审核唯一待发布迁移；取得针对 Lab 的数据库应用授权再安装 P3-P 防护；另取得 Vercel Lab Preview 明确部署授权，提交审查后的源码并固定部署 SHA。发布之后先以 security.admin 对 lab-job-integrity 进行只读验证（预期为 blocked，包含两个旧孤儿 Job），再对 MiniMax M Plan quota API 做受控只读检查，并核对生成/Judge 路由；只有通过持久超时、数据库预算、真实事件签名补录和 Workflow 跨实例证据后，才可申请实际三代进化及独立 Judge、Hidden Holdout、Gate F。

目前两个历史 Job 仍保持原状；Mission 删除原因和所有者未知，不自动重建、终止或清理。真实 Supabase 两连接并发删除/插入压力测试与自动 Evidence Mirror 尚未实现。生产环境和主项目不得被本阶段变更。

结论：P3-Q 完成离线候选源码指纹与签名补录的单元验证；尚未正式发布数据库迁移或新版 Preview，也未运行实际 MiniMax 进化。
