# AI Studio Import Guide · Evolve Studio V3.0

## ZIP 结构

最终 ZIP 是 root-flat，导入后第一层直接看到：

```text
package.json
index.html
vite.config.ts
src/
plugins/
scripts/
docs/
README.md
```

## 启动

```bash
npm install
npm run dev
```

## V3.0 重点验收

进入任一进化项目，流程工作台顶部应只显示 5 个用户步骤：

```text
看懂成果
→ 找出关键差距
→ 生成并比较新版
→ 验证是否真的变好
→ 交付最佳成果
```

每一步顶部应出现：
- 本步输入
- 系统会做
- 本步产出
- 算完成的标准
- 系统实际读取了什么
- 当前最重要的结论
- 用户最终能拿到什么
- 下一步

代码 ZIP 项目在“系统实际读取了什么”里应显示 Repository Index / Critical Modules；PPT/Excel/Document 应显示真实 Slide/Sheet/结构读取结果。

## Parser

默认不需要配置外部解析器：内置 Local Parser 即可使用 ZIP/代码/PPTX/DOCX/XLSX/PDF/Text。Docling / Unstructured / Tika / Custom 仅作为复杂 OCR/版面/特殊格式增强。

## QA

联网环境执行：

```bash
npm run check
npm run build
npm test
npm run test:e2e
```
