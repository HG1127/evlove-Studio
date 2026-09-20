// 客户端统一入口：函数签名与导出保持原样，但不再 fetch("/api/v1/...")——
// 原 Next Route Handler 的等价逻辑已移植到 ./run-local，在浏览器内直接执行。
// 原始路由代码完整保留在 docs/reference/next-api/ 备查。
export {
  CandidateArtifactBuildError,
  runIntake,
  runIntakeFromArtifacts,
  ingestSources,
  runAi,
  runBaseline,
  runExperiment,
  runValidation,
  runRelease,
  retryFailedExperimentCases,
  getRunnerStatus,
} from "./run-local";
