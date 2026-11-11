import { NextResponse } from "next/server";
import { pollChat, ytConfigured } from "@/lib/server/youtube";

export const dynamic = "force-dynamic";

export async function GET() {
  if (!ytConfigured()) return NextResponse.json({ status: "not-configured", messages: [], intervalMs: 30000, filtered: 0 });
  return NextResponse.json(await pollChat());
}
