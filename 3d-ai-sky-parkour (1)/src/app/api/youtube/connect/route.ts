import { NextRequest, NextResponse } from "next/server";
import { connectLiveChat, YtError, ytStatus } from "@/lib/server/youtube";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const b = (await req.json().catch(() => ({}))) as { videoId?: string };
  let videoId = (b.videoId || "").trim();
  const m = videoId.match(/(?:v=|youtu\.be\/|live\/)([\w-]{11})/);
  if (m) videoId = m[1];
  try {
    await connectLiveChat(videoId || undefined);
    return NextResponse.json({ ok: true, status: await ytStatus() });
  } catch (e) {
    const err = e as YtError;
    return NextResponse.json({ ok: false, code: err.code ?? "error", error: err.message }, { status: 200 });
  }
}
