import { NextResponse } from "next/server";
import { ytStatus } from "@/lib/server/youtube";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(await ytStatus());
}
