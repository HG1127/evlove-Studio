# 11 · Target Adapter Contract

Target Adapter 决定“AI 提出的 Candidate Patch 如何真正被执行”。

## Adapter A · Artifact Runtime

适用于用户直接上传 Prompt / Template / Document / Knowledge / 可描述的 Agent/Workflow。

```text
Source Artifact
+ TestCase
+ Promoted Patches
+ Candidate Patches
   ↓
AI operation: execute-artifact
   ↓
TargetRunResult
   ↓
Independent Evaluator
```

注意：如果上传的是无法在模型运行时真实执行的完整系统/代码仓库，Artifact Runtime 只能模拟用户可见行为，并必须在 Trace 中说明局限。上线前应接 HTTP Adapter。

## Adapter B · Mock

内置可执行 Demo Target，用于零外部依赖验收状态机和 UI。

## Adapter C · HTTP Real Target

环境变量：

```env
EVOLVE_TARGET_ADAPTER=http
EVOLVE_TARGET_RUN_URL=https://target.example.com/evolve/run
EVOLVE_TARGET_RELEASE_URL=https://target.example.com/evolve/release
EVOLVE_TARGET_BEARER_TOKEN=...
```

### Run Request

```json
{
  "projectId": "project-123",
  "connectionId": "research-agent-prod",
  "testCase": {
    "id": "normal-01",
    "title": "标准研究任务",
    "input": "...",
    "expected": ["..."],
    "tags": ["normal"],
    "hidden": false
  },
  "variant": {
    "id": "C",
    "patches": [
      {
        "component": "workflow",
        "operation": "add",
        "target": "before:synthesis",
        "artifactId": "artifact-...",
        "content": "EvidenceCheckNode ...",
        "rationale": "..."
      }
    ]
  }
}
```

Baseline 时 `variant = null`。

### Run Response

```json
{
  "testCaseId": "normal-01",
  "output": "目标系统真实输出",
  "latencyMs": 18420,
  "cost": 0.37,
  "trace": [
    { "id": "span-1", "stage": "Research", "summary": "完成检索", "status": "pass" }
  ]
}
```

### Release Actions

- shadow
- canary-5
- canary-20
- canary-50
- promote
- rollback

生产 Gateway 必须具备 authentication、idempotency、audit、rollback target、health/KPI、timeout/retry。
