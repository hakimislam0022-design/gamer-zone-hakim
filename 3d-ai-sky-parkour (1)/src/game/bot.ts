import { World, Body, StepInput, Collider } from "./physics";
import { PHYS, airTime, safeReach } from "@/lib/stage/physicsConsts";
import { Hazard } from "@/lib/stage/types";

export type BotStatus = "off" | "running" | "waiting" | "jumping" | "recovering";

function distToCol(c: Collider, cx: number, cz: number, x: number, z: number) {
  const dx = x - cx;
  const dz = z - cz;
  const lx = dx * c.cos - dz * c.sin;
  const lz = dx * c.sin + dz * c.cos;
  if (c.ell) {
    const l = Math.hypot(lx / c.hx, lz / c.hz);
    return l <= 1 ? 0 : (l - 1) * Math.min(c.hx, c.hz);
  }
  return Math.hypot(Math.max(Math.abs(lx) - c.hx, 0), Math.max(Math.abs(lz) - c.hz, 0));
}

/**
 * Autonomous parkour driver. It only produces a StepInput (desired direction + jump pulse); it never
 * touches the body directly, and it is fully inert unless `active` is true, so it can never fight the
 * human controls.
 */
export class Bot {
  active = false;
  status: BotStatus = "off";
  wp = 0;
  wantRespawn = false;
  assistRequested = false;
  private progressTimer = 0;
  private bestDist = Infinity;
  private lastWp = -1;
  private jitter = 0;
  private jumpCooldown = 0;
  private fails = new Map<number, number>();
  falls = 0;

  setActive(on: boolean) {
    this.active = on;
    if (!on) this.cancel();
    else this.status = "running";
  }

  /** Cancel any pending decision so nothing leaks into the human's control. */
  cancel() {
    this.status = this.active ? "running" : "off";
    this.wantRespawn = false;
    this.assistRequested = false;
    this.progressTimer = 0;
    this.jumpCooldown = 0;
    this.bestDist = Infinity;
  }

  resetForStage() {
    this.wp = 0;
    this.fails.clear();
    this.jitter = 0;
    this.cancel();
  }

  onRespawn(cpIndex: number, cpWp: number, reason: "fall" | "stuck") {
    this.wp = cpWp;
    this.falls++;
    const n = (this.fails.get(cpIndex) ?? 0) + 1;
    this.fails.set(cpIndex, n);
    // adapt: vary take-off margin a little each failed attempt
    this.jitter = ((n * 0.37) % 0.5) - 0.12;
    if (n >= 9) this.assistRequested = true;
    this.progressTimer = 0;
    this.bestDist = Infinity;
    this.wantRespawn = false;
    this.status = reason === "fall" ? "recovering" : "recovering";
  }

  think(world: World, b: Body, t: number, dt: number): StepInput {
    const out: StepInput = { mx: 0, mz: 0, jump: false, speedScale: 1 };
    if (!this.active) return out;
    const wps = world.stage.waypoints;
    if (!wps.length) return out;
    this.jumpCooldown -= dt;

    // ---- waypoint advance
    const tgtOf = (i: number) => {
      const w = wps[i];
      const c = world.byPlatform.get(w.platform);
      if (c && c.moving) {
        const p = world.platformPos(w.platform, t)!;
        return { x: p.x, y: p.y, z: p.z };
      }
      return { x: w.x, y: w.y, z: w.z };
    };
    for (let guard = 0; guard < 6 && this.wp < wps.length - 1; guard++) {
      const tg = tgtOf(this.wp);
      const reached = Math.hypot(tg.x - b.x, tg.z - b.z) < (wps[this.wp].narrow ? 0.8 : 1.15) && Math.abs(tg.y - b.y) < 1.3 && b.onGround;
      if (!reached) break;
      this.wp++;
    }
    if (b.onGround && b.ground && b.ground.id !== wps[this.wp].platform) {
      for (let k = 1; k <= 4 && this.wp + k < wps.length; k++) {
        if (wps[this.wp + k].platform === b.ground.id) {
          this.wp += k;
          break;
        }
      }
    }
    const w = wps[this.wp];
    const tg = tgtOf(this.wp);

    // ---- progress watchdog (stuck => recover at checkpoint)
    const dTarget = Math.hypot(tg.x - b.x, tg.z - b.z);
    if (this.wp !== this.lastWp) {
      this.lastWp = this.wp;
      this.progressTimer = 0;
      this.bestDist = dTarget;
    } else if (dTarget < this.bestDist - 0.5) {
      this.bestDist = dTarget;
      this.progressTimer = 0;
    } else this.progressTimer += dt;
    if (this.progressTimer > 14) {
      this.wantRespawn = true;
      this.progressTimer = 0;
    }

    // ---- air control: ballistic aim at the landing point
    if (!b.onGround) {
      this.status = "jumping";
      const tp = world.byPlatform.get(w.platform);
      const ty = tg.y;
      const disc = b.vy * b.vy - 2 * PHYS.gravity * (ty - b.y) * -1;
      // y(t) = b.y + vy t - g/2 t^2 = ty  =>  g/2 t^2 - vy t + (ty - b.y) = 0
      const a = PHYS.gravity / 2;
      const d2 = b.vy * b.vy - 4 * a * (ty - b.y);
      let tl = d2 >= 0 ? (b.vy + Math.sqrt(d2)) / (2 * a) : Math.max(0.15, b.vy / PHYS.gravity);
      void disc;
      tl = Math.max(tl, 0.06);
      let px = tg.x;
      let pz = tg.z;
      if (tp && tp.moving) {
        const pp = world.platformPos(w.platform, t + tl);
        if (pp) {
          px = pp.x;
          pz = pp.z;
        }
      }
      const dx = (px - b.x) / tl;
      const dz = (pz - b.z) / tl;
      const sp = Math.hypot(dx, dz);
      const k = Math.min(1, PHYS.runSpeed / (sp || 1));
      out.mx = (dx * k) / PHYS.runSpeed;
      out.mz = (dz * k) / PHYS.runSpeed;
      return out;
    }

    // ---- ground
    let dirx = tg.x - b.x;
    let dirz = tg.z - b.z;
    let dl = Math.hypot(dirx, dirz);
    // line following on narrow stretches
    if (w.narrow && this.wp > 0 && wps[this.wp - 1].platform === w.platform) {
      const a = wps[this.wp - 1];
      const sx = tg.x - a.x;
      const sz = tg.z - a.z;
      const len2 = sx * sx + sz * sz || 1;
      const len = Math.sqrt(len2);
      const proj = ((b.x - a.x) * sx + (b.z - a.z) * sz) / len2;
      const tt = Math.min(1, Math.max(0, proj) + 1.4 / len);
      dirx = a.x + sx * tt - b.x;
      dirz = a.z + sz * tt - b.z;
      dl = Math.hypot(dirx, dirz);
    }
    if (dl < 1e-4) {
      this.status = "waiting";
      return out;
    }
    dirx /= dl;
    dirz /= dl;
    this.status = "running";

    const speedNow = Math.hypot(b.vx, b.vz);
    let scale = w.narrow ? 0.62 : 1;
    const onTarget = b.ground ? b.ground.id === w.platform : false;

    if (!onTarget) {
      const probeD = 0.5 + 0.045 * speedNow + this.jitter;
      const px = b.x + dirx * probeD;
      const pz = b.z + dirz * probeD;
      const support = world.supportAt(px, pz, b.y + PHYS.stepUp + 0.05, 0.12, b.y - 1.6);
      const riser = world.obstacleAt(b.x + dirx * (0.75 + 0.03 * speedNow), b.z + dirz * (0.75 + 0.03 * speedNow), b.y);
      const dy = Math.max(-8, Math.min(1.5, tg.y - b.y));
      const tAir = airTime(dy);
      const tc = world.byPlatform.get(w.platform);
      if (riser !== null && this.jumpCooldown <= 0) {
        out.jump = true;
        this.jumpCooldown = 0.3;
      } else if (support === null) {
        let pcx = tg.x;
        let pcz = tg.z;
        if (tc && tc.moving) {
          const pp = world.platformPos(w.platform, t + tAir);
          if (pp) {
            pcx = pp.x;
            pcz = pp.z;
          }
        }
        const dist = tc ? distToCol(tc, pcx, pcz, b.x, b.z) : dl;
        const feasible = tg.y - b.y <= 1.55 && dist <= safeReach(dy) * 1.12;
        if (feasible && this.jumpCooldown <= 0) {
          out.jump = true;
          this.jumpCooldown = 0.3;
          this.status = "jumping";
        } else if (!feasible) {
          scale = 0; // wait for a moving platform to come within range
          this.status = "waiting";
        }
      }
      if (dl < 8 && support !== null && riser === null) {
        scale = Math.min(scale, Math.max(0.5, dl / Math.max(tAir, 0.3) / PHYS.runSpeed + 0.25));
      }
    }

    // ---- hazard avoidance
    if (b.stun <= 0) {
      const spd = Math.max(6, speedNow);
      let found: { h: Hazard; dd: number } | null = null;
      for (const dd of [0, 1.2, 2.4, 3.6]) {
        if (dd > dl + 0.6) break;
        for (const off of [-0.12, 0, 0.12]) {
          const h: Hazard | null = world.threatAt(b.x + dirx * dd, b.z + dirz * dd, b.y, t + dd / spd + off);
          if (h) {
            found = { h, dd };
            break;
          }
        }
        if (found) break;
      }
      if (found) {
        const { h, dd } = found;
        if (h.kind === "bar") {
          if (dd <= 2.4 && this.jumpCooldown <= 0) {
            out.jump = true;
            this.jumpCooldown = 0.45;
          }
        } else {
          scale = 0;
          this.status = "waiting";
          if (dd === 0) {
            out.mx = -dirx * 0.8;
            out.mz = -dirz * 0.8;
            out.speedScale = 1;
            return out;
          }
        }
      }
    }

    out.mx = dirx;
    out.mz = dirz;
    out.speedScale = scale;
    return out;
  }
}
