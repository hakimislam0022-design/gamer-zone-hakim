import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { authUrl, ytConfigured } from "@/lib/server/youtube";

export const dynamic = "force-dynamic";

function originOf(req: NextRequest) {
  const host = req.headers.get("x-forwarded-host") || req.headers.get("host") || req.nextUrl.host;
  const proto = req.headers.get("x-forwarded-proto") || req.nextUrl.protocol.replace(":", "");
  return `${proto}://${host}`;
}

export async function GET(req: NextRequest) {
  const origin = originOf(req);
  if (!ytConfigured()) return NextResponse.redirect(`${origin}/?yt=error&msg=${encodeURIComponent("GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET are not configured on the server")}`);
  const state = randomBytes(16).toString("hex");
  const res = NextResponse.redirect(authUrl(origin, state));
  res.cookies.set("yt_state", state, { httpOnly: true, sameSite: "lax", secure: origin.startsWith("https"), maxAge: 600, path: "/" });
  return res;
}
