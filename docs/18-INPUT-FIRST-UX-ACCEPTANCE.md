# 18 · Input-first UX Acceptance

Evolve Studio 的首要验收标准不是“页面齐不齐”，而是用户能否在不理解 Eval / Trace / Candidate 的情况下，从自己的原始内容直接开始一轮进化。

## 1. 首页首屏

首屏必须直接出现 `Evolution Composer`，而不是先要求填写项目表单。

用户应能看到：
- 大输入框：描述“希望怎么进化”；
- `上传附件`：选择一个或多个当前对象；
- `粘贴内容`：直接粘贴 Prompt / Workflow / Code / Template；
- 拖拽文件；
- 文件角色：进化对象 / 参考材料 / 测试样本；
- AI 自动识别对象类型；
- 部门选择；
- Enter 发送、Shift+Enter 换行。

## 2. 上传后不是“存文件”就结束

点击发送后，必须发生：

```text
Attachment + User Command
↓
Server File Intake
↓
Parse / OpenAI File or Image Input
↓
AI Source Understanding
↓
Evolve Contract Draft
```

AI 至少返回：
- 识别对象；
- 当前状态；
- 用户真实意图；
- 本轮目标；
- 可测指标；
- Protected Items；
- Editable Scope；
- 附件摘要；
- 必要 follow-up questions。

## 3. 连续对话

创建项目前：
- 用户能继续追加附件；
- 用户能继续补充命令；
- 新输入必须和旧 Source 一起被 AI 重新理解。

项目创建后：
- 项目页顶部默认展开“进化输入与命令”；
- 可以随时追加新 Source；
- 可以只下命令，不上传新附件；
- 用户能看到最近的命令和 AI 回复。

## 4. Source 改变必须让旧结论失效

新增或修改进化对象/核心要求时：
- Target Ready → 重新确认；
- Eval Suite → reset；
- Baseline → reset；
- Problem/Diagnosis → reset；
- Candidate/Experiment → reset；
- Validation/Release → reset。

这是防止“进化对象已经换了，但仍使用旧评测与旧候选”的关键机制。

## 5. Attachment 必须进入后续闭环

附件不能只出现在聊天气泡里。Source Artifact 必须进入：
- Target Contract；
- Eval Suite 生成；
- Baseline Artifact Runtime；
- Problem Analysis；
- Diagnosis；
- Candidate Patch；
- Independent Evaluator；
- Lesson / Skill Distillation；
- Next Evolve Queue。

## 6. 实际执行

当项目 `targetConnection.adapter = artifact`：

```text
Source Artifact
+ Evolution Command
+ TestCase
+ Promoted Patches
+ Experimental Candidate Patches
↓
AI Artifact Runtime
↓
Output + Trace
↓
Independent Evaluator
```

真正的 Agent / System 则使用 HTTP Target Adapter，将同样的 Run Contract 发送到外部系统。

## 7. 不能出现的 UX

- 首屏只有“新建项目”表单，没有上传和命令框；
- 上传文件后看不到 AI 理解结果；
- 文件上传后不参与 Eval / Candidate；
- 用户改了对象但旧 Baseline 还显示有效；
- 纸夹按钮无实际动作；
- “开始进化”只是跳到静态卡片；
- AI 回复只能解释，不能驱动安全的下一步动作。
