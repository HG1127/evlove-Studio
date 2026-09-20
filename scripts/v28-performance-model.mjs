import fs from "node:fs";

function oldExperiment({ candidates, cases }) {
  return {
    candidateBuildCalls: candidates,
    executeCalls: candidates * cases,
    judgeCalls: candidates,
    populationJudgeCalls: 0,
    total: candidates + candidates * cases + candidates,
  };
}

function adaptiveExperiment({ candidates, cases, finalists, screeningCases, batchSize, deterministicBuild = true }) {
  const screeningExec = candidates * Math.ceil(screeningCases / batchSize);
  const finalistBuild = deterministicBuild ? 0 : finalists;
  const fullExec = finalists * Math.ceil(cases / batchSize);
  const finalJudge = finalists;
  return {
    candidateBuildCalls: finalistBuild,
    screeningExecuteBatchCalls: screeningExec,
    populationJudgeCalls: 1,
    fullExecuteBatchCalls: fullExec,
    judgeCalls: finalJudge,
    total: finalistBuild + screeningExec + 1 + fullExec + finalJudge,
  };
}

function baselineOld(cases) { return { executeCalls: cases, judgeCalls: 1, total: cases + 1 }; }
function baselineV28(cases, batchSize) { return { executeBatchCalls: Math.ceil(cases / batchSize), judgeCalls: 1, total: Math.ceil(cases / batchSize) + 1 }; }
function validationOld(cases) { return { executeCalls: cases * 2, judgeCalls: 2, releaseJudgeCalls: 1, total: cases * 2 + 3 }; }
function validationV28(cases, batchSize) { return { executeBatchCalls: Math.ceil(cases / batchSize) * 2, judgeCalls: 2, releaseJudgeCalls: 1, total: Math.ceil(cases / batchSize) * 2 + 3 }; }

const input = { candidates: 6, cases: 8, finalists: 3, screeningCases: 3, batchSize: 4 };
const old = oldExperiment(input);
const fast = adaptiveExperiment({ ...input, deterministicBuild: true });
const fastAiBuild = adaptiveExperiment({ ...input, deterministicBuild: false });
const result = {
  kind: "modeled-call-count-not-wall-clock-benchmark",
  assumptions: input,
  candidateExperiment: {
    v27HeavyPath: old,
    v28CodeZipOverlayFastPath: fast,
    v28WhenFinalistsStillNeedAiBuild: fastAiBuild,
    callReductionFastPathPercent: Number(((1 - fast.total / old.total) * 100).toFixed(1)),
    callReductionAiBuildPercent: Number(((1 - fastAiBuild.total / old.total) * 100).toFixed(1)),
  },
  baseline8Cases: {
    v27: baselineOld(8),
    v28: baselineV28(8, 4),
    reductionPercent: Number(((1 - baselineV28(8, 4).total / baselineOld(8).total) * 100).toFixed(1)),
  },
  hiddenValidation8Cases: {
    v27: validationOld(8),
    v28: validationV28(8, 4),
    reductionPercent: Number(((1 - validationV28(8, 4).total / validationOld(8).total) * 100).toFixed(1)),
  },
  note: "This models logical AI/Target call counts from the V2.7 vs V2.8 orchestration shape. Actual wall-clock depends on provider latency, rate limits, local/static evidence cases, cache hits and external runners.",
};
console.log(JSON.stringify(result, null, 2));
fs.writeFileSync(new URL("../docs/release/v2.8-call-count-model.json", import.meta.url), JSON.stringify(result, null, 2));
