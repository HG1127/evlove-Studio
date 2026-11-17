import {FatalError} from "workflow";

/**
 * Every isolated Lab control step can have externally visible side effects:
 * a MiniMax physical HTTP attempt, durable token reservation or Artifact write.
 * Workflow's default retry must not replay a failed step when usage is unknown.
 *
 * Ordinary non-Lab Campaigns retain their existing retry/wait behavior.
 * The original error is deliberately not reflected in a public message:
 * provider errors and Vault config may contain credentials or user content.
 */
const allowedCode=/^(?:LAB_[A-Z0-9_]{1,78}|SERVER_AI_PROVIDER_TIMEOUT|SERVER_AI_PROVIDER_NETWORK_ERROR|AI_USAGE_START_NOT_RECORDED)$/;

function safeFailureCode(error:unknown){
  let current:unknown=error;
  for(let i=0;i<4&&current&&typeof current==="object";i++){
    const details=current as {code?:unknown;cause?:unknown};
    if(typeof details.code==="string"&&allowedCode.test(details.code)){
      return details.code;
    }
    current=details.cause;
  }
  return "LAB_CONTROL_STEP_FAILED";
}

/** Use inside a "use step" catch so Workflow skips its default 3 retries. */
export function fatalIsolatedLabControlError(error:unknown):FatalError{
  if(error instanceof FatalError)return error;
  const code=safeFailureCode(error);
  return new FatalError(
    `[${code}] 隔离 Lab 执行节点已终止，不会重试本次物理模型请求；请核实调用账本、预算和真实供应商用量后再评估下一次试验。`,
  );
}
