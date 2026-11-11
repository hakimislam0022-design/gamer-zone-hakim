import { Platform, Stage, StageValidation } from "./types";
import { MAX_RISE, runupNeeded, safeReach } from "./physicsConsts";

type V2 = [number, number];
interface Sample {
  poly: V2[];
  top: number;
  bottom: number;
}

/** World-space footprint polygon for a platform, optionally offset (moving platforms). */
export function platformPoly(p: Platform, ox = 0, oz = 0): V2[] {
  const c = Math.cos(p.rotY);
  const s = Math.sin(p.rotY);
  const pts: V2[] = [];
  if (p.shape === "box") {
    const hx = p.sx / 2;
    const hz = p.sz / 2;
    for (const [lx, lz] of [
      [-hx, -hz],
      [hx, -hz],
      [hx, hz],
      [-hx, hz],
    ] as V2[]) {
      pts.push([p.x + ox + lx * c + lz * s, p.z + oz - lx * s + lz * c]);
    }
  } else {
    const rx = p.sx / 2;
    const rz = p.sz / 2;
    const N = 20;
    for (let i = 0; i < N; i++) {
      const a = (i / N) * Math.PI * 2;
      const lx = Math.cos(a) * rx;
      const lz = Math.sin(a) * rz;
      pts.push([p.x + ox + lx * c + lz * s, p.z + oz - lx * s + lz * c]);
    }
  }
  return pts;
}

function samplesOf(p: Platform): Sample[] {
  if (!p.move) return [{ poly: platformPoly(p), top: p.y + p.sy / 2, bottom: p.y - p.sy / 2 }];
  const out: Sample[] = [];
  for (let k = 0; k < 8; k++) {
    const s = Math.sin((k * Math.PI) / 4);
    out.push({
      poly: platformPoly(p, p.move.ax * s, p.move.az * s),
      top: p.y + p.move.ay * s + p.sy / 2,
      bottom: p.y + p.move.ay * s - p.sy / 2,
    });
  }
  return out;
}

/** SAT overlap depth for convex polygons. 0 when separated. */
function overlapDepth(a: V2[], b: V2[]): number {
  let minOverlap = Infinity;
  for (const poly of [a, b]) {
    for (let i = 0; i < poly.length; i++) {
      const p1 = poly[i];
      const p2 = poly[(i + 1) % poly.length];
      let nx = p2[1] - p1[1];
      let nz = p1[0] - p2[0];
      const l = Math.hypot(nx, nz) || 1;
      nx /= l;
      nz /= l;
      let minA = Infinity,
        maxA = -Infinity,
        minB = Infinity,
        maxB = -Infinity;
      for (const q of a) {
        const d = q[0] * nx + q[1] * nz;
        if (d < minA) minA = d;
        if (d > maxA) maxA = d;
      }
      for (const q of b) {
        const d = q[0] * nx + q[1] * nz;
        if (d < minB) minB = d;
        if (d > maxB) maxB = d;
      }
      const o = Math.min(maxA, maxB) - Math.max(minA, minB);
      if (o <= 0) return 0;
      if (o < minOverlap) minOverlap = o;
    }
  }
  return minOverlap === Infinity ? 0 : minOverlap;
}

function pointSeg(px: number, pz: number, a: V2, b: V2): number {
  const abx = b[0] - a[0];
  const abz = b[1] - a[1];
  const l2 = abx * abx + abz * abz || 1;
  let t = ((px - a[0]) * abx + (pz - a[1]) * abz) / l2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (a[0] + abx * t), pz - (a[1] + abz * t));
}

/** Minimum distance between two convex footprints (0 when overlapping). */
export function polyDist(a: V2[], b: V2[]): number {
  if (overlapDepth(a, b) > 0) return 0;
  let best = Infinity;
  for (const p of a) for (let i = 0; i < b.length; i++) best = Math.min(best, pointSeg(p[0], p[1], b[i], b[(i + 1) % b.length]));
  for (const p of b) for (let i = 0; i < a.length; i++) best = Math.min(best, pointSeg(p[0], p[1], a[i], a[(i + 1) % a.length]));
  return best;
}

function pointInPoly(px: number, pz: number, poly: V2[], tol = 0.05): boolean {
  // convex polygon: inside if on same side of all edges (or within tol)
  let sign = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const cr = (b[0] - a[0]) * (pz - a[1]) - (b[1] - a[1]) * (px - a[0]);
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    const dist = cr / len;
    if (Math.abs(dist) <= tol) continue;
    const s = Math.sign(dist);
    if (sign === 0) sign = s;
    else if (s !== sign) return false;
  }
  return true;
}

function maxDim(p: Platform): number {
  return Math.max(p.sx, p.sz);
}

export function validateStage(stage: Stage): StageValidation {
  const issues: string[] = [];
  const byId = new Map<number, Platform>();
  for (const p of stage.platforms) byId.set(p.id, p);
  const routeIndex = new Map<number, number>();
  stage.route.forEach((id, i) => routeIndex.set(id, i));
  const cache = new Map<number, Sample[]>();
  const samples = (p: Platform) => {
    let s = cache.get(p.id);
    if (!s) {
      s = samplesOf(p);
      cache.set(p.id, s);
    }
    return s;
  };

  let worstGap = 0;

  // 1. every route jump must be physically possible
  for (let i = 0; i < stage.route.length - 1; i++) {
    const A = byId.get(stage.route[i]);
    const B = byId.get(stage.route[i + 1]);
    if (!A || !B) {
      issues.push(`route ${i}: missing platform`);
      continue;
    }
    let ok = false;
    let minOkGap = Infinity;
    let collide = false;
    for (const sa of samples(A)) {
      for (const sb of samples(B)) {
        const gap = polyDist(sa.poly, sb.poly);
        const dy = sb.top - sa.top;
        if (gap < 0.2 && (A.move || B.move) && Math.abs(dy) < 2.9 && overlapDepth(sa.poly, sb.poly) > 0.1) collide = true;
        if (dy <= MAX_RISE && gap <= safeReach(dy) + 0.02) {
          ok = true;
          minOkGap = Math.min(minOkGap, gap);
        }
      }
    }
    if (!ok) issues.push(`jump ${i} (${A.id}->${B.id}) is not reachable`);
    else {
      worstGap = Math.max(worstGap, minOkGap);
      if (minOkGap > 3.2 && maxDim(A) + 0.01 < runupNeeded(minOkGap) + 1) issues.push(`jump ${i}: run-up too short for gap ${minOkGap.toFixed(2)}`);
    }
    if (collide) issues.push(`jump ${i}: moving platform clips neighbour`);
  }

  // 2. platforms must not intersect each other (stacking/self overlap of the route)
  const list = stage.platforms;
  const radii = list.map((p) => {
    const poly = platformPoly(p);
    let r = 0;
    for (const q of poly) r = Math.max(r, Math.hypot(q[0] - p.x, q[1] - p.z));
    const amp = p.move ? Math.hypot(p.move.ax, p.move.az) : 0;
    return r + amp;
  });
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      const a = list[i];
      const b = list[j];
      const ia = routeIndex.get(a.id);
      const ib = routeIndex.get(b.id);
      if (ia !== undefined && ib !== undefined && Math.abs(ia - ib) <= 1) continue;
      const dist = Math.hypot(a.x - b.x, a.z - b.z);
      if (dist > radii[i] + radii[j] + 0.1) continue;
      let hit = false;
      for (const sa of samples(a)) {
        for (const sb of samples(b)) {
          if (sa.bottom > sb.top + 3.4 || sb.bottom > sa.top + 3.4) continue;
          if (overlapDepth(sa.poly, sb.poly) > 0.08) hit = true;
        }
      }
      if (hit) {
        issues.push(`platforms ${a.id} and ${b.id} intersect`);
        if (issues.length > 12) break;
      }
    }
    if (issues.length > 12) break;
  }

  // 3. waypoints must sit on their platform
  for (let i = 0; i < stage.waypoints.length; i++) {
    const w = stage.waypoints[i];
    const p = byId.get(w.platform);
    if (!p) {
      issues.push(`waypoint ${i}: unknown platform`);
      continue;
    }
    if (p.move) continue;
    if (!pointInPoly(w.x, w.z, platformPoly(p), 0.1)) issues.push(`waypoint ${i} is off its platform`);
    if (Math.abs(w.y - (p.y + p.sy / 2)) > 0.05) issues.push(`waypoint ${i} wrong height`);
  }

  // 4. hazards are jumpable / avoidable
  for (const h of stage.hazards) {
    if (h.kind === "bar" && h.height > 1.05) issues.push(`bar ${h.id} too tall to jump over`);
    if (h.kind === "sphere" && h.len > 1.15) issues.push(`sphere ${h.id} too large`);
    if (!byId.get(h.platform)) issues.push(`hazard ${h.id} has no platform`);
  }

  // 5. structure
  const first = byId.get(stage.route[0]);
  const last = byId.get(stage.route[stage.route.length - 1]);
  if (!first || first.role !== "start") issues.push("route must start on the start platform");
  if (!last || last.role !== "finish") issues.push("route must end on the finish platform");
  if (stage.checkpoints.length < 1) issues.push("no checkpoints");

  return { ok: issues.length === 0, issues: issues.slice(0, 12), edges: Math.max(0, stage.route.length - 1), maxGap: worstGap, attempts: 0 };
}
