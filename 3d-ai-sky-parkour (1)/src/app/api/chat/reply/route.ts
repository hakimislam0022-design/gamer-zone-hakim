import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { chatMessages } from "@/db/schema";
import { eq } from "drizzle-orm";
import { moderate, cleanName } from "@/lib/server/moderation";
import { makeReply, injectionReply, ReplyContext } from "@/lib/server/ai";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const b = (await req.json().catch(() => ({}))) as { author?: string; message?: string; channelId?: string; messageId?: string; source?: "youtube" | "local" | "ambient"; context?: ReplyContext };
  const source = b.source ?? "local";
  const ctx: ReplyContext = {
    stage: Number(b.context?.stage) || 1,
    botOn: !!b.context?.botOn,
    falls: Number(b.context?.falls) || 0,
    progress: Number(b.context?.progress) || 0,
    lastEvent: typeof b.context?.lastEvent === "string" ? b.context.lastEvent.slice(0, 40) : undefined,
  };
  const name = cleanName(b.author ?? "friend");
  if (source === "ambient") {
    const r = await makeReply({ author: "audience", message: "", source, ctx });
    return NextResponse.json({ ...r, verdict: "ok" });
  }
  const m = moderate(b.message ?? "");
  if (m.verdict === "empty" || m.verdict === "spam" || m.verdict === "blocked") return NextResponse.json({ reply: null, verdict: m.verdict });
  const lang = /[\u0980-\u09FF]/.test(m.text) ? "bn" : "en";
  let result;
  if (m.verdict === "injection") result = { reply: injectionReply(name, lang), engine: "rules" as const, lang };
  else result = await makeReply({ author: name, message: m.text, channelId: b.channelId, source, ctx });
  if (b.messageId) await db.update(chatMessages).set({ reply: result.reply }).where(eq(chatMessages.id, b.messageId)).catch(() => {});
  return NextResponse.json({ ...result, verdict: m.verdict });
}
