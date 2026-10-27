import { runServerAi, serverAiUnavailableMessage, serverAiUnavailableReason, type ServerAiMedia, type ServerAiOperation } from "./ai-gateway";
import { getPassiveServerAiHealth, probeServerAiRuntime } from "./server-ai-health";
import {withServerAiConnection} from "./server-ai-connection";
import {FatalError} from "workflow";
import {z} from "zod";

const exhaustedControlOutput=z.object({code:z.enum(["AI_OUTPUT_SCHEMA_MISMATCH","AI_OUTPUT_INVALID_JSON","AI_OUTPUT_INCOMPLETE","AI_OUTPUT_MISSING_FINAL"])});

/** Only AI-origin availability failures may become a control-loop capability wait. */
export class ServerControlAiUnavailableError extends Error {
  constructor(readonly reasonCode: string) {
    super(serverAiUnavailableMessage(reasonCode));
    this.name = "ServerControlAiUnavailableError";
  }
}

export async function requireServerControlAi(options: { force?: boolean } = {}): Promise<void> {
  // A business call is already an authoritative live capability check: do not
  // spend an unrelated structured-output model call before EVERY Workflow step.
  // The explicit forced probe remains in recovery/readiness flows only.
  const health = options.force
    ? await probeServerAiRuntime(undefined, options)
    : await getPassiveServerAiHealth();
  if (health.configured && !options.force) return;
  if (health.ready) return;
  if (health.status === "unconfigured") throw new ServerControlAiUnavailableError("not-configured");
  if (health.status === "unavailable" && health.reasonCode) {
    throw new ServerControlAiUnavailableError(health.reasonCode);
  }
  // A malformed response or unknown runtime error still follows ordinary Step retry handling.
  throw new Error("Server AI 健康探测未通过，尚不能确认 Provider 可用。请检查服务端日志后重试。");
}

export const runServerControlAi = (async (
  operation: ServerAiOperation,
  payload: unknown,
  media?: ServerAiMedia,
): Promise<unknown> => {
  return withServerAiConnection(async()=>{
  await requireServerControlAi();
  try {
    return await runServerAi(operation, payload, media);
  } catch (error) {
    const reasonCode = serverAiUnavailableReason(error);
    if (reasonCode) throw new ServerControlAiUnavailableError(reasonCode);
    // runServerAi already spent its one output correction. A new SDK Step
    // attempt must not regenerate that task or reroll an earlier measurement.
    const exhausted=exhaustedControlOutput.safeParse(error);
    if(exhausted.success)throw Object.assign(new FatalError(
      `模型输出未通过契约校验（${operation} / ${exhausted.data.code}）；本次工作流已停止自动重试，保留原断点与既有证据。`,
    ),{code:exhausted.data.code,operation});
    throw error;
  }
  });
}) as typeof runServerAi;
