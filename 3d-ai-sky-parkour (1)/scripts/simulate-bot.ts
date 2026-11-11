import { generateStage } from "../src/lib/stage/generator";
import { World, newBody } from "../src/game/physics";
import { Bot } from "../src/game/bot";

const from = Number(process.argv[2] ?? 1);
const to = Number(process.argv[3] ?? 30);
const verbose = process.argv[4] === "v";
const fallBy: Record<string, number> = {};
let done = 0, assisted = 0, totalFalls = 0;
const failed: number[] = [];
for (let id = from; id <= to; id++) {
  const stage = generateStage(id);
  const world = new World(stage);
  const b = newBody();
  b.x = 0; b.y = 0; b.z = 0;
  const bot = new Bot();
  bot.setActive(true);
  bot.resetForStage();
  let cp = 0, t = 0, falls = 0, finished = false, assists = 0;
  const dt = 1 / 60;
  while (t < 240) {
    t += dt;
    world.update(t);
    world.carry(b);
    const inp = bot.think(world, b, t, dt);
    for (let s = 0; s < 2; s++) world.step(b, inp, dt / 2);
    if (b.onGround && b.ground) {
      const ci = stage.checkpoints.findIndex((c) => c.platform === b.ground!.id);
      if (ci > cp) cp = ci;
      if (b.ground.p.role === "finish") { finished = true; break; }
    }
    if (b.y < stage.killY || bot.wantRespawn) {
      falls++;
      { const w = stage.waypoints[Math.min(bot.wp, stage.waypoints.length - 1)]; const pl = stage.platforms.find((q) => q.id === w.platform)!; const ty = stage.pieceTypes[pl.piece - 1] ?? 'start'; fallBy[ty] = (fallBy[ty] ?? 0) + 1; }
      const c = stage.checkpoints[cp];
      b.x = c.x; b.y = c.y + 0.05; b.z = c.z; b.vx = b.vy = b.vz = 0;
      bot.onRespawn(cp, c.wp, "fall");
      if (bot.assistRequested) {
        assists++;
        bot.assistRequested = false;
        cp = Math.min(stage.checkpoints.length - 1, cp + 1);
        const n = stage.checkpoints[cp];
        b.x = n.x; b.y = n.y + 0.05; b.z = n.z;
        bot.wp = n.wp;
      }
    }
  }
  totalFalls += falls;
  if (finished) done++; else failed.push(id);
  if (assists) assisted++;
  if (verbose || !finished) console.log(id, finished ? "OK" : "FAIL", "t=" + t.toFixed(0), "falls=" + falls, "assists=" + assists, stage.pieceTypes.join(","));
}
console.log(fallBy);
console.log({ from, to, completed: done, total: to - from + 1, stagesNeedingAssist: assisted, totalFalls, failed });
