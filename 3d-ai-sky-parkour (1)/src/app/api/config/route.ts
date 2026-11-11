import { NextResponse } from "next/server";
import { llmConfigured } from "@/lib/server/ai";
import { ytConfigured } from "@/lib/server/youtube";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({
    llm: llmConfigured(),
    tts: !!process.env.OPENAI_API_KEY,
    youtubeConfigured: ytConfigured(),
    model: process.env.OPENAI_MODEL || "gpt-4o-mini",
  });
}
