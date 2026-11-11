import { Stage, Platform, Hazard, movePos, spherePos, barAngle } from "@/lib/stage/types";
import { PHYS } from "@/lib/stage/physicsConsts";

export interface Collider {
  p: Platform;
  id: number;
  cx: number;
  cy: number;
  cz: number;
  dx: number;
  dy: number;
  dz: number;
  hx: number;
  hz: number;
  top: number;
  bottom: number;
  cos: number;
  sin: number;
  ell: boolean;
  moving: boolean;
  rad: number;
}

export interface Body {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  onGround: boolean;
  ground: Collider | null;
  coyote: number;
  jumpBuf: number;
  stun: number;
  hitCd: number;
  facing: number;
  airTime: number;
}

export interface StepInput {
  mx: number;
  mz: number;
  jump: boolean;
  speedScale: number;
}

export type PhysEvent = "jump" | "land" | "hit" | "step";

export function newBody(): Body {
  return { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, onGround: false, ground: null, coyote: 0, jumpBuf: 0, stun: 0, hitCd: 0, facing: 0, airTime: 0 };
}

export class World {
  stage: Stage;
  cols: Collider[] = [];
  time = 0;
  byPlatform = new Map<number, Collider>();
  onEvent: (e: PhysEvent, data?: number) => void = () => {};

  constructor(stage: Stage) {
    this.stage = stage;
    for (const p of stage.platforms) {
      const c: Collider = {
        p,
        id: p.id,
        cx: p.x,
        cy: p.y,
        cz: p.z,
        dx: 0,
        dy: 0,
        dz: 0,
        hx: p.sx / 2,
        hz: p.sz / 2,
        top: p.y + p.sy / 2,
        bottom: p.y - p.sy / 2,
        cos: Math.cos(p.rotY),
        sin: Math.sin(p.rotY),
        ell: p.shape === "ell",
        moving: !!p.move,
        rad: Math.hypot(p.sx, p.sz) / 2 + 1,
      };
      this.cols.push(c);
      this.byPlatform.set(p.id, c);
    }
  }

  /** Advance kinematic geometry to time t, recording per-collider deltas (for carrying the player). */
  update(t: number) {
    this.time = t;
    for (const c of this.cols) {
      if (!c.moving) continue;
      const m = movePos(c.p, t);
      c.dx = m.x - c.cx;
      c.dy = m.y - c.cy;
      c.dz = m.z - c.cz;
      c.cx = m.x;
      c.cy = m.y;
      c.cz = m.z;
      c.top = m.y + c.p.sy / 2;
      c.bottom = m.y - c.p.sy / 2;
    }
  }

  platformPos(id: number, t: number) {
    const c = this.byPlatform.get(id);
    if (!c) return null;
    const m = movePos(c.p, t);
    return { x: m.x, y: m.y + c.p.sy / 2, z: m.z };
  }

  inside(c: Collider, x: number, z: number, margin: number): boolean {
    const dx = x - c.cx;
    const dz = z - c.cz;
    if (dx * dx + dz * dz > (c.rad + margin) * (c.rad + margin)) return false;
    const lx = dx * c.cos - dz * c.sin;
    const lz = dx * c.sin + dz * c.cos;
    if (c.ell) {
      const u = lx / (c.hx + margin);
      const v = lz / (c.hz + margin);
      return u * u + v * v <= 1;
    }
    return Math.abs(lx) <= c.hx + margin && Math.abs(lz) <= c.hz + margin;
  }

  /** Highest collider whose top is at or below maxY and which contains (x,z). */
  supportAt(x: number, z: number, maxY: number, margin = 0.18, minY = -Infinity): Collider | null {
    let best: Collider | null = null;
    for (const c of this.cols) {
      if (c.top > maxY || c.top < minY) continue;
      if (best && c.top <= best.top) continue;
      if (this.inside(c, x, z, margin)) best = c;
    }
    return best;
  }

  /** Height of a wall in front of the player (null if none that blocks). */
  obstacleAt(x: number, z: number, feetY: number): number | null {
    let best: number | null = null;
    for (const c of this.cols) {
      if (c.top <= feetY + PHYS.stepUp || c.top > feetY + 1.9 || c.bottom > feetY + 1.5) continue;
      if (this.inside(c, x, z, PHYS.radius)) best = best === null ? c.top : Math.max(best, c.top);
    }
    return best;
  }

  /** Is there a hazard that would hit a person standing at (x,z) at time t? */
  threatAt(x: number, z: number, feetY: number, t: number): Hazard | null {
    for (const h of this.stage.hazards) {
      if (h.kind === "sphere") {
        const s = spherePos(h, t);
        if (feetY > s.y + h.len || feetY + PHYS.height < s.y - h.len) continue;
        if (Math.hypot(s.x - x, s.z - z) < h.len + 0.6) return h;
      } else {
        if (feetY > h.y + h.height / 2 + 0.05 || feetY + PHYS.height < h.y - h.height / 2) continue;
        const a = barAngle(h, t);
        const rx = x - h.x;
        const rz = z - h.z;
        const along = rx * Math.cos(a) + rz * Math.sin(a);
        const perp = -rx * Math.sin(a) + rz * Math.cos(a);
        if (Math.abs(along) < h.len + 0.7 && Math.abs(perp) < h.thick / 2 + 0.8) return h;
      }
    }
    return null;
  }

  private hazardCollide(b: Body) {
    if (b.hitCd > 0) return;
    const t = this.time;
    for (const h of this.stage.hazards) {
      let hit = false;
      let dirx = 0;
      let dirz = 0;
      if (h.kind === "sphere") {
        const s = spherePos(h, t);
        if (b.y > s.y + h.len || b.y + PHYS.height < s.y - h.len) continue;
        const dx = b.x - s.x;
        const dz = b.z - s.z;
        const d = Math.hypot(dx, dz);
        if (d < h.len + 0.38) {
          hit = true;
          dirx = dx / (d || 1);
          dirz = dz / (d || 1);
        }
      } else {
        if (b.y > h.y + h.height / 2 || b.y + PHYS.height < h.y - h.height / 2) continue;
        const a = barAngle(h, t);
        const rx = b.x - h.x;
        const rz = b.z - h.z;
        const along = rx * Math.cos(a) + rz * Math.sin(a);
        const perp = -rx * Math.sin(a) + rz * Math.cos(a);
        if (Math.abs(along) < h.len + 0.3 && Math.abs(perp) < h.thick / 2 + 0.35) {
          hit = true;
          const sgn = Math.sign(h.speed) || 1;
          dirx = -Math.sin(a) * sgn;
          dirz = Math.cos(a) * sgn;
        }
      }
      if (hit) {
        b.vx = dirx * 10;
        b.vz = dirz * 10;
        b.vy = Math.max(b.vy, 6.5);
        b.stun = 0.5;
        b.hitCd = 0.35;
        b.onGround = false;
        b.ground = null;
        this.onEvent("hit");
        return;
      }
    }
  }

  /** Carry the body with the platform it stands on (call once per frame after update()). */
  carry(b: Body) {
    const g = b.ground;
    if (g && b.onGround && g.moving) {
      b.x += g.dx;
      b.y += g.dy;
      b.z += g.dz;
    }
  }

  step(b: Body, inp: StepInput, dt: number) {
    const stunned = b.stun > 0;
    if (b.stun > 0) b.stun -= dt;
    if (b.hitCd > 0) b.hitCd -= dt;

    // horizontal acceleration
    const spd = PHYS.runSpeed * inp.speedScale;
    const tx = inp.mx * spd;
    const tz = inp.mz * spd;
    let ax = tx - b.vx;
    let az = tz - b.vz;
    const accel = (b.onGround ? PHYS.groundAccel : PHYS.airAccel) * (stunned ? 0.12 : 1);
    const maxD = accel * dt;
    const dl = Math.hypot(ax, az);
    if (dl > maxD) {
      ax = (ax / dl) * maxD;
      az = (az / dl) * maxD;
    }
    b.vx += ax;
    b.vz += az;

    // jump with coyote time + buffer
    b.coyote = b.onGround ? PHYS.coyote : b.coyote - dt;
    b.jumpBuf = inp.jump ? PHYS.buffer : b.jumpBuf - dt;
    if (b.jumpBuf > 0 && b.coyote > 0 && !stunned) {
      b.vy = PHYS.jumpSpeed;
      b.onGround = false;
      b.ground = null;
      b.coyote = 0;
      b.jumpBuf = 0;
      this.onEvent("jump");
    }

    b.vy = Math.max(-55, b.vy - PHYS.gravity * dt);

    // horizontal move + wall blocking
    let nx = b.x + b.vx * dt;
    let nz = b.z + b.vz * dt;
    const r = PHYS.radius;
    for (const c of this.cols) {
      if (b.y >= c.top - PHYS.stepUp || b.y + PHYS.height <= c.bottom + 0.05) continue;
      const dx = nx - c.cx;
      const dz = nz - c.cz;
      if (dx * dx + dz * dz > (c.rad + r) * (c.rad + r)) continue;
      const lx = dx * c.cos - dz * c.sin;
      const lz = dx * c.sin + dz * c.cos;
      let pxl = 0;
      let pzl = 0;
      if (c.ell) {
        const u = lx / (c.hx + r);
        const v = lz / (c.hz + r);
        const len = Math.hypot(u, v);
        if (len >= 1) continue;
        if (len < 1e-5) {
          pxl = c.hx + r;
        } else {
          pxl = (u / len) * (c.hx + r) - lx;
          pzl = (v / len) * (c.hz + r) - lz;
        }
      } else {
        const ox = c.hx + r - Math.abs(lx);
        const oz = c.hz + r - Math.abs(lz);
        if (ox <= 0 || oz <= 0) continue;
        if (ox < oz) pxl = Math.sign(lx || 1) * ox;
        else pzl = Math.sign(lz || 1) * oz;
      }
      const wx = pxl * c.cos + pzl * c.sin;
      const wz = -pxl * c.sin + pzl * c.cos;
      nx += wx;
      nz += wz;
      const wl = Math.hypot(wx, wz) || 1;
      const nxn = wx / wl;
      const nzn = wz / wl;
      const vd = b.vx * nxn + b.vz * nzn;
      if (vd < 0) {
        b.vx -= nxn * vd;
        b.vz -= nzn * vd;
      }
    }
    b.x = nx;
    b.z = nz;

    // vertical move + landing / head bump
    const prevY = b.y;
    b.y += b.vy * dt;
    let landed: Collider | null = null;
    if (b.vy <= 0) {
      let bestTop = -Infinity;
      for (const c of this.cols) {
        const prevTop = c.top - c.dy;
        if (prevY < prevTop - PHYS.stepUp && prevY < c.top - PHYS.stepUp) continue;
        if (b.y > c.top + 1e-4) continue;
        if (c.top <= bestTop) continue;
        if (b.y < c.top - PHYS.stepUp - Math.abs(b.vy * dt)) continue;
        if (this.inside(c, b.x, b.z, 0.2)) {
          landed = c;
          bestTop = c.top;
        }
      }
      if (landed) {
        const impact = -b.vy;
        b.y = landed.top;
        b.vy = 0;
        if (!b.onGround && impact > 3) this.onEvent("land", impact);
        b.onGround = true;
        b.ground = landed;
        b.airTime = 0;
      } else {
        b.onGround = false;
        b.ground = null;
        b.airTime += dt;
      }
    } else {
      b.onGround = false;
      b.ground = null;
      b.airTime += dt;
      for (const c of this.cols) {
        if (prevY + PHYS.height <= c.bottom + 0.05 && b.y + PHYS.height >= c.bottom && this.inside(c, b.x, b.z, r * 0.8)) {
          b.y = c.bottom - PHYS.height;
          b.vy = 0;
          break;
        }
      }
    }

    this.hazardCollide(b);
  }
}
