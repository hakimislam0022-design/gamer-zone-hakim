import { NextRequest, NextResponse } from "next/server";
import { cleanText } from "@/lib/server/moderation";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const key = process.env.OPENAI_API_KEY;
  if (!key) return NextResponse.json({ error: "TTS not configured (set OPENAI_API_KEY)" }, { status: 501 });
  const body = (await req.json().catch(() => ({}))) as { text?: string };
  const text = cleanText(body.text ?? "").slice(0, 300);
  if (!text) return NextResponse.json({ error: "empty text" }, { status: 400 });
  const base = (process.env.OPENAI_BASE_URL || "https://api.openai.com/v1").replace(/\/$/, "");
  const model = process.env.OPENAI_TTS_MODEL || "gpt-4o-mini-tts";
  const payload: Record<string, unknown> = { model, voice: process.env.OPENAI_TTS_VOICE || "coral", input: text, response_format: "mp3" };
  if (model.includes("gpt-4o")) payload.instructions = "Speak as a cheerful, playful, energetic cartoon robot kid with a warm friendly tone. Keep the same consistent voice. Speak Bengali or English naturally as written.";
  try {
    const res = await fetch(`${base}/audio/speech`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` }, body: JSON.stringify(payload) });
    if (!res.ok) return NextResponse.json({ error: `TTS upstream error ${res.status}` }, { status: 502 });
    const buf = await res.arrayBuffer();
    return new NextResponse(buf, { headers: { "Content-Type": "audio/mpeg", "Cache-Control": "no-store" } });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
