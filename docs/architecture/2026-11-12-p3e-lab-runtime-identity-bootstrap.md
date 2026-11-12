# P3-E · 独立实验运行实例启动与身份交接

日期：2026-11-12
唯一实验数据平面：`Evlove-Studio-Evolution-Lab` / `jnlbqgpezenmpksyklme`
正式数据库（只用于比较身份，绝不作为实验运行目标）：`mlvevgdntlswxbyxmlum`

## 一、已完成的运行时安全改造

在独立分支 `codex/artifact-evolution-governance-p0` 中：

- 新增 `apps/backend/src/isolated-lab-runtime.ts` 和11项针对性测试；
- 将隔离配置校验接入 `apps/backend/src/server-env.ts` 的实际数据平面及身份模式选择；
- 将 `apps/backend/src/services/security-policy.ts` 调整为：隔离实验时不允许自动的本地开发管理员身份绕过；非只读权限需要实际活动成员身份；
- 同步强化 `scripts/p3c-isolated-lab-preflight.mjs`，让运行配置与离线预检使用相同的 Supabase 地址、服务端密钥、Bucket、Workspace 和 Vault 配置；
- 所有失败状态只反馈错误码，不输出密钥。

**实际编译后 HTTP 验收：** 将运行 Supabase URL 故意换成正式项目，模型连接 API 返回 HTTP 503；使用合成的正确实验 URL 与合成密钥但不提交有效身份时返回 HTTP 401，证明不能匿名调用。

**注意：** 这些测试使用合成密钥，仅验证拒绝机制，并不证明任何 Supabase 服务端密钥、实验 Vault 或 MiniMax 调用已经完成实际认证。

## 二、实验数据库与管理员身份

- Lab API URL：`https://jnlbqgpezenmpksyklme.supabase.co`
- 专用私有 Artifact Bucket：`evolve-audit-p3c-lab`
- Workspace ID：`lab-evolve-p3c-test`
- 已通过 Lab-only SQL 建立一条非密钥的管理员成员记录：
  - `actor_id=lab-p3e-admin-operator`
  - `role=admin` / `status=active`
  - `workspace_id=lab-evolve-p3c-test`
- 这只是在服务端成员目录中登记授权身份。**没有创建管理员密码、认证会话或签名密钥**；仅有这条数据库记录无法登录。

Lab 中目前仍无 Mission、Job、Artifact、Vault Secret 或存储文件。正式 Evolve Studio 数据库保持运行健康；RiskOS 保持已暂停。

## 三、运行实例非机密配置（可复制到独立测试环境）

以下是公开配置项；需绑定到**新建或明确隔离的测试运行实例**，不要直接覆写现有 `500ipo-evolve-studio` 的 production/preview 共享配置。

```dotenv
NODE_ENV=production
EVOLUTION_EXPERIMENT_MODE=isolated
EVOLUTION_EXPERIMENT_TARGET=preview
EVOLUTION_TEST_SUPABASE_PROJECT_REF=jnlbqgpezenmpksyklme
EVOLUTION_PRODUCTION_SUPABASE_PROJECT_REF=mlvevgdntlswxbyxmlum
EVOLUTION_TEST_SUPABASE_URL=https://jnlbqgpezenmpksyklme.supabase.co
SUPABASE_URL=https://jnlbqgpezenmpksyklme.supabase.co
SUPABASE_ARTIFACT_BUCKET=evolve-audit-p3c-lab
EVOLUTION_TEST_ARTIFACT_BUCKET=evolve-audit-p3c-lab
EVOLUTION_WORKSPACE_ID=lab-evolve-p3c-test
EVOLUTION_VAULT_KEY_ID=lab-p3e-vault-01
EVOLUTION_ALLOW_INSECURE_INTERNAL_AUTH=0
EVOLUTION_ALLOW_PROTECTED_DEPLOYMENT_INTERNAL_AUTH=0
EVOLUTION_EXPERIMENT_MAX_CALLS=6
EVOLUTION_EXPERIMENT_MAX_GENERATIONS=3
EVOLUTION_EXPERIMENT_MAX_OUTPUT_TOKENS=12000
EVOLUTION_EXPERIMENT_MAX_COST_USD=5
```

以下机密只应由受授权的运维人员**直接填写到独立运行实例的密钥管理器**，不要发到聊天、提交源码、写入测试报告或复用正式项目密钥：

- `SUPABASE_SECRET_KEY`：**只针对实验 Supabase 项目**的服务端 Secret Key；公开 publishable key 不能替代；
- `EVOLUTION_IDENTITY_HMAC_SECRET`：全新独立生成，至少32字符；不能复制正式项目 HMAC；
- `EVOLUTION_OPERATOR_ACCESS_KEY`：专用独立管理员凭据，符合应用要求的64位十六进制格式；
- `EVOLUTION_VAULT_MASTER_KEY`：全新独立生成，至少32字符；不能复制正式 Vault Master；
- `EVOLUTION_EVIDENCE_SIGNING_KEY`：实验独立证据签名密钥；
- `SUPABASE_PUBLISHABLE_KEY`（若浏览器页面直接连接 Lab）：必须使用 Lab 项目自己的公开 Key。

**不要**设置正式数据库 Secret、正式 Vault Master、正式 Mission 工作区 ID 或正式发布 Token。

## 四、账号与模型连接

隔离实验运行实例启动后，必须先让 `lab-p3e-admin-operator` 通过应用签名身份进入；普通 `data.read` 以外的权限必须通过成员目录验证。然后使用**一次性统一模型连接界面**将获得授权的 MiniMax 连接保存到 Lab 自己的 Vault；独立 Judge 应单独配置与验证。

**不需要用户在聊天里提供 MiniMax API Key。** 但必须有受授权的实验实例内部操作路径获得供应商凭据。正式 Vault 的现有密钥不能假定可跨项目解密或自动继承。

## 五、实际启动前的剩余门槛

1. 配置独立 Lab 服务端密钥并核验属于 `jnlbqgpezenmpksyklme`；
2. 在独立运行实例中配置 HMAC、管理员操作凭据与 Lab Vault 密钥；
3. 验证 Lab Artifact Bucket 的读、写、删除与 RLS；
4. 分别执行 MiniMax 生成模型、独立 Judge 的低成本连通性测试；
5. 实际实现和验证模型调用次数/输出 Token/总费用的**执行时**限制；环境变量数值本身不是费用保护；
6. 在上述条件满足后，运行最多三代的合成 HTML Mission，并记录 SHA-256、可见失败、隐藏评测和独立 Gate F 结果。

## 六、已验证状态及边界

- P3 专项回归：357/357，通过；
- 原有身份/服务端环境单测：22/22，通过；
- 全工程 TypeScript、ESLint、架构检查：通过；
- Vite/Nitro 构建：通过；
- 编译后的 HTTP 503/401 安全边界：错误数据库绑定返回503；正确合成绑定但无身份返回401；- Lab 管理员目录新建一条非密钥记录，未执行任何实验 Mission 或模型调用；
- 保留独立工作区全部原有 P0–P3 改动，不修改正式项目或生产部署。

## 七、操作注意

2026-11-12 的 Lab 24条 SQL 迁移由 Supabase 工具生成新迁移历史时间戳，尚未映射回仓库原版本文件名。以后使用 `supabase db push` 前须先修复这项历史对齐，避免重复执行迁移。

实验模式要求 `EVOLUTION_EXPERIMENT_MODE=isolated`。如果部署环境漏设这个标记，普通运行配置不会自动使用实验隔离规则。因此只能部署到专门的 Lab 运行实例，不可复用现有生产实例并以某个随意的 Preview 域名冒充隔离环境。
