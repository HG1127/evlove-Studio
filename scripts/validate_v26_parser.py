#!/usr/bin/env python3
"""V2.6 parser/eval smoke test using only Python stdlib.
It exercises the same policy goals against a real uploaded ZIP without npm dependencies.
"""
from __future__ import annotations
import json, re, sys, zipfile
from pathlib import Path

SKIP = re.compile(r'(^|/)(node_modules|\.git|dist|build|\.next|coverage|vendor|target|\.cache|__pycache__)/', re.I)
TEXT_EXT = {'.ts','.tsx','.js','.jsx','.json','.md','.css','.html','.yaml','.yml','.mjs','.cjs','.py','.go','.rs','.java','.vue','.svelte','.sql','.txt'}
INTERNAL = re.compile(r'(src/|docs/|\.tsx?\b|\.jsx?\b|\.test\.|\.spec\.|typeid\b|semantic-evolution|workflow-engine|artifact-compatibility|tailwind|css\s*token|theme\s*token|index\.css|schema\.ts|local-store|validation-report|vitest|playwright)', re.I)

def score_path(path: str) -> int:
    p=path.lower(); score=0
    if re.search(r'(^|/)(package\.json|readme\.md|tsconfig[^/]*\.json|vite\.config\.[^/]+|pyproject\.toml|go\.mod|cargo\.toml)$',p): score+=8
    if re.search(r'(^|/)(src|app|features|pages|routes)/',p): score+=5
    if re.search(r'(semantic|workflow|artifact|schema|runtime|adapter|router|acceptance|eval|composer|stage|provider|parser|source|input)',p): score+=5
    if re.search(r'(^|/)(tests?|e2e|fixtures?|__tests__)(/|$)|\.(test|spec)\.[^.]+$|test-results|playwright-report',p,re.I): score-=3
    if re.search(r'(^|/)docs?/(release|reference|examples?|fixtures?)(/|$)',p,re.I): score-=2
    if p.endswith('.md'): score+=1
    return score

def command_goals(command: str):
    out=[]
    if re.search(r'(成果物|文件|材料).{0,10}(输入|上传|接入|兼容)|输入.{0,8}(兼容|适配)|多(种|类型).{0,8}(成果|文件)|兼容.{0,8}(成果|文件)',command,re.I):
        out.append({'id':'USER-INPUT-COMPAT','mode':'external-runner','goal':'成果物输入兼容'})
    if re.search(r'(流程|工作流).{0,10}(完整|闭环|清晰|顺畅)|完整.{0,6}(流程|闭环)|闭环',command,re.I):
        out.append({'id':'USER-WORKFLOW-CLOSURE','mode':'external-runner','goal':'流程完整闭环'})
    if re.search(r'(ui\s*/?\s*ux|uiux|界面|产品审美|操作习惯|易用|易上手|交互)',command,re.I):
        out.append({'id':'USER-UIUX','mode':'visual-review','goal':'UI/UX 与操作习惯'})
    return out

def is_codebase_names(names):
    low=[n.lower() for n in names]
    manifest=any(re.search(r'(^|/)(package\.json|pyproject\.toml|go\.mod|cargo\.toml|pom\.xml|build\.gradle|requirements\.txt)$', n) for n in low)
    code=sum(1 for n in low if Path(n).suffix in {'.ts','.tsx','.js','.jsx','.py','.go','.rs','.java','.kt','.swift','.vue','.svelte'})
    src=any(re.search(r'(^|/)(src|app|lib)/', n) for n in low)
    return manifest or (src and code >= 3) or code >= 12

def sanitize(text: str) -> str:
    parts=[x.strip() for x in re.split(r'(?<=[。；;\n])',text) if x.strip()]
    return ' '.join(x for x in parts if not INTERNAL.search(x))

def main():
    zip_path=Path(sys.argv[1])
    command=sys.argv[2] if len(sys.argv)>2 else '进化该系统，从系统成果物输入兼容、流程完整闭环、UIux更符合产品审美和操作习惯等角度去进化。'
    with zipfile.ZipFile(zip_path) as z:
        names=[n for n in z.namelist() if not n.endswith('/')]
        useful=[n for n in names if not SKIP.search(n)]
        text=[n for n in useful if Path(n).suffix.lower() in TEXT_EXT]
        selected=sorted(text,key=lambda n:(-score_path(n),n))[:120]
        signals={
          'package_json': any(n=='package.json' or n.endswith('/package.json') for n in names),
          'src_tree': any(n.startswith('src/') for n in names),
          'tests': any(re.search(r'(^|/)(tests?|e2e)/|\.(test|spec)\.',n,re.I) for n in names),
        }
        required=[
          'src/features/evolve/runtime/semantic-evolution.ts',
          'src/features/evolve/runtime/workflow-engine.ts',
          'src/features/evolve/runtime/artifact-compatibility.ts',
          'src/features/evolve/components/evolution-composer.tsx',
          'src/features/evolve/components/stage-panels.tsx',
          'src/features/evolve/runtime/run-local.ts',
          'src/features/evolve/evaluation/service.ts',
        ]
        required_present={p:p in names for p in required}
    goals=command_goals(command)
    bad='semantic-evolution.ts 新增融资资料/战略包等业务对象分类； workflow-engine.ts 六步状态机无断点； Tailwind token 未完整验证。'
    cleaned=sanitize(bad)
    generic_names=['components/报价.xlsx','components/说明.docx','components/产品图.png','资料/合同.pdf']
    result={
      'zip':str(zip_path),'entries':len(names),'usefulEntries':len(useful),'textEntries':len(text),
      'softwareStructureSignals':signals,
      'semanticObject':'software-system' if sum(signals.values())>=2 else 'unknown',
      'selectedTop20':selected[:20],
      'selectedTop20TestFiles':sum(1 for n in selected[:20] if re.search(r'(^|/)(tests?|e2e)/|\.(test|spec)\.',n,re.I)),
      'requiredCoreFilesPresent':required_present,
      'userGoalAnchors':goals,
      'internalCouplingSanitization':{'input':bad,'output':cleaned,'removedInternalCoupling':not INTERNAL.search(cleaned)},
      'assertions':{
        'recognizes_real_codebase':sum(signals.values())>=2,
        'indexes_core_evolve_files':all(required_present.values()),
        'tests_do_not_dominate_semantic_context':sum(1 for n in selected[:20] if re.search(r'(^|/)(tests?|e2e)/|\.(test|spec)\.',n,re.I)) <= 3,
        'anchors_3_user_goals':len(goals)>=3,
        'input_compat_requires_real_runner':any(g['id']=='USER-INPUT-COMPAT' and g['mode']=='external-runner' for g in goals),
        'workflow_requires_real_runner':any(g['id']=='USER-WORKFLOW-CLOSURE' and g['mode']=='external-runner' for g in goals),
        'uiux_requires_visual_review':any(g['id']=='USER-UIUX' and g['mode']=='visual-review' for g in goals),
        'strips_internal_objectives':not INTERNAL.search(cleaned),
        'generic_components_folder_is_not_codebase':not is_codebase_names(generic_names),
      }
    }
    result['passed']=all(result['assertions'].values())
    print(json.dumps(result,ensure_ascii=False,indent=2))
    return 0 if result['passed'] else 1
if __name__=='__main__': raise SystemExit(main())
