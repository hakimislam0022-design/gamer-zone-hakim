import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { playerProgress, stageRecords } from "@/db/schema";
import { eq, sql } from "drizzle-orm";

export const dynamic = "force-dynamic";
const SLOT = "default";

export async function GET() {
  const rows = await db.select().from(playerProgress).where(eq(playerProgress.slot, SLOT)).limit(1);
  const best = await db.select().from(stageRecords).orderBy(sql`${stageRecords.bestTimeMs} asc nulls last`).limit(5);
  const done = await db.select({ n: sql<number>`count(*)::int` }).from(stageRecords).where(sql`${stageRecords.completions} > 0`);
  return NextResponse.json({ progress: rows[0] ?? null, bestRecords: best, completedStages: done[0]?.n ?? 0 });
}

export async function POST(req: NextRequest) {
  const b = (await req.json().catch(() => ({}))) as Record<string, any>;
  if (b.type === "stage") {
    const id = Math.max(1, Math.floor(Number(b.stageId) || 1));
    const time = b.completed && Number.isFinite(Number(b.timeMs)) ? Math.round(Number(b.timeMs)) : null;
    const bot = !!b.bot;
    await db
      .insert(stageRecords)
      .values({
        stageId: id,
        seed: Number(b.seed) || 0,
        fingerprint: String(b.fingerprint || "").slice(0, 32),
        name: String(b.name || `Stage ${id}`).slice(0, 120),
        validated: !!b.validated,
        validationIssues: b.issues ?? null,
        platformCount: Number(b.platformCount) || 0,
        completions: b.completed ? 1 : 0,
        attempts: 1,
        falls: Number(b.falls) || 0,
        bestTimeMs: bot ? null : time,
        botBestTimeMs: bot ? time : null,
      })
      .onConflictDoUpdate({
        target: stageRecords.stageId,
        set: {
          completions: sql`${stageRecords.completions} + ${b.completed ? 1 : 0}`,
          attempts: sql`${stageRecords.attempts} + 1`,
          falls: sql`${stageRecords.falls} + ${Number(b.falls) || 0}`,
          validated: !!b.validated,
          bestTimeMs: !bot && time !== null ? sql`least(coalesce(${stageRecords.bestTimeMs}, ${time}), ${time})` : stageRecords.bestTimeMs,
          botBestTimeMs: bot && time !== null ? sql`least(coalesce(${stageRecords.botBestTimeMs}, ${time}), ${time})` : stageRecords.botBestTimeMs,
          updatedAt: new Date(),
        },
      });
    return NextResponse.json({ ok: true });
  }
  const cur = Math.max(1, Math.floor(Number(b.currentStage) || 1));
  const values = {
    slot: SLOT,
    currentStage: cur,
    highestStage: Math.max(cur, Math.floor(Number(b.highestStage) || cur)),
    totalCompleted: Math.floor(Number(b.totalCompleted) || 0),
    totalFalls: Math.floor(Number(b.totalFalls) || 0),
    totalPlayMs: Math.floor(Number(b.totalPlayMs) || 0),
    checkpoint: b.checkpoint ?? null,
    settings: b.settings ?? null,
    updatedAt: new Date(),
  };
  await db.insert(playerProgress).values(values).onConflictDoUpdate({ target: playerProgress.slot, set: values });
  return NextResponse.json({ ok: true });
}
