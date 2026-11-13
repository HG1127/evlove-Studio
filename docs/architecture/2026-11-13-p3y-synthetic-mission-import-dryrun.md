# P3-Y · 单一合成 Mission 入库 / 文件保管链无付费预演

日期：2026-11-13
隔离工作树：`D:\\Downloads\\evlove-studio-evolve-p0`
唯一 Mission：`lab-synthetic-html-task-filter-p3x-v1`

## 范围与授权
本阶段仅在本地 Vitest 的 **内存模拟数据层**调用真实 Nitro Mission 注册、Artifact 登记和 Mission CAS 更新路由，并验证自定义测试经通用 HTML Sandbox Runner 的正确路由、原始物理字节保管链读取与未授权执行隔离。没有真实 Supabase 写入、线上 Mission 注册、文件上传、Workflow Start、Vercel Sandbox、MiniMax 生成或 Judge、API Key 读取、数据库迁移、Git push、Preview/Production 部署。

此前 P3-S 授权明确禁止真实 MiniMax 调用；“继续下一阶段”不解除该限制。现有 `approval.request.json` 仍保持 `userApproved=false`、`registeredInLab=false`。

## 正确的导入顺序（待另外明确批准后才可执行）

1. 使用隔离 Lab 身份校验项目、权限、唯一 Mission ID、源文件 SHA-256，检查原 Mission 不存在，历史孤儿 Job 保持只读。
2. `POST /api/evolution/missions` 注册通过 Schema/Rubric/Confirmation 的未启动 Mission；获得真实 revision。
3. `POST /api/evolution/artifacts/register`，以 `missionId`、`kind=source`、`mimeType=text/html` 和经审查的 2067 字节原始 HTML 登记并存储 `p3y-synthetic-task-board-original`，记录真实返回的 SHA/大小。禁止先用 `PUT /artifacts/:id` 上传未归属 Blob 充当已验证源。
4. 回读真实 Blob 和 Metadata，核对 Mission、kind、大小、SHA-256、source ID 与原始 `parentSha256`。
5. 用 Mission Envelope 的当前 revision，通过 `PUT /api/evolution/missions/:id` 仅把 Source `storageRef` 绑定到刚刚注册的真实 Blob ID；CAS 不通过必须停止，不重试覆盖。
   - 已核查 `finalHoldoutContractFingerprint` 的源身份列表不包含 `storageRef`，因此绑定存储 ID 本身不会修改已冻结的 Final Fingerprint。Final 契约与实际字节还须在真实运行前独立回读核验。
6. 重新回读完整 Mission/Artifact/Job 证据，在线独立 Browser / Quota / Budget / Actor / Lab 安全预检必须通过，且需要用户**另外明确授权真实物理模型调用**，才可考虑执行一次 smoke。

注意：本地 dry-run 的 Mock 证明的是这套已编排源代码调用链，不证明 Lab 的 RLS、事件账本、真实 Storage ACL、Vercel Sandbox Chromium、任务跨实例持久化或真实模型进化已通过。

## 验收要求

- 使用 `apps/backend/src/services/lab-synthetic-html-registration-dryrun.test.ts` 验证真实路由的顺序、实际源 HTML 的字节保管、CAS `storageRef` 绑定、通用 Sandbox Runner 路由与其请求的精确物理输入。
- 在不具备 Mission 归属 / `kind=source` / 元数据正确哈希 / 大小 / `storageRef` 时，必须在触发浏览器执行前拒绝，不得凭 JSON 文本冒充真实上传。
- P3-X 的可见测试由通用 HTML Sandbox Runner 承接；专用于旧版 Source Grounded Search 的 Native Executor 不应错误吞并这九项独立题。测试使用内存替身 Sandbox，所有结果必须为 **UNVERIFIED**；禁止宣称真实云端浏览器、Candidate、独立 Judge、Hidden 或 Gate F 已通过。
- 修复前的通用 HTML 路径允许粘贴文本或未核验归属的 Blob 直接进入 Sandbox，现仅在 `EVOLUTION_EXPERIMENT_MODE=isolated` 增加 Mission/Blob/Metadata/Kind/Bytes/parentSha256 的强制验证；生产模式维持原有行为。拒绝未绑定、错误归属、错误类型、大小、散列、父代版本及篡改文件。
- P3-X 的原始源哈希必须仍为 `192abea39d167d9c0f4310fc603905905de5fa44106685fc7d6ea3d2931da8dc`，测试不能修改原文件。

## 仍需处理的真实阻断

- Lab 的 2 条历史孤儿 waiting Job 依旧存在，全局 `lab-job-integrity` 报警仍为 blocked；新 Mission 无关联 Job 只会报告 `reviewable-with-global-alert`，不得等同整体通过，不能暗中删除或跳过。
- 真实 Mission 尚未创建、Source Blob 尚未入库，受保护的 `EVOLUTION_LAB_APPROVED_MISSION_ID` / `EVOLUTION_LAB_EXPERIMENT_ARMED` 未获批准设置。
- 实际云端 Browser/Sandbox 可用性、独立生成/Judge 真实 Token 预算结算以及 P3-Y 一代烟测均未得到在线证明。
- 只有明确的新授权覆盖**单一指定合成 Mission**、源文件注册/上传和**最多 6 次物理模型请求、300,000 Token、20 分钟、每次剩余额度至少 50%**，才能考虑实际执行，遇到孤儿全局阻断、安全证据欠缺或超预算必须停下。

## 本阶段交付

本地、无付费的真实代码路由链路预演和可复核的失效保护测试；不是线上运行结果。需要保留所有旧 migration、孤儿 Job、主分支、生产和 Vault Key。

## 本轮实测记录（2026-11-13）

- 新增的内存路由 + 通用 Sandbox HTML 保管链专项测试 **9/9 PASS**；P3-X 原专项 **9/9 PASS**。
- `pnpm exec tsc -b --pretty false` **PASS**。
- `pnpm exec vitest run --config vitest.p3.config.ts`：**56 files、714/714 tests PASS**（前一阶段 705 + 本阶段 9）。
- `pnpm exec vitest run --config vitest.config.ts apps/backend/src/services/server-html-artifact-execution.test.ts apps/backend/src/services/server-artifact-external.test.ts apps/backend/src/services/server-html-observed-defect.test.ts`：**22/22 PASS**。
- `pnpm architecture:check`、变更文件 ESLint（`--max-warnings 0`）、`pnpm exec vite build`、`git diff --check`：均退出码 **0**。构建仍输出第三方 `@vercel/sandbox` 源映射文件缺失告警，但未造成构建失败。
- 冻结原文件 SHA-256 与 P3-X 原值相同；本轮 Git 仅 **2 modified + 2 untracked**，分支保持 `codex/artifact-evolution-governance-p0`，无 commit/push/deploy。
- **零真实模型调用、零 Lab/生产写入、零云端 Sandbox 调用**。新测试虽然经过真实 API 路由代码，所有存储/授权/云端执行/外部连线均为本地 mock；所有模拟的 Sandbox 结果标为 `UNVERIFIED`。
