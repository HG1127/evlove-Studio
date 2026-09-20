import { NextResponse } from "next/server";
import { demoProject } from "@/features/evolve/data/mock-project";
export async function GET(_request: Request, { params }: { params: Promise<{ projectId: string }> }) { const { projectId } = await params; if (projectId !== "demo") return NextResponse.json({ message:"Not found" }, { status:404 }); return NextResponse.json(demoProject); }
