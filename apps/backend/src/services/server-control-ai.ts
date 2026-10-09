import { runServerAi, serverAiUnavailableMessage, serverAiUnavailableReason, type ServerAiMedia, type ServerAiOperation } from "./ai-gateway";
import { probeServerAiRuntime } from "./server-ai-health";
import {withServerAiConnection} from "./server-ai-connection";

/** Only AI-origin availability failures may become a control-loop capability wait. */
export class ServerControlAiUnavailableError extends Error {
  constructor(readonly reasonCode: string) {
    super(serverAiUnavailableMessage(reasonCode));
    this.name = "ServerControlAiUnavailableError";
  }
}

export async function requireServerControlAi(options: { force?: boolean } = {}): Promise<void> {
  const health = await probeServerAiRuntime(undefined, options);
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
    throw error;
  }
  });
}) as typeof runServerAi;
