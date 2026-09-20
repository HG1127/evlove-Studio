# Parser & Evidence Contract · V2.6

## 目标

V2.6 把“解析到了什么”和“成果真正通过了什么验证”分成两个独立领域。

过去的问题是：解析器只能看到源码、文档、测试与静态文本，却把这些材料直接转成产品质量结论；当真实 E2E/视觉 Runner 不存在时，系统又会把“无法验证”误写成“产品失败”。

V2.6 规定：

```text
Source Artifact
↓
Parser / Structural Index
↓
ParsingProfile
↓
Semantic Evidence
↓
TestCase.executionMode
↓
Target Run
↓
verificationStatus
↓
Acceptance Criterion
```

### 1. ParsingProfile

每个 SourceArtifact 可以带：
- engine / engineLabel
- confidence
- completeness
- structuralCoverage
- totalEntries / indexedEntries / parsedEntries
- codeFiles / documentFiles / officeFiles / imageFiles
- executableEvidence
- visualEvidence
- limitations[]
- recommendations[]

Parser 的能力边界必须显式暴露给 Runtime 和 UI。

### 2. executionMode

TestCase 不再只有 input / expected，而要声明证据怎么获得：

- `artifact-runtime`：当前 Artifact Runtime 可真实运行；
- `static-evidence`：只靠源码/AST/配置/结构证据；
- `external-runner`：必须有真实 E2E / Agent / 浏览器 /系统 Runner；
- `roundtrip`：通过原格式读写 roundtrip 验证；
- `visual-review`：必须有视觉审查/截图/渲染；
- `manual`：必须人工确认。

### 3. verificationStatus

运行结果分为：
- `verified`：拥有与 Criterion 匹配的真实证据；
- `partial`：静态证据支持部分结论，但不能证明完整用户行为；
- `unverified`：当前 Runtime 没有能力获得所需证据；
- `failed`：执行本身失败。

关键规则：

> `unverified ≠ fail`

它会阻止 Release Ready，但不能把成果质量显示成红色失败。

### 4. evidenceScope

测试证据必须说明验证对象：
- `product-behavior`
- `implementation`
- `format`
- `parser`
- `cross-artifact`

用户要求“上传兼容、流程闭环、UI/UX”时，这三类属于产品行为 / 视觉，不应被 `src/*.ts`、typeId、Tailwind token 等内部结构测试替代。

## Code ZIP Evidence Rule

对软件系统 ZIP：

```text
ZIP
↓
Manifest / Source Priority Index
↓
AST / Import / Export / Route / JSX Structure
↓
Static Evidence
```

静态证据可以验证：
- 文件/模块存在；
- Schema/Contract 结构；
- import/export 关系；
- Route/组件结构；
- 部分静态兼容性。

但不能单独证明：
- 上传流程真的能跑通；
- E2E 工作流完整闭环；
- UI 是否符合审美和操作习惯；
- 浏览器交互是否可用。

这些必须映射到 `external-runner` 或 `visual-review`。
