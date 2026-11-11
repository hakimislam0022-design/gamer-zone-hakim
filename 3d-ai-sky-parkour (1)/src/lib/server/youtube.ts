import { db } from "@/db";
import { youtubeAuth, chatMessages } from "@/db/schema";
import { eq } from "drizzle-orm";
import { moderate, rateCheck, cleanName, Verdict } from "./moderation";

const ID = "main";
const SCOPE = "https://www.googleapis.com/auth/youtube.readonly";
const API = "https://www.googleapis.com/youtube/v3";

export function ytConfigured() {
  return !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
}

export function redirectUri(origin: string) {
  return process.env.YOUTUBE_REDIRECT_URI || `${origin}/api/youtube/callback`;
}

export function authUrl(origin: string, state: string) {
  const p = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID || "",
    redirect_uri: redirectUri(origin),
    response_type: "code",
    scope: SCOPE,
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${p.toString()}`;
}

async function getRow() {
  const rows = await db.select().from(youtubeAuth).where(eq(youtubeAuth.id, ID)).limit(1);
  return rows[0] ?? null;
}

async function saveRow(patch: Partial<typeof youtubeAuth.$inferInsert>) {
  const existing = await getRow();
  if (existing) await db.update(youtubeAuth).set({ ...patch, updatedAt: new Date() }).where(eq(youtubeAuth.id, ID));
  else await db.insert(youtubeAuth).values({ id: ID, ...patch });
}

export async function exchangeCode(code: string, origin: string) {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: process.env.GOOGLE_CLIENT_ID || "",
      client_secret: process.env.GOOGLE_CLIENT_SECRET || "",
      redirect_uri: redirectUri(origin),
      grant_type: "authorization_code",
    }),
  });
  const j = (await res.json()) as { access_token?: string; refresh_token?: string; expires_in?: number; scope?: string; error?: string; error_description?: string };
  if (!res.ok || !j.access_token) throw new Error(j.error_description || j.error || "token exchange failed");
  const existing = await getRow();
  await saveRow({
    accessToken: j.access_token,
    refreshToken: j.refresh_token ?? existing?.refreshToken ?? null,
    expiresAt: Date.now() + (j.expires_in ?? 3600) * 1000,
    scope: j.scope ?? SCOPE,
    liveChatId: null,
    nextPageToken: null,
    lastError: null,
  });
  try {
    const ch = await api("/channels?part=snippet&mine=true");
    const title = ch?.items?.[0]?.snippet?.title as string | undefined;
    if (title) await saveRow({ channelTitle: title });
  } catch {}
}

async function accessToken(): Promise<string> {
  const row = await getRow();
  if (!row?.accessToken && !row?.refreshToken) throw new YtError("unauthorized", "Not authorized with YouTube yet");
  if (row.accessToken && row.expiresAt && row.expiresAt > Date.now() + 60_000) return row.accessToken;
  if (!row.refreshToken) throw new YtError("unauthorized", "Access token expired and no refresh token stored");
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID || "",
      client_secret: process.env.GOOGLE_CLIENT_SECRET || "",
      refresh_token: row.refreshToken,
      grant_type: "refresh_token",
    }),
  });
  const j = (await res.json()) as { access_token?: string; expires_in?: number; error?: string };
  if (!res.ok || !j.access_token) {
    await saveRow({ accessToken: null, expiresAt: null, lastError: `refresh failed: ${j.error ?? res.status}` });
    throw new YtError("unauthorized", "Token refresh failed. Please authorize again.");
  }
  await saveRow({ accessToken: j.access_token, expiresAt: Date.now() + (j.expires_in ?? 3600) * 1000 });
  return j.access_token;
}

export class YtError extends Error {
  constructor(public code: "unauthorized" | "no-broadcast" | "ended" | "quota" | "error", message: string) {
    super(message);
  }
}

async function api(path: string) {
  const token = await accessToken();
  const res = await fetch(`${API}${path}`, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) {
    const reason: string = j?.error?.errors?.[0]?.reason ?? "";
    const msg: string = j?.error?.message ?? `HTTP ${res.status}`;
    if (res.status === 401) throw new YtError("unauthorized", msg);
    if (reason === "liveChatEnded" || reason === "liveChatNotFound" || res.status === 404) throw new YtError("ended", msg);
    if (reason === "quotaExceeded" || reason === "rateLimitExceeded" || reason === "dailyLimitExceeded") throw new YtError("quota", msg);
    throw new YtError("error", `${reason ? reason + ": " : ""}${msg}`);
  }
  return j;
}

/** Find the live chat of the active broadcast (or of a specific video id). */
export async function connectLiveChat(videoId?: string) {
  const forced = videoId || process.env.YOUTUBE_VIDEO_ID || "";
  let liveChatId: string | undefined;
  let vid = forced;
  let title = "";
  if (forced) {
    const j = await api(`/videos?part=liveStreamingDetails,snippet&id=${encodeURIComponent(forced)}`);
    const item = j.items?.[0];
    liveChatId = item?.liveStreamingDetails?.activeLiveChatId;
    title = item?.snippet?.title ?? "";
    if (!item) throw new YtError("no-broadcast", `Video ${forced} not found`);
    if (!liveChatId) throw new YtError("no-broadcast", "That video has no active live chat (is it live right now?)");
  } else {
    const j = await api("/liveBroadcasts?part=snippet,status&broadcastStatus=active&broadcastType=all&mine=true&maxResults=5");
    const item = j.items?.[0];
    if (!item?.snippet?.liveChatId) throw new YtError("no-broadcast", "No active livestream found on the authorized channel");
    liveChatId = item.snippet.liveChatId;
    vid = item.id;
    title = item.snippet.title ?? "";
  }
  await saveRow({ liveChatId, videoId: vid, broadcastTitle: title, nextPageToken: null, lastError: null });
  return { liveChatId, videoId: vid, title };
}

export async function disconnect() {
  const row = await getRow();
  if (row?.refreshToken || row?.accessToken) {
    try {
      await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent((row.refreshToken || row.accessToken) as string)}`, { method: "POST" });
    } catch {}
  }
  await db.delete(youtubeAuth).where(eq(youtubeAuth.id, ID));
  lastPoll = 0;
}

export async function ytStatus() {
  const row = await getRow();
  return {
    configured: ytConfigured(),
    authorized: !!(row?.refreshToken || row?.accessToken),
    channel: row?.channelTitle ?? null,
    liveChatConnected: !!row?.liveChatId,
    videoId: row?.videoId ?? null,
    title: row?.broadcastTitle ?? null,
    lastError: row?.lastError ?? null,
  };
}

export interface IncomingMessage {
  id: string;
  author: string;
  channelId: string;
  text: string;
  verdict: Verdict;
  isOwner: boolean;
  isModerator: boolean;
}

let lastPoll = 0;
let nextInterval = 5000;
let inflight: Promise<unknown> | null = null;

const minPoll = () => Math.max(2000, Number(process.env.YT_MIN_POLL_MS || 5000));

export async function pollChat() {
  const now = Date.now();
  const wait = lastPoll + nextInterval - now;
  if (wait > 0) return { status: "connected" as const, messages: [] as IncomingMessage[], intervalMs: wait + 50, filtered: 0 };
  if (inflight) await inflight;
  const run = (async () => {
    let row = await getRow();
    if (!row?.refreshToken && !row?.accessToken) throw new YtError("unauthorized", "Not authorized with YouTube yet");
    if (!row.liveChatId) {
      await connectLiveChat();
      row = await getRow();
    }
    const chatId = row!.liveChatId!;
    const first = !row!.nextPageToken;
    const qs = new URLSearchParams({ liveChatId: chatId, part: "snippet,authorDetails", maxResults: "200" });
    if (row!.nextPageToken) qs.set("pageToken", row!.nextPageToken);
    lastPoll = Date.now();
    const j = await api(`/liveChat/messages?${qs.toString()}`);
    nextInterval = Math.max(minPoll(), Number(j.pollingIntervalMillis ?? 5000));
    await saveRow({ nextPageToken: j.nextPageToken ?? null, lastError: null });
    const out: IncomingMessage[] = [];
    let filtered = 0;
    // The first page is backlog (messages from before we connected): remember them, never reply to them.
    for (const it of (j.items ?? []) as Array<Record<string, any>>) {
      if (it.snippet?.type !== "textMessageEvent") continue;
      const id = String(it.id);
      const author = cleanName(it.authorDetails?.displayName ?? "viewer");
      const channelId = String(it.authorDetails?.channelId ?? author);
      const raw = String(it.snippet?.textMessageDetails?.messageText ?? it.snippet?.displayMessage ?? "");
      const m = moderate(raw);
      const inserted = await db
        .insert(chatMessages)
        .values({ id, author, channelId, message: m.text.slice(0, 500), verdict: first ? "backlog" : m.verdict })
        .onConflictDoNothing()
        .returning({ id: chatMessages.id });
      if (!inserted.length || first) continue;
      if (m.verdict === "empty" || m.verdict === "spam" || m.verdict === "blocked") {
        filtered++;
        continue;
      }
      const rc = rateCheck(channelId, m.text);
      if (rc !== "ok") {
        filtered++;
        continue;
      }
      out.push({ id, author, channelId, text: m.text, verdict: m.verdict, isOwner: !!it.authorDetails?.isChatOwner, isModerator: !!it.authorDetails?.isChatModerator });
    }
    return { status: "connected" as const, messages: out, intervalMs: nextInterval, filtered };
  })();
  inflight = run.catch(() => null);
  try {
    return await run;
  } catch (e) {
    const err = e as YtError;
    const code = err instanceof YtError ? err.code : "error";
    nextInterval = code === "quota" ? 60_000 : code === "ended" || code === "no-broadcast" ? 30_000 : 10_000;
    if (code === "ended") await saveRow({ liveChatId: null, nextPageToken: null, lastError: err.message });
    else await saveRow({ lastError: err.message }).catch(() => {});
    return { status: code, messages: [] as IncomingMessage[], intervalMs: nextInterval, filtered: 0, detail: err.message };
  } finally {
    inflight = null;
  }
}
