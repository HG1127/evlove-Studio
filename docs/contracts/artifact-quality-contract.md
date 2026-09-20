# Artifact Quality Contract · V2.4

## Invariant 1 · Project-specific objective
Target Ready 之前必须得到用户目标 + 成果物类型专属 Rubric。Rubric 不允许退化为所有项目统一 Accuracy / Evidence / Risk。

## Invariant 2 · Type-specific quality
不同成果物的“好”由不同标准定义：
- Code：工程可运行 / Contract / Test / Regression
- PPT：页级覆盖 / 叙事 / 导航 / 可编辑性
- Spreadsheet：Sheet / Formula / Data Integrity / Business Usability
- Workflow：Graph / State / Error Path / I-O Contract
- Prompt：Instruction / Output Contract / Robustness
- Document：Structure / Depth / Completeness
- Knowledge：Coverage / Source Fidelity
- Visual/Media：必须有真实 Renderer 才允许同格式交付

## Invariant 3 · Candidate Artifact in the loop
Experiment/Hidden 测试的是完整 Candidate Artifact Snapshot，不是 Patch 描述。

## Invariant 4 · Tested Artifact = Delivered Artifact
最终下载内容必须来自已经通过 Hidden + Artifact Acceptance 的同一 snapshot；不得在成果中心临时重新生成另一份内容。

## Invariant 5 · Same-format delivery
支持高保真的适配器必须回写/重建原格式：PPTX→PPTX、DOCX→DOCX、XLSX→XLSX、ZIP→ZIP。

不具备高保真 Renderer 的格式必须阻止 Artifact Ready。

## Invariant 6 · Structure-aware context
大成果物必须按原生结构检索相关上下文，而不是每一步都把全文压成一个字符串：
- code → relevant files
- PPT → slides
- spreadsheet → sheets/cells/formulas
- DOCX → OOXML parts/runs
- workflow → nodes/edges/states
- text → sections

## Invariant 7 · Hard Gate dominance
任何 Hard Gate FAIL 都不能被其他高分平均掉。

## Invariant 8 · Format preservation is protected by default
除非用户明确要求转换格式，否则输出扩展名/包类型默认等于输入 Target 格式。

## Invariant 9 · Unsupported capabilities must be explicit
系统不能把“能够分析”伪装成“能够高保真生成”。Renderer 缺失必须在 Source Intake、Acceptance 和 Delivery 三处可见。

## Invariant 10 · User flow stays simple
不同成果物底层流程不同，但用户只需要理解 6 个自适应中文阶段；阶段名称本身随成果物变化，例如：
- Code：需求契约 → 工程体检 → 缺陷定位 → 构建候选 → 测试验收 → 工程交付
- PPT：目标与结构 → 逐页体检 → 叙事诊断 → 演示重构 → 页级验收 → 演示交付
