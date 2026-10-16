const codes=["SDK_WORLD","SDK_RUN","SDK_PAGES","SDK_STEP","SDK_INPUT","SDK_OUTPUT","SDK_BINDING","SDK_LIMIT","SDK_KEY_READ","SDK_KEY_DEADLINE","SDK_KEY_FORMAT","SDK_KEY_IMPORT","SDK_DECRYPT","SDK_OBSERVATION"] as const;
export type ReviewedObservationCode=typeof codes[number];
/** Safe local stages only. Never preserve provider text, serialized I/O, credentials or a cause. */
export class ReviewedObservationError extends Error{
 readonly code:ReviewedObservationCode;
 constructor(code:ReviewedObservationCode){
  const safe=codes.includes(code)?code:"SDK_OBSERVATION";
  super("无法核验旧 Workflow 私有完成记录；未启动新的评审。["+safe+"]");
  this.name="ReviewedObservationError";this.code=safe;
 }
}
export function reviewedObservationError(error:unknown,fallback:ReviewedObservationCode){
 return new ReviewedObservationError(error instanceof ReviewedObservationError?error.code:fallback);
}
