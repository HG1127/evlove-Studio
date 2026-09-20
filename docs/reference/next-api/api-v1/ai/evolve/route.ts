import { NextResponse } from "next/server";
import { AiRequestSchema } from "@/features/evolve/ai/schemas";
import { getAiProviderStatus, runEvolveAi } from "@/features/evolve/ai/service";

export async function POST(request: Request) {
  try {
    const body = AiRequestSchema.parse(await request.json());
    const result = await runEvolveAi(body.operation, body.payload);
    return NextResponse.json({ ok: true, provider: getAiProviderStatus(), result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown AI error";
    return NextResponse.json({ ok: false, error: { code: "AI_OPERATION_FAILED", message } }, { status: 400 });
  }
}
