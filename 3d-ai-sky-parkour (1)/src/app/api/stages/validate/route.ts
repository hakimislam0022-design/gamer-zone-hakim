import { NextRequest, NextResponse } from "next/server";
import { generateStage } from "@/lib/stage/generator";

export const dynamic = "force-dynamic";

/** GET /api/stages/validate?from=1&to=200  -> regenerates and re-validates stages (max 250 per call). */
export async function GET(req: NextRequest) {
  const from = Math.max(1, Number(req.nextUrl.searchParams.get("from") || 1));
  const to = Math.min(from + 249, Number(req.nextUrl.searchParams.get("to") || from + 49));
  const invalid: { id: number; issues: string[] }[] = [];
  const fps = new Set<string>();
  let dup = 0;
  for (let id = from; id <= to; id++) {
    const s = generateStage(id);
    if (!s.validation.ok) invalid.push({ id, issues: s.validation.issues });
    if (fps.has(s.fingerprint)) dup++;
    fps.add(s.fingerprint);
  }
  return NextResponse.json({ from, to, checked: to - from + 1, invalid, duplicateLayouts: dup });
}
