# P3-AC · Evolve Studio 验收整改的基线对照与测试前提修复

日期：2026-11-16

## 1. 对象、判定与隔离

- 原始验收报告：`Evolve_Studio_Lab_Preview_Acceptance_2026-11-16.html`，F01–F07 / E01–E20。
- 之前 UI 代码整改：独立分支 `codex/artifact-evolution-governance-p0` 的 `9ae553408d6ec550752f4bc7924c05a1ba9e6178`。
- 对照基线：该提交的父提交 `cb90e50f4ec3ccb56d344a9886e28b1f120ed832`。
- 本阶段**没有改动运行逻辑、历史 SQL 迁移、迁移记录、数据库、Vault、模型连接、主分支或生产环境**，没有真实 MiniMax、Judge、云 Sandbox 调用，也没有 GitHub push / Vercel 部署。

## 2. 17 项红测试的旧版复现

在独立临时 Git worktree 中以 detached HEAD 精确 checkout `cb90e50`，复用现有安装依赖，运行原先失败的三份测试文件后彻底清理该 worktree。检验结果是 **34 个测试中 17 通过、17 失败**，失败名称和错误类型与 `9ae5534` 一致：

1. `migration-security-invariants.test.ts`：13/13 失败。测试将`supabase/migrations` 中字母序最后一个文件当作生产安全加固汇总文件，但在 2026 年 11 月之后新增了独立前向迁移，最后一个已成为 `20261113103000_mission_job_parent_and_delete_audit_security_invariants.sql`。既有生产安全加固检查点位于 `20261021130000_html_campaign_start_security_invariants.sql`。
2. `candidate-repair.test.ts`：3/3 失败。测试的 AI mock 输出缺少现有契约明确必填的 `reflection`，因此在合法修复路径和非法 sourceId 的检查之前就被 Zod 拒绝。
3. `server-html-candidate-protection.test.ts`：18 项中 1 项失败。AI 修复测试样本也缺少 `reflection.parentCandidateId` 等字段，导致优先出现对 undefined 的访问错误，而不是原本希望验证的 HTML 保留章节保护。

**归因结论：**这 17 项不由 F01–F07 的前端整改引入；证明了“既有测试前提与现有实现不一致”，不表示运行时各项行为已完成真实端到端验收。

## 3. 最小修复：仅修改测试与安全断言

- `apps/backend/src/services/migration-security-invariants.test.ts`：按包含 HTML Campaign 服务端受控启动函数及汇总安全加固标记的准确文件选择**生产汇总安全检查点**，保留其现有全部 RPC、RLS、Evidence Append-only、Storage ACL、Tombstone/Blob Cleanup 断言；其“逐表加固”范围明确为该检查点之前建立的生产表。
- 新增 `apps/backend/src/services/migration-lab-table-security.test.ts`：补充检查汇总检查点之后新增的每张公共 Lab 表都在其创建迁移中启用 RLS、撤销 `PUBLIC/anon/authenticated` 的访问，并静态检查后续迁移不向这些角色授予非预期的权限；仍不将 SQL 文本检查当成在线 PostgreSQL 授权行为证明。
- `src/features/evolve/artifacts/candidate-repair.test.ts`：为模拟修复响应加入满足现有 `CandidateRepairReflectionSchema` 的 parentCandidateId、failureCaseIds、rootCause 等字段，不修改 Domain 校验器与修复执行函数。
- `apps/backend/src/services/server-html-candidate-protection.test.ts`：为已有 AI 修复 stub 补充绑定测试父候选身份的 `reflection`，确保真正执行到保护的 HTML 内容检查；不修改实际修复逻辑或任何文件/证据签名。

## 4. 验证证据

| 范围 | 最终已确认结果 |
|---|---|
| 旧版 `cb90e50` 的同组测试 | **17 失败 / 17 通过**，旧缺陷可复现 |
| 测试前提修复后的四份专项测试 | **35/35 通过**（含新增 Lab 表安全测试） |
| 合并 F01–F07 的 3 份 UI 专项，共七份文件 | **42/42 通过** |
| 独立 P3 治理回归 | **56 文件、752/752 通过** |
| TypeScript `tsc -b` | 退出码 0 |
| `pnpm architecture:check` / 全项目 `pnpm lint` | 退出码 0 |
| `pnpm exec vite build` / `git diff --check` | 退出码 0；构建保留第三方 `@vercel/sandbox` source map 缺失告警 |

**全仓库测试尚未获得最终全绿证明。** 原先未拆分的 `vitest.config.ts` 大范围运行曾在预设时限内中断；本阶段 `--shard=1/2` 和 `--shard=2/2` 两个独立分片各达到 250 秒上限，未输出完整最终成功/失败汇总。对尚未完成的测试不能推断通过，不能利用已通过的 752/42 项替代全部测试覆盖。

## 5. 发布与业务闭环的剩余门槛

1. 新 UI 与测试修复仅在本地独立分支，**不意味着在线 Lab Preview 已包含它们**。新的精确提交须再次单独核对并仅在获准的 Lab Preview 范围发布。
2. 完整仓库大范围测试的执行超时仍需优化 CI/测试分区或单独完成覆盖证明，不得冒称全仓库回归通过。
3. P3-X 单一合成 Mission 的真实生成、独立 Judge、Browser/Sandbox、Hidden/Final、Gate F、文件交付、学习沉淀均未在本阶段执行。此前的真实 MiniMax 调用限制继续有效。
4. Supabase Lab 中历史 2 条未关联父 Mission 的活动 Job 仍须独立治理；本阶段没有删除、恢复、重置或绕过它们。
5. 不更改生产、主分支、Vault、历史 27/28 项迁移，以及未获准的真实发布或数据写入。

## 6. 推荐下一步

对这批测试维护做独立本地版本固定，核对工作树干净和 2067 字节合成 HTML 原始 SHA 未变；之后可在明确授权时将**精确的新源码提交**仅部署到 Vercel Lab Preview，再通过已登录的 Chrome 验证 F01–F07 的实际页面行为。真实闭环必须另行授权并满足全部执行、安全和额度 Gate。
