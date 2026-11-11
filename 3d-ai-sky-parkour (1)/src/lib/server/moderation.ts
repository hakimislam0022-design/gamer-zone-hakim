export type Verdict = "ok" | "spam" | "blocked" | "injection" | "empty";

const BAD: RegExp[] = [
  /\b(fuck|shit|bitch|cunt|asshole|nigg\w*|porn|rape|nazi|kill yourself|kys|dick|pussy|slut|whore)\w*/i,
  /(মাদারচোদ|চোদ|বাল|খানকি|মাগি|হারামি|শুয়োর|কুত্তা)/,
];

const INJECTION: RegExp[] = [
  /ignore (all|any|the|your|previous|above|prior)/i,
  /disregard/i,
  /system\s*prompt/i,
  /you are now/i,
  /\bpretend\b/i,
  /jailbreak/i,
  /developer mode/i,
  /reveal.*(key|prompt|token|secret|password)/i,
  /(api|secret|access)[ _-]?(key|token)/i,
  /\bact as\b/i,
  /\boverride\b/i,
  /forget (everything|your|all)/i,
  /new (instructions|rules)/i,
  /আগের.*(নির্দেশ|কথা|নিয়ম).*(ভুলে|উপেক্ষা|বাদ)/,
  /সিস্টেম\s*প্রম্পট/,
  /<\|.*\|>/,
  /###\s*(system|instruction)/i,
  /<\/?viewer_message>/i,
];

export function cleanText(input: string): string {
  return input
    .replace(/[\u0000-\u001f\u007f\u200b-\u200f\u202a-\u202e]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 240);
}

export function cleanName(input: string): string {
  const n = cleanText(input).replace(/[<>{}"`\\]/g, "").slice(0, 40);
  return n || "friend";
}

export function moderate(raw: string): { verdict: Verdict; text: string } {
  const text = cleanText(raw);
  if (!text) return { verdict: "empty", text };
  if (/(https?:\/\/|www\.|\b[a-z0-9-]+\.(com|net|org|io|ly|xyz|ru|cn)\b)/i.test(text)) return { verdict: "spam", text };
  if (/(.)\1{9,}/u.test(text)) return { verdict: "spam", text };
  if (BAD.some((r) => r.test(text))) return { verdict: "blocked", text };
  if (INJECTION.some((r) => r.test(text))) return { verdict: "injection", text };
  return { verdict: "ok", text };
}

/* ---------- rate / duplicate filtering (in-memory, per server process) ---------- */
const authorHits = new Map<string, number[]>();
const recentTexts = new Map<string, number>();

export function rateCheck(authorKey: string, text: string, now = Date.now()): "ok" | "spam" | "duplicate" {
  const norm = text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
  const seen = recentTexts.get(norm);
  if (seen && now - seen < 60_000) return "duplicate";
  recentTexts.set(norm, now);
  const hits = (authorHits.get(authorKey) ?? []).filter((t) => now - t < 20_000);
  hits.push(now);
  authorHits.set(authorKey, hits);
  if (hits.length > 4) return "spam";
  if (recentTexts.size > 500) {
    for (const [k, v] of recentTexts) if (now - v > 60_000) recentTexts.delete(k);
  }
  if (authorHits.size > 500) {
    for (const [k, v] of authorHits) if (!v.some((t) => now - t < 20_000)) authorHits.delete(k);
  }
  return "ok";
}
