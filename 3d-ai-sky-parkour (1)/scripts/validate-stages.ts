import { generateStage } from "../src/lib/stage/generator";
const from = Number(process.argv[2] ?? 1);
const to = Number(process.argv[3] ?? 1000);
let bad = 0;
let attemptsTotal = 0;
let maxAttempts = 0;
const fps = new Map<string, number>();
let dups = 0;
const typeCount: Record<string, number> = {};
const t0 = Date.now();
for (let id = from; id <= to; id++) {
  const s = generateStage(id);
  attemptsTotal += s.validation.attempts;
  maxAttempts = Math.max(maxAttempts, s.validation.attempts);
  if (!s.validation.ok) {
    bad++;
    if (bad < 8) console.log("INVALID", id, s.validation.issues.slice(0, 3));
  }
  if (fps.has(s.fingerprint)) dups++;
  fps.set(s.fingerprint, id);
  for (const t of s.pieceTypes) typeCount[t] = (typeCount[t] ?? 0) + 1;
}
console.log({ from, to, invalid: bad, duplicateLayouts: dups, avgAttempts: (attemptsTotal / (to - from + 1)).toFixed(2), maxAttempts, ms: Date.now() - t0 });
console.log(typeCount);
