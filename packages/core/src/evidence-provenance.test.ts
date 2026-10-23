import {describe,expect,it} from "vitest";
import type {EvolveProject} from "@evolution/contracts";
import {resolveEvidenceRefs} from "./evidence-provenance";

function fixture():EvolveProject {
  const actual="# 已验收研究规范\n# 当前 Gate F 已通过\n每项重要结论后附来源标注。";
  return {
    sourceArtifacts:[{
      id:"audit-source",role:"target",artifactKind:"document",extension:"md",
      mimeType:"text/markdown",textContent:actual,textExcerpt:actual,
      summary:"已验收研究规范",structure:[],
    }],
    baselineRun:{runs:[{
      testCaseId:"H-SOURCE",output:"SERVER STATIC ARTIFACT EVIDENCE · Gate F\n"+actual,
      verificationStatus:"verified",trace:[{
        id:"trace-1",stage:"static-evidence",status:"pass",
        summary:"当前冻结文档包含 Gate F 与来源标注",
        detail:"原始文档截图无此条件",
      }],
    }]},
  } as unknown as EvolveProject;
}

describe("machine-checkable evidence provenance",()=>{
  it("never verifies a claim about metadata fields by vaguely matching source/test text",()=>{
    const project=fixture();
    const modelStatements=[
      "baseline.archive[0].reason=Gate F通过并成为Search Champion",
      "baseline.result.criterionScores中SYS-PAIRWISE.score=0且verificationStatus=unverified",
      "previousRounds[0].championChanged=true",
      "roundHistory[0].winnerCandidateId=candidate-002",
      "campaign.currentRound=2",
      "evolutionArchive[0].kind=champion",
      "searchChampion.candidate.id=candidate-002",
    ];
    const refs=resolveEvidenceRefs(project,modelStatements);
    expect(refs).toHaveLength(modelStatements.length);
    expect(refs.every(ref=>ref.kind==="unresolved"&&!ref.verified)).toBe(true);
    expect(refs.every(ref=>!ref.testCaseId&&!ref.artifactId)).toBe(true);
  });
  it("still grounds genuine Source text and named Test/Trace claims to their actual quotes",()=>{
    const project=fixture();
    const refs=resolveEvidenceRefs(project,[
      "每项重要结论后附来源标注。",
      "当前冻结文档包含 Gate F 与来源标注",
    ]);
    expect(refs.map(ref=>ref.verified)).toEqual([true,true]);
    expect(refs.every(ref=>Boolean(ref.contentHash&&ref.excerpt))).toBe(true);
    expect(refs.some(ref=>ref.testCaseId==="H-SOURCE")).toBe(true);
  });
  it("leaves invented claims unresolved, without inventing a matching receipt",()=>{
    const refs=resolveEvidenceRefs(fixture(),[
      "量子加密服务器并行修复了不存在的结算链路",
    ]);
    expect(refs).toMatchObject([{verified:false,kind:"unresolved"}]);
  });
});
