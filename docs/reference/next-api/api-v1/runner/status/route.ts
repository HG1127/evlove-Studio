import { NextResponse } from "next/server";
import { getTargetStatus } from "@/features/evolve/target/registry";
import { getAiProviderStatus } from "@/features/evolve/ai/service";

export async function GET() {
  return NextResponse.json({ ai: getAiProviderStatus(), target: getTargetStatus() });
}
