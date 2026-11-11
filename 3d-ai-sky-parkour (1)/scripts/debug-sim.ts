import { generateStage } from "../src/lib/stage/generator";
import { World, newBody } from "../src/game/physics";
import { Bot } from "../src/game/bot";
const id = Number(process.argv[2]);
const type = process.argv[3] ?? "spheres";
const stage = generateStage(id);
const world = new World(stage);
const b = newBody();
const bot = new Bot(); bot.setActive(true); bot.resetForStage();
let cp = 0, t = 0; const dt = 1/60; let logged = 0; let falls=0;
while (t < 120 && falls < 2) {
  t += dt; world.update(t); world.carry(b);
  const inp = bot.think(world, b, t, dt);
  for (let s=0;s<2;s++) world.step(b, inp, dt/2);
  const w = stage.waypoints[bot.wp]; const pl = stage.platforms.find(q=>q.id===w.platform)!;
  const ty = stage.pieceTypes[pl.piece-1];
  if (ty === type && Math.floor(t*4) !== Math.floor((t-dt)*4) && logged < 80) { logged++; console.log(t.toFixed(2), "wp", bot.wp, "pos", b.x.toFixed(1), b.y.toFixed(1), b.z.toFixed(1), "v", b.vx.toFixed(1), b.vz.toFixed(1), bot.status, "gnd", b.onGround, "stun", b.stun.toFixed(2), "tgt", w.x.toFixed(1), w.z.toFixed(1)); }
  if (bot.status==='waiting' && t>30 && t<30.1) { const w2=stage.waypoints[bot.wp]; const dx=w2.x-b.x, dz=w2.z-b.z, l=Math.hypot(dx,dz); for (const dd of [0,1.2,2.4,3.6]) { const h=world.threatAt(b.x+dx/l*dd,b.z+dz/l*dd,b.y,t+dd/6); console.log('dd',dd,h? JSON.stringify({k:h.kind,x:h.x,z:h.z,len:h.len,ax:h.ax,az:h.az}):null); } console.log('spd', Math.hypot(b.vx,b.vz), 'ground', b.ground?.id, 'wp plat', w2.platform); }
  if (b.onGround && b.ground) { const ci = stage.checkpoints.findIndex(c=>c.platform===b.ground!.id); if (ci>cp) cp=ci; }
  if (b.y < stage.killY) { falls++; console.log("FALL at", t.toFixed(1), "wp", bot.wp, ty); const c = stage.checkpoints[cp]; b.x=c.x;b.y=c.y+0.05;b.z=c.z;b.vx=b.vy=b.vz=0; bot.onRespawn(cp,c.wp,"fall"); }
}
