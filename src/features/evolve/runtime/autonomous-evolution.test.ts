import { describe, expect, it } from "vitest";
import { demoProject } from "../data/mock-project";
import type { EvolveProject } from "../schemas";
import { evidenceFingerprint } from "./evidence-binding";
import { autonomousClarificationPlan, autonomousEvolutionState, clarificationNeedsHuman } from "./autonomous-evolution";

function project(patch: Partial<EvolveProject> = {}): EvolveProject {
  return { ...demoProject, ...patch } as EvolveProject;
}

describe("autonomous evolution policy", () => {
  it("auto-adopts a low-risk clarification with an explicit default", () => {
    const p = project({
      inputUnderstanding: {
        status: "ready", intentRestatement: "优化文档", implicitRequirements: [], assumptions: [], acceptanceFocus: [], confidence: 0.82,
        clarifications: [{ question: "标题层级是否保持原结构？", whyItMatters: "影响排版一致性", defaultAnswer: "保持原结构" }],
      },
      inputClarifications: [],
    });
    const plan = autonomousClarificationPlan(p);
    expect(plan.auto).toHaveLength(1);
    expect(plan.human).toHaveLength(0);
  });

  it("requires a human for high-impact or irreversible decisions", () => {
    expect(clarificationNeedsHuman({ question: "是否直接上线生产？", whyItMatters: "会影响真实用户", defaultAnswer: "直接上线" }, 0.9)).toBe(true);
    expect(clarificationNeedsHuman({ question: "是否保留标题？", whyItMatters: "版式", defaultAnswer: "保留" }, 0.9)).toBe(false);
  });

  it("reports completion only when a real accepted primary output is ready", () => {
    const p = project({
      validationRun: { ...demoProject.validationRun, status: "completed", recommendation: "release", candidateId: "C", evidenceFingerprint: "fp" },
      experimentRun: { ...demoProject.experimentRun, status: "completed", winnerId: "C" },
      candidates: [{ id: "C", name: "C", change: "x", artifactSnapshots: [{ id: "s", sourceArtifactId: demoProject.sourceArtifacts[0]!.id, name: "a.txt", mimeType: "text/plain", content: "ok", contentHash: "h", createdAt: new Date().toISOString() }] }],
      artifactAcceptance: { ...demoProject.artifactAcceptance, status: "passed", hardGatePass: true, candidateId: "C", evidenceFingerprint: "fp" },
      outputArtifacts: [],
    } as unknown as EvolveProject);
    expect(autonomousEvolutionState(p, false)).not.toBe("completed");
  });

  it("does not report an online mission complete until live Release, Lesson and Next Queue all exist", () => {
    const candidate = {
      id:"online-candidate",name:"online",change:"x",patches:[],artifactBuildStatus:"ready" as const,
      artifactSnapshots:[{id:"s-online",sourceArtifactId:demoProject.sourceArtifacts[0]!.id,name:"a.txt",mimeType:"text/plain",content:"ok",contentHash:"h-online",createdAt:new Date().toISOString()}],
    } as unknown as EvolveProject["candidates"][number];
    const base = project({
      targetConnection:{adapter:"http",connectionId:"production",status:"connected",label:"Production"},
      experimentRun:{...demoProject.experimentRun,status:"completed",winnerId:candidate.id},
      candidates:[candidate],
      validationRun:{...demoProject.validationRun,status:"completed",candidateId:candidate.id,recommendation:"release",evaluation:{...demoProject.baselineRun.result!,demoJudged:false}},
      artifactAcceptance:{...demoProject.artifactAcceptance,status:"passed",hardGatePass:true,candidateId:candidate.id},
      outputArtifacts:[{id:"online-output",projectId:demoProject.id,round:1,versionLabel:"S1",candidateId:candidate.id,name:"a.txt",mimeType:"text/plain",kind:"primary",content:"ok",description:"accepted",sourceArtifactIds:[demoProject.sourceArtifacts[0]!.id],isChampion:true,accepted:true,createdAt:new Date().toISOString()} as EvolveProject["outputArtifacts"][number]],
      release:{...demoProject.release,status:"idle",evidenceMode:"none"},
      lessons:[],
      nextQueue:[],
    } as unknown as EvolveProject);
    const binding=evidenceFingerprint(base,candidate);
    base.validationRun.evidenceFingerprint=binding;
    base.artifactAcceptance.evidenceFingerprint=binding;
    expect(autonomousEvolutionState(base,false)).not.toBe("completed");
    base.release={...base.release,status:"promoted",evidenceMode:"live",healthy:true,observationStatus:"healthy"};
    expect(autonomousEvolutionState(base,false)).not.toBe("completed");
    base.lessons=[{id:"lesson-live",title:"经验",summary:"有效",reusable:true,effect:"改善",limit:"线上",trigger:[],method:[],validatedOn:["production"],status:"verified-skill"}];
    base.nextQueue=[{id:"next-live",title:"下一轮",reason:"继续",priority:"P1",source:"lesson",suggestedMetrics:[]}];
    expect(autonomousEvolutionState(base,false)).toBe("completed");
  });
});
