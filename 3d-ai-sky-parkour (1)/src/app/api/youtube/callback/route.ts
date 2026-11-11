import { NextRequest, NextResponse } from "next/server";
import { exchangeCode } from "@/lib/server/youtube";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const host = req.headers.get("x-forwarded-host") || req.headers.get("host") || req.nextUrl.host;
  const proto = req.headers.get("x-forwarded-proto") || req.nextUrl.protocol.replace(":", "");
  const origin = `${proto}://${host}`;
  const q = req.nextUrl.searchParams;
  const fail = (m: string) => NextResponse.redirect(`${origin}/?yt=error&msg=${encodeURIComponent(m)}`);
  if (q.get("error")) return fail(q.get("error") || "access_denied");
  const code = q.get("code");
  const state = q.get("state");
  if (!code || !state || state !== req.cookies.get("yt_state")?.value) return fail("Invalid OAuth state. Please try again.");
  try {
    await exchangeCode(code, origin);
  } catch (e) {
    return fail((e as Error).message);
  }
  const res = NextResponse.redirect(`${origin}/?yt=authorized`);
  res.cookies.delete("yt_state");
  return res;
}
