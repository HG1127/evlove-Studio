export function localNativeKernelIdentity():{kernelSha256:string;boundaryVersion:"local-browser-process-sandbox-v1"};
export function probeLocalNativeBrowser():Promise<{ready:true;assertions:number;browserVersion:string;kernelSha256:string;runId:string}>;
export interface LocalNativeProgress {runId:string;phase:"launch"|"document"|"assertions";arm?:"original"|"candidate";completedChecks:number;elapsedMs:number}
export type LocalNativeFailureKind="deadline"|"launch"|"observer"|"cleanup"|"protocol";
export class LocalNativeExecutionError extends Error {
 constructor(kind:LocalNativeFailureKind,progress:LocalNativeProgress,cause?:unknown);
 readonly diagnostic:LocalNativeProgress & {schemaVersion:"local-native-execution-failure-v1";kind:LocalNativeFailureKind};
}
export function executeLocalNativeHtml(args:{inputs:{originalSha256:string;subjectSha256:string;expectedCardCount:number;contentSearchQueries:unknown[];browserAssertions?:unknown};subjects:{original:Uint8Array;candidate:Uint8Array};timeoutMs?:number},ports?:{onProgress?:(progress:LocalNativeProgress)=>void}):Promise<{measurement:unknown;browserVersion:string;runId:string;kernelSha256:string}>;
