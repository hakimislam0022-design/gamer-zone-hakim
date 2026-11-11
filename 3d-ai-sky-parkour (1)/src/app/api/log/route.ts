import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { errorLogs } from "@/db/schema";

export const dynamic = "force-dynamic";
let windowStart = 0;
let count = 0;

export async function POST(req: NextRequest) {
  const now = Date.now();
  if (now - windowStart > 60_000) {
    windowStart = now;
    count = 0;
  }
  if (++count > 60) return NextResponse.json({ ok: false, dropped: true });
  const b = (await req.json().catch(() => ({}))) as Record<string, any>;
  await db.insert(errorLogs).values({
    source: String(b.source || "client").slice(0, 60),
    level: String(b.level || "error").slice(0, 15),
    message: String(b.message || "").slice(0, 1000),
    detail: b.detail ? String(b.detail).slice(0, 4000) : null,
    stage: Number.isFinite(Number(b.stage)) ? Number(b.stage) : null,
  });
  return NextResponse.json({ ok: true });
}
