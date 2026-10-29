export function localNativeKernelIdentity():{kernelSha256:string;boundaryVersion:"local-browser-process-sandbox-v1"};
export function probeLocalNativeBrowser():Promise<{ready:true;assertions:number;browserVersion:string;kernelSha256:string;runId:string}>;
export function executeLocalNativeHtml(args:{inputs:{originalSha256:string;subjectSha256:string;expectedCardCount:number;contentSearchQueries:unknown[];browserAssertions?:unknown};subjects:{original:Uint8Array;candidate:Uint8Array};timeoutMs?:number}):Promise<{measurement:unknown;browserVersion:string;runId:string;kernelSha256:string}>;
