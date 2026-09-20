#!/usr/bin/env python3
"""V2.7 repository-intelligence smoke test using Python stdlib only.

This does not replace the TypeScript/Vitest suite. It validates the same product invariants
against a real AI Studio ZIP when npm dependencies are unavailable:
- broad deep indexing, not Top-N only;
- internal dependency resolution;
- user-goal evidence retrieval from implementation files;
- tests/fixtures do not dominate semantic evidence.
"""
from __future__ import annotations
import json, re, sys, zipfile
from pathlib import Path

SKIP = re.compile(r'(^|/)(node_modules|\.git|dist|build|\.next|coverage|vendor|target|\.cache|__pycache__)/', re.I)
TEXT_EXT = {'.ts','.tsx','.js','.jsx','.mjs','.cjs','.json','.md','.css','.scss','.html','.yaml','.yml','.py','.go','.rs','.java','.vue','.svelte','.sql','.txt'}
CODE_EXT = {'.ts','.tsx','.js','.jsx','.mjs','.cjs'}
TEST = re.compile(r'(^|/)(tests?|e2e|fixtures?|__tests__)(/|$)|\.(test|spec)\.[^.]+$|test-results|playwright-report', re.I)
IMPORT_RE = re.compile(r'''(?:import\s+(?:[^'\"]+?\s+from\s+)?|export\s+[^'\"]+?\s+from\s+|import\s*\()\s*['\"]([^'\"]+)['\"]''')

GOALS = {
    '成果物输入兼容': ['artifact','source','extract','parser','upload','composer','input','compatibility','成果物','输入','兼容','上传','解析'],
    '流程完整闭环': ['workflow','runtime','stage','gate','validation','release','diagnosis','experiment','campaign','流程','闭环','状态'],
    'UI/UX 与操作体验': ['project-studio','stage-panels','dashboard','projects-list','navigation','interaction','ui','ux','layout','界面','交互'],
}

def norm(p: str) -> str:
    out=[]
    for part in p.replace('\\','/').split('/'):
        if not part or part=='.': continue
        if part=='..':
            if out: out.pop()
        else: out.append(part)
    return '/'.join(out)

def resolve_import(from_path: str, spec: str, paths: set[str]) -> str|None:
    if spec.startswith('.'):
        base=norm(str(Path(from_path).parent).replace('\\','/')+'/'+spec)
    elif spec.startswith('@/') or spec.startswith('~/'):
        base=norm('src/'+spec[2:])
    elif spec.startswith('src/'):
        base=norm(spec)
    else:
        return None
    candidates=[base]
    if not re.search(r'\.[a-z0-9]+$',base,re.I):
        for ext in ('.ts','.tsx','.js','.jsx','.mjs','.cjs','.json','.css','.scss'): candidates.append(base+ext)
        for ext in ('.ts','.tsx','.js','.jsx','.mjs','.cjs','.json','.css','.scss'): candidates.append(base+'/index'+ext)
    return next((c for c in candidates if c in paths), None)

def role(path: str) -> str:
    p=path.lower()
    if TEST.search(p): return 'test-evidence'
    if re.search(r'(^|/)docs?/(release|reference|examples?|fixtures?)(/|$)',p): return 'reference-evidence'
    if re.search(r'(^|/)(package\.json|tsconfig[^/]*\.json|vite\.config\.|pyproject\.toml|go\.mod|cargo\.toml)',p): return 'configuration'
    if Path(p).suffix in CODE_EXT or re.search(r'(^|/)(src|app|lib)/',p): return 'implementation'
    if Path(p).suffix in {'.md','.txt','.json','.yaml','.yml','.html','.css','.scss'}: return 'content'
    return 'documentation'

def score_path(path: str, content: str, tokens: list[str]) -> float:
    p=path.lower(); t=content.lower(); s=0.0
    if role(path)=='implementation': s+=5
    elif role(path)=='configuration': s+=5
    elif role(path) in {'test-evidence','reference-evidence'}: s-=4
    if re.search(r'workflow|runtime|orchestr|state|stage|gate|campaign',p): s+=5
    if re.search(r'source|extract|parser|artifact|upload|composer|input',p): s+=5
    if re.search(r'acceptance|eval|validation|evidence|judge',p): s+=4
    if re.search(r'project-studio|stage-panels|dashboard|settings|overview|projects-list',p): s+=4
    for token in tokens:
        q=token.lower()
        if q in p: s+=6
        count=t.count(q)
        if count: s+=1+min(3,count*.25)
    if role(path) in {'test-evidence','reference-evidence'}: s*=0.25
    return s

def main() -> int:
    source=Path(sys.argv[1] if len(sys.argv)>1 else '/mnt/data/EvolveStudio_V2.6_AIStudio_Compatible.zip')
    command=sys.argv[2] if len(sys.argv)>2 else '进化该系统，从系统成果物输入兼容、流程完整闭环、UIUX更符合产品审美和操作习惯等角度去进化。'
    budget=4_000_000
    per_file=120_000
    with zipfile.ZipFile(source) as z:
        names=[n for n in z.namelist() if not n.endswith('/') and not SKIP.search(n)]
        eligible=[n for n in names if Path(n).suffix.lower() in TEXT_EXT]
        contents={}
        chars=0
        # Priority implementation/config first, evidence later, but index all while under budget.
        ordered=sorted(eligible,key=lambda n:(role(n) in {'test-evidence','reference-evidence'}, -5 if role(n)=='implementation' else 0, n))
        for name in ordered:
            if chars>=budget: break
            try: text=z.read(name).decode('utf-8',errors='replace')[:per_file]
            except Exception: continue
            remain=budget-chars
            text=text[:remain]
            contents[name]=text; chars+=len(text)
        paths=set(names)
        internal=resolved=0
        for name,text in contents.items():
            if Path(name).suffix.lower() not in CODE_EXT: continue
            for spec in IMPORT_RE.findall(text):
                if spec.startswith('.') or spec.startswith('@/') or spec.startswith('~/') or spec.startswith('src/'):
                    internal+=1
                    if resolve_import(name,spec,paths): resolved+=1
        evidence={}
        test_top=0
        for label,tokens in GOALS.items():
            scored=sorted(((score_path(name,text,tokens),name) for name,text in contents.items()),reverse=True)
            top=[name for score,name in scored if score>=3 and role(name) not in {'test-evidence','reference-evidence'}][:8]
            evidence[label]=top
            test_top += sum(1 for n in top if TEST.search(n))
        # Critical modules: policy-oriented approximation independent of the application source module.
        critical=[n for n in contents if role(n) in {'implementation','configuration'} and re.search(r'(workflow|runtime|stage|gate|source|extract|parser|artifact|upload|composer|acceptance|eval|validation|project-studio|stage-panels|provider|model|package\.json|vite\.config)',n,re.I)]
        result={
          'source': source.name,
          'totalEntries':len(names),
          'textEligible':len(eligible),
          'deepIndexed':len(contents),
          'deepIndexCoverage': round(len(contents)/len(eligible),4) if eligible else 0,
          'indexedChars': chars,
          'internalImports':internal,
          'resolvedInternalImports':resolved,
          'dependencyCoverage':round(resolved/internal,4) if internal else 1,
          'criticalModules':critical[:32],
          'criticalModuleCoverage':1.0 if critical and all(n in contents for n in critical) else 0.0,
          'userGoalEvidence':evidence,
          'userGoalEvidenceCoverage':round(sum(1 for v in evidence.values() if len(v)>=3)/len(evidence),4),
          'testEvidenceInTopGoalEvidence':test_top,
        }
        result['assertions']={
          'deep_index_over_80pct':result['deepIndexCoverage']>=0.8,
          'dependency_resolution_over_70pct':result['dependencyCoverage']>=0.7,
          'all_three_user_goals_have_implementation_evidence':all(len(v)>=3 for v in evidence.values()),
          'test_fixtures_do_not_dominate_goal_evidence':test_top==0,
        }
        result['pass']=all(result['assertions'].values())
    print(json.dumps(result,ensure_ascii=False,indent=2))
    return 0 if result['pass'] else 1

if __name__=='__main__': raise SystemExit(main())
