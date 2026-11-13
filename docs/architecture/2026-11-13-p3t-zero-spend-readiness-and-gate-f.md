# P3-T · 三代合成 HTML 进化的零模型调用预检与证据门槛

日期：2026-11-13
项目：Evlove Studio Evolution Lab
工作树：D:\Downloads\evlove-studio-evolve-p0
开发分支：codex/artifact-evolution-governance-p0
验证时最新已发布 Lab Preview：SHA 1308b9f243b2fce1fb21fa4bc7915db24694c13c
隔离 Supabase Lab：jnlbqgpezenmpksyklme
隔离 Vercel Lab Project：prj_BuJhKyI5fhoIVJRO3jEo6BzSIOhs

## 一、阶段范围

P3-T 当前只完成可重复的合成测试、零模型调用只读就绪检查和验收门槛完善。用户本轮只说“继续”，尚未单独批准实际 MiniMax 模型生成/Judge 请求、开通合成 Mission 执行许可或新的 Token 消耗。绝不能据此开启实验，也不能复用任何已经消失的 Mission 或两个历史 waiting Job。

已在此前 P3-S 的受保护 Preview 上通过真实**只读** MiniMax 中国区 M Plan 订阅额度检测：生成模型 MiniMax-M3、独立 Judge MiniMax-M3.1-Flash，当前已保存的 Base URL 均为 https://api.minimaxi.com/v1；当时 5 小时额度剩余 99%，周额度剩余 77%。该快照属于一次历史观察，**不具有授权真实调用或保证未来额度的效力**。未来每次真实物理模型调用仍需重新检查配额，先持久化 Token 预留，执行后结算。

## 二、Lab 当前已核验状态

- Supabase Lab 28 项迁移已应用。
- 现有 Mission 为 0；两个 waiting Job 引用不存在的 project-1794471973744，仍作为受保护的历史记录保留。
- MiniMax 订阅预算账本和物理模型调用账本均为 0。
- MiniMax generation/Judge 两套加密 Vault 角色存在，无需重新索取或写入 Key。
- 独立 Preview 未启用 EVOLUTION_LAB_EXPERIMENT_ARMED；也没有配置 EVOLUTION_LAB_APPROVED_MISSION_ID。只有显式指定的合成 Mission 和有效管理员审批能够放行单个受控运行。
- 生产和主项目没有被本阶段操作。

## 三、P3-T 新增零 Token 预检

新增服务：
- apps/backend/src/services/lab-three-generation-readiness.ts
- apps/backend/server/api/evolution/lab-three-generation-readiness.get.ts

仅针对 isolated Lab，要求 security.admin 权限，采用只读方法检查：

1. 当前服务必须通过独立 Lab 身份/项目/专用凭据约束，非 Lab 不向数据面读取敏感状态。
2. 只读扫描 Job 与 Mission 关联，缺失父 Mission 的活跃 Job、过大的清单或读取失败都判为 blocked/unknown，不得当作已清理。
3. 检查生成与 Judge 保存角色是否存在，模型是否不同以及是否使用经批准的 MiniMax 中国区/国际区官方 HTTPS /v1 路由。不会输出 API Key。
4. 读取环境变量是否已为一个精确 Mission 设定许可、是否设置 armed=true，并确认该 Mission 存在且为可执行 HTML。
5. 报告上限：20 分钟、最多 6 次真实物理调用、最多 300,000 Token、5 小时和周窗口均至少 50% 剩余额度。
6. 预检**不向 MiniMax 发出任何 HTTP 请求**，不拉取新配额、不创建/取消 Job、不初始化预算、不写入 Evidence；所有返回一律 executionAllowed=false，modelCallsPerformed=false。即使返回 preflight-clear，也不等于管理员已批准真实模型调用。
7. 单项异常失败关闭，不输出数据库异常文本或保存的 Key；只有经审批、独立配额验证且真正的启动路径可再次验证后，才有资格评估真实运行。

## 四、合成测试与 Gate F 证据约束

新增 P3-T 测试：
- lab-three-generation-readiness.test.ts：检查无 Mission、未 armed、孤儿 Job、未知清单、同一模型自评、错误 URL、缺 Judge、非 Lab、模拟读库异常等；用模拟返回值，完全不触达供应商。
- lab-three-generation-readiness-route.test.ts：验证 security.admin 权限、仅 isolated Lab、只读响应和异常信息脱敏。

纳入 P3 全量回归的已有强制证据测试：
- apps/backend/src/services/server-artifact-multigeneration.test.ts：用合成 HTML/ZIP 等真实文件字节模拟多代内容演化、冻结 Blob、SHA-256、不可改写的资产/治理边界，验证相同或伪造版本不能绕过血缘校验。
- packages/harness/src/server-holdout.test.ts：独立隐藏测试及 Candidate/原版比较证据。
- packages/harness/src/independent-final-holdout.test.ts：独立最终盲测与原始方案隔离；缺少该证据禁止 Gate F。
- packages/harness/src/server-artifact-acceptance.test.ts：真实冻结成果 Gate F 不得被单纯高分/未验证替代。
- packages/core/src/search-champion-settlement.test.ts：Search Champion 晋级需要有效最终盲测、原始版本对照和不可篡改工件指纹。

这些证明**离线合成路径的代码约束与测试结果**，而不等于已在新的真实 Vercel 工作流中运行过三代模型或 Gate F。

## 五、下一阶段实际模型实验的前置审批

若用户另行明确批准一次实际三代 HTML 合成 Mission，必须同时限定：

- 唯一合成 Mission ID；新建目标须与历史两个孤儿 Job 完全隔离；
- 仅 Supabase Lab jnlbqgpezenmpksyklme 和 Vercel Lab Preview prj_BuJhKyI5fhoIVJRO3jEo6BzSIOhs；
- Generation 固定 MiniMax-M3，独立 Judge 固定 MiniMax-M3.1-Flash，直接复用原有 Vault M Plan Subscription Key；
- 截止时间 20 分钟、最多 6 次物理模型调用、最多 300,000 Token，单次上限 100,000 Token、输出最多 12,000 Token；
- 5 小时/周订阅剩余额度均至少 50%，每次物理调用前重新校验；
- 保存三代 HTML 的源文件/修复证据/每代 SHA-256、生成模型与 Judge 使用事实、Hidden 和独立 Final Holdout 及 Gate F 完整验收收据；
- 任何身份、模型路由、用量、签名、持久化或预算核验失败，即停止后续调用并保留证据；
- 不得触及生产、主分支、正式基金策略或真实客户资料。

**本阶段结论：零模型调用的 P3-T 预检代码与合成证据验证已建立；实际三代 HTML + Judge/Holdout/Gate F 尚未被批准，也未执行。**
