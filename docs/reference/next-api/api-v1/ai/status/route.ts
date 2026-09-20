import { NextResponse } from "next/server";
import { getAiProviderStatus } from "@/features/evolve/ai/service";

export async function GET() {
  return NextResponse.json(getAiProviderStatus());
}
