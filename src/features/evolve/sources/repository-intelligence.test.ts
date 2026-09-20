import { describe, expect, it } from "vitest";
import { buildRepositoryIntelligence, repositoryGoalCoverage, requirementAnchors, retrieveRepositoryEvidence } from "./repository-intelligence";
import type { SourceArtifact } from "../schemas";
import type { CodeFileAnalysis } from "./code-analysis";

const entries = [
  { path:"package.json", family:"structured-data", role:"configuration", content:'{"scripts":{"dev":"vite"}}' },
  { path:"src/main.tsx", family:"code", role:"implementation", content:'import App from "./App"; import "./index.css";' },
  { path:"src/App.tsx", family:"code", role:"implementation", content:'import ProjectStudio from "./features/evolve/components/project-studio"; export default function App(){return <ProjectStudio/>}' },
  { path:"src/features/evolve/components/project-studio.tsx", family:"code", role:"implementation", content:'import { ParsingQualityPanel } from "./parsing-quality-panel"; export function ProjectStudio(){return <ParsingQualityPanel/>}' },
  { path:"src/features/evolve/components/parsing-quality-panel.tsx", family:"code", role:"implementation", content:'export function ParsingQualityPanel(){ return <div>解析 UI UX 状态</div> }' },
  { path:"src/features/evolve/runtime/workflow-engine.ts", family:"code", role:"implementation", content:'export function deriveWorkflow(){ return ["input","diagnosis","evolve","validation","deliver"] }' },
  { path:"src/features/evolve/sources/extract.ts", family:"code", role:"implementation", content:'export function extractZip(){ return "artifact parser input compatibility" }' },
  { path:"e2e/studio.spec.ts", family:"code", role:"test-evidence", content:'test("fake financing fixture",()=>{})' },
];
const analyses: CodeFileAnalysis[] = [
  {path:"src/main.tsx",language:"tsx",imports:["./App","./index.css"],exports:[],functions:[],classes:[],jsxTags:[],routeHints:[],parseOk:true},
  {path:"src/App.tsx",language:"tsx",imports:["./features/evolve/components/project-studio"],exports:["default"],functions:["App"],classes:[],jsxTags:["ProjectStudio"],routeHints:[],parseOk:true},
  {path:"src/features/evolve/components/project-studio.tsx",language:"tsx",imports:["./parsing-quality-panel"],exports:["ProjectStudio"],functions:["ProjectStudio"],classes:[],jsxTags:["ParsingQualityPanel"],routeHints:[],parseOk:true},
  {path:"src/features/evolve/components/parsing-quality-panel.tsx",language:"tsx",imports:[],exports:["ParsingQualityPanel"],functions:["ParsingQualityPanel"],classes:[],jsxTags:["div"],routeHints:[],parseOk:true},
  {path:"src/features/evolve/runtime/workflow-engine.ts",language:"typescript",imports:[],exports:["deriveWorkflow"],functions:["deriveWorkflow"],classes:[],jsxTags:[],routeHints:[],parseOk:true},
  {path:"src/features/evolve/sources/extract.ts",language:"typescript",imports:[],exports:["extractZip"],functions:["extractZip"],classes:[],jsxTags:[],routeHints:[],parseOk:true},
  {path:"e2e/studio.spec.ts",language:"typescript",imports:[],exports:[],functions:[],classes:[],jsxTags:[],routeHints:[],parseOk:true},
];

describe("repository intelligence",()=>{
  it("resolves internal dependencies and identifies critical modules",()=>{
    const intelligence=buildRepositoryIntelligence({entries,codeAnalyses:analyses,totalEntries:entries.length});
    expect(intelligence.resolvedInternalImports).toBeGreaterThanOrEqual(3);
    expect(intelligence.criticalModules.some((item)=>item.path.includes("workflow-engine"))).toBe(true);
    expect(intelligence.criticalModules.some((item)=>item.path.includes("extract.ts"))).toBe(true);
    expect(intelligence.indexedSymbols).toBeGreaterThan(0);
  });
  it("decomposes user evolution goals into requirement anchors",()=>{
    const anchors=requirementAnchors("从成果物输入兼容、流程完整闭环、UIUX 更符合产品审美和操作习惯等角度进化");
    expect(anchors.map((item)=>item.id)).toEqual(expect.arrayContaining(["input-compat","workflow-closure","uiux"]));
  });
  it("retrieves product implementation before test fixtures",()=>{
    const intelligence=buildRepositoryIntelligence({entries,codeAnalyses:analyses,totalEntries:entries.length});
    const result=retrieveRepositoryEvidence({entries,codeAnalyses:analyses,intelligence,query:"成果物输入兼容 artifact parser upload",limit:6});
    expect(result[0]?.path).toContain("extract.ts");
    expect(result.findIndex((item)=>item.path.includes("e2e/studio.spec.ts"))).toBeLessThan(0);
  });
  it("computes user-goal evidence coverage from the repository index",()=>{
    const intelligence=buildRepositoryIntelligence({entries,codeAnalyses:analyses,totalEntries:entries.length});
    const artifact={id:"a",name:"system.zip",role:"target",artifactKind:"codebase",mimeType:"application/zip",size:1,extension:"zip",inputMode:"upload",parseStatus:"ready",structure:entries.map((item)=>item.path),structuredContent:{kind:"package",entries,codeIndex:{files:analyses},repositoryIntelligence:intelligence},warnings:[],createdAt:new Date().toISOString()} as SourceArtifact;
    const result=repositoryGoalCoverage({artifact,command:"成果物输入兼容、流程完整闭环、UIUX 更符合产品审美和操作习惯"});
    expect(result.requirementEvidenceCoverage).toBeGreaterThan(0.5);
    expect(result.anchors.length).toBeGreaterThanOrEqual(3);
  });
});
