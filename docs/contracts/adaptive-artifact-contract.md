# Adaptive Artifact Contract

## ArtifactDescriptor

```ts
{
  family,
  subtype,
  adapterId,
  confidence,
  preservationMode,
  fidelity,
  formatExtension,
  editable,
  capabilities: {
    parse,
    mutate,
    materialize,
    validateStructure,
    execute,
    visual
  },
  evolutionDimensions,
  requiredValidations,
  limitations
}
```

## preservationMode

- `same-package`：在原 OOXML/ZIP package 上回写；
- `same-format-rebuild`：读取结构后重建同格式；
- `same-text-format`：输出相同文本格式/扩展名；
- `external-required`：没有专用 Renderer 时禁止声称同格式成果已完成。

## Acceptance 预算

每个策略定义：
- userGoalBudget
- artifactBudget
- systemBudget

示例：
- Codebase：50 / 40 / 10；
- Workflow：55 / 35 / 10；
- PPT：用户目标为主 + Presentation-specific criteria；
- Prompt：70 / 20 / 10。

Hard Gate 不受平均分掩盖。

## Builder Contract

Candidate Builder 必须返回完整、可验证 Snapshot，而不是 mutation prose。

## Materializer Contract

Materializer 输入必须是 **已经通过 Artifact Acceptance 的同一 Snapshot**。下载阶段禁止再次调用 AI 重写内容。
