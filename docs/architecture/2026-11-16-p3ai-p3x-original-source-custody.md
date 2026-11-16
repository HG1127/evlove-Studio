# P3-AI · P3-X 原版 HTML 物理保管链操作入口

日期：2026-11-16
基线：3ebf8cd4e07059debebae940dfe8249535dbebe8
独立分支：codex/artifact-evolution-governance-p0
唯一任务：lab-synthetic-html-task-filter-p3x-v1
唯一原版 Blob：p3y-synthetic-task-board-original
原版 SHA-256：192abea39d167d9c0f4310fc603905905de5fa44106685fc7d6ea3d2931da8dc（2067 字节）

## 输入事实与代码定位

Work 2026-11-16 17:56 的 P3-X 阻断报告指出：任务通过受审计 Mission PUT/CAS 已注册 Revision 1；source.storageRef 为空，独立 Lab Artifact 0；自动材料理解失败；Runner 通用 Target Proxy 探测为 waiting 且缺 EVOLUTION_TARGET_RUN_URL；订阅额度最近一次 5 小时和周均为 99%；模型物理调用、预算、Candidate 和独立 Judge 均为 0。不能把此报告误认为已完成模型进化，也不能把通用 Target Proxy 的失败作为 HTML Sandbox 不可用的直接证据。

现有后端代码 apps/backend/server/api/evolution/artifacts/register.post.ts 有 mission.write 权限和受审计 source 登记；apps/backend/server/api/evolution/missions/[id].put.ts 使用 Mission CAS 和 assertLabSyntheticSourceMutation 在写入前核验原版物理字节保管链。阻断来自已有网页缺少按 Mission 归属登记的显式操作入口（通用 PUT Artifact 不提供归属声明）。

## 实施范围

- 新增 src/features/evolve/runtime/p3x-source-binding.ts：在访问任何写入口前，必须先通过 isolated Lab 专属、security.admin 保护的只读 GET /api/evolution/lab-job-integrity 且得到 status=clear。
- 再通过已登录浏览器的相同源 GET /api/evolution/missions/:id 回读 **现存** Mission Envelope，要求 exact Mission id、Campaign idle、Candidate=0、唯一源文件 ID/sourceName、大小2067、冻结 parentSha256 和对内容重新计算 SHA256 全部吻合。
- 如果 storageRef 已绑定到预先固定 ID，只读核对真实服务器 Blob 字节；如已存在相同 Blob 但未 CAS 绑定，不再次登记；不同字节直接停止，不覆盖。
- 如 Blob 缺失，通过现有 POST /api/evolution/artifacts/register 按 missionId/kind=source 提交冻结原始文本；核验返回 id、Mission、kind、sha256、size，再 GET 回读完整物理字节。
- 通过现有 PUT /api/evolution/missions/:id 以当前 Revision 的完整 Envelope，只修改 Source storageRef，并要求返回 Revision+1；最终重新 GET Mission 和 Blob 双重核验。
- 中间失败（包括网络、权限、405/409/403、哈希、后端回执不一致）不会自动重试，不自动删除 Blob 或创建 Mission/Job。CAS 冲突保留已登记 Blob，下次由用户再次点击时恢复。
- 新增 src/features/evolve/components/p3x-source-binding.tsx，在生产 HTTP 模式且严格唯一 Mission ID 的页面呈现一项明确人工触发按钮；绝不自动调用生成、Judge、Runner 或 arm，成功后提示刷新任务重新回读。
- ProjectStudio 添加一个独立入口，其他 Mission 不展示；无需用户输入/复制密钥、原始 HTML 或后台 URL。
- 不修改既有生产后端路由、Supabase Migration、Vault 连接和权限策略。

## 验证

- src/features/evolve/runtime/p3x-source-binding.test.ts：9 项对合同入口真实请求顺序与响应的隔离测试，包括物理字节、重复登记恢复、未绑定保管链、Lab 完整性、权限拒绝、SHA 不符、CAS 409、回执异常和任务内源文件篡改。
- src/features/evolve/components/p3x-source-binding.test.tsx：3 项，只在唯一 Mission/HTTP 模式手动触发，没有自动执行。
- 相关原有 production-sync / Artifact bootstrap：19 项，合计 31/31 专项 PASS。
- P3 治理 56 文件 752/752 PASS。TypeScript、架构检查、全项目 ESLint、Vite/Nitro 构建、git diff --check 通过。构建第三方 @vercel/sandbox source map 告警非阻断。
- 本阶段修改仅本地源码、测试、文档；**无 GitHub 推送或 Lab Preview 部署的步骤在本文件中被假定为已完成**，必须以后续实际部署回执为准。

## 尚未通过的真实业务阶段

仅在独立 Lab Preview 部署确认为 READY、用户通过此入口完成受审计 Artifact 登记/回读/CAS 后，才能将 sourceStorageRef 标为已绑定。其后仍须独立核对自动材料理解失败的根因、HTML Sandbox 的实际安全执行、最新 Minimax M-Plan 双窗口额度均 >=50%，并通过批准的单一 Mission permit + 持久化预算（最多六次物理请求、300000 Token、20 分钟）。绝不以 Mock/组件测试冒充真正进化验证；不得用新 ID 重置预算，不能改主分支或生产。