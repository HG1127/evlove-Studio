# P3-AG · Artifact / Job / Event 历史 Outbox 服务端父身份安全门禁

日期：2026-11-16
基线分支：`codex/artifact-evolution-governance-p0`
原始源码 SHA：`70e05d788db9f9005729c52d66400ab04fbb9d25`
实验范围：Evolve Studio 独立开发工作树；本阶段**无云部署、无真实模型或数据写入**。

## 一、实际风险

P3-AF 已禁止把任意旧浏览器 Project 直接注册为服务端 Mission，但后续独立同步仍可能绕过新建身份门禁：

- `production-sync.ts` 的 `pushLocalJobs` 曾仅按 Job generation / 时间戳比较即可 PUT，可能把缺少真实父 Mission 的旧 Job 上传或覆盖其他 Mission 的同名 Job。
- `pushLocalEvents` 原来直接重放全部本地待发送事件，不检查带 `missionId` 的事件是否与已核验父 Mission 关联，也不检查存在 `jobId` 却没有 `missionId` 的事件。
- `artifact-blob-store.ts` 的旧上传/删除队列只保存 Blob ID。网络恢复时会不加归属校验地调用远端 PUT/DELETE；历史坏文件或旧删除墓碑可能在当前未明确授权的情况下触发操作。

## 二、实现的边界

### Job 与 Event

1. `pushLocalJobs` 只允许**存在非空 missionId、属于当前从服务端读取/成功登记的 Mission、没有待删除状态**的本地 Job 上行；同 ID 的远端 Job 父 Mission 不同时直接保持本地不上传。仍保留旧版 generation、终态、冲突优先级比较；不复活远端已删除 Mission。
2. `pushLocalEvents` 仅重放归属当前已确认、非待删除 Mission 的事件；有 `jobId` 却没有 `missionId` 的无主事件留在本地待审；契约允许的**无 jobId、无 missionId 的全局事件**仍可重放。成功远端 append 后才删除对应本地 pending 标识。
3. 网络恢复和用户已明确注册的离线新任务，在成功取得 Mission 身份回执后继续可以补发关联 Job / Event；历史孤儿记录不可因为后端暂时在线就被重建。

### Artifact（自动重放）

4. 服务端同步只为 `knownRemoteIds` 中且未待删除、未冲突的 Mission 收集 `missionBlobReferences`，再把这些 ID 集合作为唯一授权参数传给 `flushPendingArtifactSync`。过去单独落入浏览器旧上传队列、无法通过父 Mission 引用证明的文件**保留字节和 pending 状态但不自动上传**。
5. 旧删除墓碑需要来自当前 HTTP 模式 `deleteArtifactBlob` 的显式删除操作凭证；没有此凭证的老墓碑保留本地，不自动执行远端 DELETE。纯本地原型删除不产生远程删除凭证。
6. 离线删除后重新上传同一 Artifact ID 会撤销旧删除待办与删除许可；避免随后旧墓碑重放误删新文件。若本次真正删除获远端成功确认，删除待办与许可同步撤销。
7. 对合法已确认 Mission 的已有 Source / Frozen Candidate，原本的源文件恢复、SHA-256 内容地址校验、离线补发等路径保持；缺失字节不会被模型或索引重造。

## 三、测试证据

- 项目本地专项：`artifact-blob-store.test.ts`、`production-artifact-bootstrap.test.ts`、`production-sync-parent-guard.test.ts`、`production-sync.test.ts`、`production-mission-read.test.ts`：**40 / 40 通过**。覆盖旧上传被拦、已绑定源文件恢复、旧删除凭证拦截、本地原型删除防误授权、同 ID 重新上传撤销旧删除、Job/Event 无父拒绝、合法父 Mission 确认后恢复、跨 Mission 的 Job ID 冲突、独立全局审计 Event 等。
- 独立 P3 治理测试：**56 文件，752/752 通过**（本轮代码审计过程中已执行）。
- TypeScript `pnpm exec tsc -b --pretty false`、`pnpm architecture:check`、全项目 `pnpm lint`、`pnpm exec vite build`、`git diff --check`：最终最新源码下全部退出码 **0**。第三方 `@vercel/sandbox` 的 source map 缺失有非阻断告警，Vite/Nitro 构建最终成功。
- 根仓库 Vitest 全量：`pnpm exec vitest run --config vitest.config.ts --shard=N/8 --maxWorkers=2 --reporter=dot`，**516 个文件，4,644 项通过、3 项跳过、0 项失败，8 组退出码均为 0**。各组通过数量：1/8 654；2/8 571+1 跳过；3/8 452+1 跳过；4/8 598；5/8 570；6/8 591；7/8 616+1 跳过；8/8 592。跳过项不计作通过，也不声称它们获得覆盖。

## 四、尚未关闭的风险

本阶段只封堵**自动同步和旧 Outbox 恢复**。用户当前主动选择文件时调用 `putArtifactBlobs` 的即时远端 `put` 仍属于服务端上传/解析前置链路，可能发生在 Mission 注册之前；其实际文件归属、服务端授权和按任务范围的记录需单独在线验证，不能把这次前端门禁称为所有文件写入都经过父 Mission 的完整验收。

此外，对没有父 ID 的旧 Job/Event 以及旧 Artifact Pending/墓碑，系统采取“留痕、不动字节、不上传”的保守处理；并未开发直接转化为新 Mission 的自动修复或清理命令。必须有可核验的用户意图和父子证据后才能开展人工 reconciliation。

Evolve Studio 独立 Supabase Lab 先前已经发现两条历史活动孤儿 Job。本阶段**没有**对其做数据库写入、取消、重建或绕过完整性 Gate。P3-X 合成 Mission 的真实 MiniMax 生成、独立 Judge、云 Sandbox、Hidden/Final、Gate F 均未启动。

## 五、执行约束与交付

- 不变更主分支、生产环境、既有数据库迁移、Vault API Key、两条历史孤儿 Job；无真实模型调用、Lab 数据写入、Git push 或 Preview/Production 部署。
- 本地自动化验证通过后固定独立分支准确提交；下一个版本如需部署 Lab Preview，必须对**精确提交 SHA**重新确认授权。
- 新版 Preview 上的 F01–F07 以及真实闭环需在获授权的 Chrome 已登录状态下分别进行只读验收；本地测试不等于线上验收。
