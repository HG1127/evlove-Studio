import fs from 'node:fs';

const files = {
  workflow: fs.readFileSync('src/features/evolve/runtime/real-evolution-workflow.ts','utf8'),
  progress: fs.readFileSync('src/features/evolve/components/stage-progress.tsx','utf8'),
  guide: fs.readFileSync('src/features/evolve/components/adaptive-stage-guide.tsx','utf8'),
  runtime: fs.readFileSync('src/features/evolve/runtime/use-project-runtime.ts','utf8'),
  panels: fs.readFileSync('src/features/evolve/components/stage-panels.tsx','utf8'),
  service: fs.readFileSync('src/features/evolve/ai/service.ts','utf8'),
};

const checks = [
  ['5 user steps', ['understand','diagnose','evolve','verify','deliver'].every((id)=>files.workflow.includes(`id: "${id}"`))],
  ['5-step progress uses compiler', files.progress.includes('compileUserEvolutionSteps') && files.progress.includes('5 步主流程')],
  ['stage guide shows actual read evidence', files.guide.includes('系统实际读取了什么') && files.guide.includes('humanStageEvidence')],
  ['runtime uses stage-specific retrieval', files.runtime.includes('retrieveTextContext') && files.runtime.includes('readFocus: focus')],
  ['problem node uses focused evidence', files.runtime.includes('从当前成果和真实运行结果中找出最值得改的问题')],
  ['diagnosis uses focused evidence', files.runtime.includes('定位根因，读取相关成果片段、结构、Trace 和依赖')],
  ['candidate node uses focused evidence', files.runtime.includes('生成真实新版，读取可修改区域、保护边界和相关成果结构')],
  ['user-facing Chinese stage titles', files.panels.includes('第 3 步 · 生成并比较新版') && files.panels.includes('第 4 步 · 验证是否真的变好')],
  ['AI engine requires real artifact evidence', files.service.includes('Every evolution step must operate on the supplied real artifact evidence')],
];
const failed = checks.filter(([, ok])=>!ok);
const result = { version:'3.0.0', checks: checks.map(([name,ok])=>({name,pass:Boolean(ok)})), passed: checks.length-failed.length, total: checks.length };
fs.writeFileSync('docs/release/v3.0-real-evolution-smoke.json', JSON.stringify(result,null,2));
console.log(JSON.stringify(result,null,2));
if (failed.length) process.exit(1);
