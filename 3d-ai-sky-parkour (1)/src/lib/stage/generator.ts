import { Stage, Platform, Hazard, Decor, Waypoint, Checkpoint, Pattern, MoveSpec } from "./types";
import { makeRng, stageSeed, hashString, Rng } from "../rng";
import { maxGap } from "./physicsConsts";
import { validateStage } from "./validator";

/** Vivid colours from the reference screenshots: pink, purple, green, yellow, red, cyan, orange, blue. */
export const PALETTE = [0xff2bd6, 0x9b30ff, 0x22e83a, 0xffe600, 0xff1a1a, 0x00e5ff, 0xff8c00, 0x1f4bff];
const GREENS = [0x22e83a, 0x3dff55, 0x00c040, 0x7dff3a];
const DARK = 0x2a1f33;
const THEMES = [
  "Neon Meadow", "Candy Skyline", "Rainbow Ridge", "Pixel Peaks", "Cyan Cascade", "Magenta Mile", "Solar Drift", "Violet Voyage",
  "Coral Crown", "Turbo Tower", "Jelly Junction", "Laser Lane", "Cloud Circuit", "Ocean Overpass", "Sugar Rush", "Zigzag Zone",
];

interface Frame {
  x: number;
  y: number;
  z: number;
  h: number;
}

interface Ctx {
  rng: Rng;
  d: number;
  f: Frame;
  plats: Platform[];
  hazards: Hazard[];
  decor: Decor[];
  wps: Waypoint[];
  route: number[];
  cps: Checkpoint[];
  piece: number;
  colorBase: number;
  types: string[];
  nextId: number;
}

const fwd = (h: number) => ({ x: Math.sin(h), z: -Math.cos(h) });
const rgt = (h: number) => ({ x: Math.cos(h), z: Math.sin(h) });
const MAXY = 22;
const MINY = -4;

function col(c: Ctx, i: number) {
  return PALETTE[(c.colorBase + i) % PALETTE.length];
}

interface PO {
  gap: number;
  len: number;
  width: number;
  dy?: number;
  lat?: number;
  shape?: "box" | "ell";
  sy?: number;
  color?: number;
  color2?: number;
  pattern?: Pattern;
  glow?: boolean;
  move?: MoveSpec;
  role?: Platform["role"];
  route?: boolean;
  narrow?: boolean;
  wp?: "auto" | "none" | "center";
  advance?: boolean;
}

function makePlat(
  c: Ctx,
  s: { x: number; z: number; top: number; sx: number; sz: number; sy: number; rotY: number; shape?: "box" | "ell"; color: number; color2?: number; pattern?: Pattern; glow?: boolean; move?: MoveSpec; role?: Platform["role"] },
): Platform {
  const p: Platform = {
    id: c.nextId++,
    shape: s.shape ?? "box",
    x: s.x,
    y: s.top - s.sy / 2,
    z: s.z,
    sx: s.sx,
    sy: s.sy,
    sz: s.sz,
    rotY: s.rotY,
    color: s.color,
    color2: s.color2 ?? 0xffffff,
    pattern: s.pattern ?? "solid",
    glow: s.glow,
    move: s.move,
    piece: c.piece,
    role: s.role ?? "normal",
  };
  c.plats.push(p);
  return p;
}

function addWp(c: Ctx, p: Platform, x: number, z: number, narrow?: boolean) {
  c.wps.push({ x, y: p.y + p.sy / 2, z, platform: p.id, narrow });
}

function addPlat(c: Ctx, o: PO): Platform {
  const f = fwd(c.f.h);
  const r = rgt(c.f.h);
  const top = c.f.y + (o.dy ?? 0);
  const dist = o.gap + o.len / 2;
  const lat = o.lat ?? 0;
  const cx = c.f.x + f.x * dist + r.x * lat;
  const cz = c.f.z + f.z * dist + r.z * lat;
  const p = makePlat(c, {
    x: cx,
    z: cz,
    top,
    sx: o.width,
    sz: o.len,
    sy: o.sy ?? 1,
    rotY: -c.f.h,
    shape: o.shape,
    color: o.color ?? col(c, c.plats.length),
    color2: o.color2,
    pattern: o.pattern,
    glow: o.glow,
    move: o.move,
    role: o.role,
  });
  if (o.route !== false) {
    c.route.push(p.id);
    const wpMode = o.wp ?? "auto";
    if (wpMode === "center" || p.shape === "ell" || o.len <= 6) {
      if (wpMode !== "none") addWp(c, p, cx, cz, o.narrow);
    } else if (wpMode === "auto") {
      const nx = cx - f.x * o.len / 2;
      const nz = cz - f.z * o.len / 2;
      for (let t = 1.0; t < o.len - 1.2; t += 3) addWp(c, p, nx + f.x * t, nz + f.z * t, o.narrow);
      addWp(c, p, nx + f.x * (o.len - 1.0), nz + f.z * (o.len - 1.0), o.narrow);
    }
  }
  if (o.advance !== false) {
    c.f.x = cx + f.x * o.len / 2;
    c.f.z = cz + f.z * o.len / 2;
    c.f.y = top;
  }
  return p;
}

function clampDy(c: Ctx, dy: number) {
  const y = c.f.y;
  if (y + dy > MAXY) return -Math.abs(dy);
  if (y + dy < MINY) return Math.abs(dy);
  return dy;
}

/* ------------------------------------------------------------------ pieces */

function pieceStraight(c: Ctx) {
  const r = c.rng;
  const len = r.range(9, 20);
  const width = r.range(7 - 3 * c.d, 8.2 - 3.6 * c.d);
  const pattern = r.pick<Pattern>(["road", "stripes", "solid", "tiles", "road"]);
  addPlat(c, { gap: r.range(0, 1.5), len, width, pattern, color: pattern === "road" ? DARK : col(c, 1), color2: pattern === "road" ? 0xffffff : col(c, 4), glow: r.chance(0.25) });
}

function pieceNarrow(c: Ctx) {
  const r = c.rng;
  const width = 1.9 - 0.9 * c.d + r.range(-0.05, 0.1);
  const segs = r.int(1, 2);
  for (let i = 0; i < segs; i++) {
    addPlat(c, { gap: i === 0 ? r.range(0.5, 1.8) : r.range(1.2, 2.5), len: r.range(9, 20), width, narrow: true, color: col(c, i * 3 + 2), pattern: "stripes", color2: 0xffffff, sy: 0.6, glow: true });
  }
}

function pieceBlocks(c: Ctx) {
  const r = c.rng;
  const n = r.int(5, 9);
  for (let i = 0; i < n; i++) {
    const dy = clampDy(c, r.range(-0.8, 1.0));
    const gap = r.range(1.2, Math.max(1.5, maxGap(dy, c.d) * 0.95));
    const w = r.range(2.0, 3.2);
    addPlat(c, { gap, len: r.range(2.0, 3.2), width: w, dy, lat: r.range(-1.2, 1.2) * (0.5 + c.d), color: col(c, i), sy: r.range(0.8, 1.4), pattern: i % 3 === 2 ? "tiles" : "solid", glow: r.chance(0.2) });
  }
}

function pieceStairs(c: Ctx, down: boolean) {
  const r = c.rng;
  let n = r.int(7, 14);
  const rise = r.range(0.55, 1.0 + 0.1 * c.d);
  if (!down) n = Math.min(n, Math.floor((MAXY - c.f.y) / rise));
  else n = Math.min(n, Math.floor((c.f.y - MINY) / (rise * 1.3)));
  n = Math.max(n, 4);
  const run = r.range(2.0, 2.8);
  const width = r.range(3.2, 5);
  const base = r.int(0, GREENS.length - 1);
  for (let i = 0; i < n; i++) {
    addPlat(c, { gap: i === 0 ? r.range(0.8, 1.8) : 0, len: run, width, dy: down ? -rise * 1.3 : rise, sy: 3, color: GREENS[(base + i) % GREENS.length], pattern: "solid", wp: "center" });
  }
}

function pieceBars(c: Ctx) {
  const r = c.rng;
  const L = r.range(2.9, 4.0);
  const S = 2 * L + 2.4;
  const pad = addPlat(c, { gap: r.range(1, 2.4), len: S, width: S, wp: "none", color: col(c, 6), pattern: "checker", color2: col(c, 1) });
  const f = fwd(c.f.h);
  const cx = pad.x;
  const cz = pad.z;
  // Safe perimeter route: stays outside the bar sweep radius (bars only threaten the pad centre and the shortcut).
  const rr = rgt(c.f.h);
  const side = r.sign();
  const ax = L + 0.5;
  const lat = side * (L + 0.6);
  addWp(c, pad, cx - f.x * ax, cz - f.z * ax, true);
  addWp(c, pad, cx - f.x * ax + rr.x * lat, cz - f.z * ax + rr.z * lat, true);
  addWp(c, pad, cx + f.x * ax + rr.x * lat, cz + f.z * ax + rr.z * lat, true);
  addWp(c, pad, cx + f.x * ax, cz + f.z * ax, true);
  const speed = (1.0 + 1.2 * c.d) * r.sign();
  const phase = r.range(0, Math.PI * 2);
  const nBars = c.d > 0.45 && r.chance(0.7) ? 2 : 1;
  for (let i = 0; i < nBars; i++) {
    const top = pad.y + pad.sy / 2;
    c.hazards.push({ id: c.nextId++, kind: "bar", x: cx, y: top + 0.45, z: cz, len: L, thick: 0.5, height: 0.9, speed, phase: phase + (i * Math.PI) / 2, ax: 0, az: 0, period: 1, color: i === 0 ? 0xff1a1a : 0xffe600, piece: c.piece, platform: pad.id });
  }
  c.decor.push({ kind: "cyl", x: cx, y: pad.y + pad.sy / 2 + 0.5, z: cz, sx: 0.8, sy: 1.0, sz: 0.8, rotY: 0, color: 0x222222 });
}

function pieceMover(c: Ctx) {
  const r = c.rng;
  const kind = r.pick(["ferry", "lateral", "elevator"] as const);
  const f = fwd(c.f.h);
  const period = r.range(6.2, 3.8 + (1 - c.d) * 0.0 + 0.001) + 0;
  const phase = r.range(0, Math.PI * 2);
  const s = r.range(1.2, 1.9);
  const len = r.range(3.0, 3.8);
  const per = Math.max(3.6, period);
  // entry platform (needs run-up)
  addPlat(c, { gap: r.range(0.5, 1.5), len: r.range(5, 7), width: 5, color: col(c, 3), pattern: "stripes", color2: 0xffffff });
  const y = c.f.y;
  const mcolor = col(c, 7);
  if (kind === "ferry") {
    const a = r.range(2, 4.2);
    addPlat(c, { gap: s + a, len, width: len, color: mcolor, glow: true, advance: false, move: { ax: f.x * a, ay: 0, az: f.z * a, period: per, phase }, sy: 1 });
    c.f.x += f.x * (s + 2 * a + len);
    c.f.z += f.z * (s + 2 * a + len);
  } else if (kind === "lateral") {
    const rr = rgt(c.f.h);
    const a = r.range(2, 3.6);
    addPlat(c, { gap: s, len, width: 3.2, color: mcolor, glow: true, advance: false, move: { ax: rr.x * a, ay: 0, az: rr.z * a, period: per, phase }, sy: 1 });
    c.f.x += f.x * (s + len);
    c.f.z += f.z * (s + len);
  } else {
    const a = r.range(1.6, 3.0);
    addPlat(c, { gap: s, len, width: 3.4, color: mcolor, glow: true, advance: false, move: { ax: 0, ay: a, az: 0, period: per, phase }, sy: 1 });
    c.f.x += f.x * (s + len);
    c.f.z += f.z * (s + len);
  }
  c.f.y = y;
  addPlat(c, { gap: s, len: r.range(5, 8), width: 5, color: col(c, 5), pattern: "tiles" });
}

function pieceSpheres(c: Ctx) {
  const r = c.rng;
  const W = r.range(9.6, 11);
  const rows = r.int(2, 3 + Math.round(2 * c.d));
  const rowSp = r.range(5.6, 6.6);
  const Lp = 5 + rows * rowSp;
  const pad = addPlat(c, { gap: r.range(1, 2.2), len: Lp, width: W, wp: "none", color: 0xf4f4fb, pattern: "tiles", color2: col(c, 1) });
  const f = fwd(c.f.h);
  const rr = rgt(c.f.h);
  const nx = pad.x - f.x * Lp / 2;
  const nz = pad.z - f.z * Lp / 2;
  const at = (dist: number, lat: number) => ({ x: nx + f.x * dist + rr.x * lat, z: nz + f.z * dist + rr.z * lat });
  const K = 4;
  const cw = W / K;
  const laneC = (i: number) => -W / 2 + cw * (i + 0.5);
  let lane = r.int(1, 2);
  const top = pad.y + pad.sy / 2;
  let p0 = at(1.0, laneC(lane));
  addWp(c, pad, p0.x, p0.z, true);
  for (let k = 0; k < rows; k++) {
    const dist = 3 + k * rowSp + 0.8;
    const sweeper = c.d > 0.25 && k % 2 === 1;
    if (!sweeper) {
      if (r.chance(0.55)) lane = Math.max(0, Math.min(K - 1, lane + r.sign()));
      const rad = r.range(0.85, 1.0);
      for (let i = 0; i < K; i++) {
        if (i === lane) continue;
        const pos = at(dist, laneC(i));
        c.hazards.push({ id: c.nextId++, kind: "sphere", x: pos.x, y: top + rad, z: pos.z, len: rad, thick: 0, height: rad * 2, speed: 0, phase: r.range(0, 6.28), ax: f.x * 0.9, az: f.z * 0.9, period: r.range(2.4, 3.6), color: 0xff1a1a, piece: c.piece, platform: pad.id });
      }
    } else {
      const rad = 1.0;
      const amp = W / 2 - rad - 0.2;
      const pos = at(dist, 0);
      c.hazards.push({ id: c.nextId++, kind: "sphere", x: pos.x, y: top + rad, z: pos.z, len: rad, thick: 0, height: rad * 2, speed: 0, phase: r.range(0, 6.28), ax: rr.x * amp, az: rr.z * amp, period: 4.6 - 1.6 * c.d, color: 0xff1a1a, piece: c.piece, platform: pad.id });
    }
    const w1 = at(dist - 2.0, laneC(lane));
    const w2 = at(dist + 2.0, laneC(lane));
    addWp(c, pad, w1.x, w1.z, true);
    addWp(c, pad, w2.x, w2.z, true);
  }
  const pe = at(Lp - 1.0, laneC(lane));
  addWp(c, pad, pe.x, pe.z, true);
}

function pieceZigzag(c: Ctx) {
  const r = c.rng;
  const n = r.int(6, 11);
  const w = r.range(2.3, 3.0);
  const L = (w + r.range(1.2, 2.2)) / 2;
  for (let i = 0; i < n; i++) {
    const lat = i === 0 ? L : i % 2 === 1 ? -2 * L : 2 * L;
    addPlat(c, { gap: r.range(1.4, 2.2 + c.d * 0.8), len: w, width: w, lat, color: col(c, i), pattern: i % 2 ? "tiles" : "solid", glow: i % 4 === 0 });
  }
  addPlat(c, { gap: r.range(1.2, 2), len: 4, width: 4, lat: n % 2 === 0 ? L : -L, color: col(c, 2), pattern: "stripes" });
}

function pieceBridge(c: Ctx) {
  const r = c.rng;
  const m = r.int(2, 3);
  for (let i = 0; i < m; i++) {
    const len = r.range(7, 11);
    const p = addPlat(c, { gap: i === 0 ? r.range(0.8, 1.6) : r.range(1.2, 2.2 + c.d * 0.5), len, width: 1.7, color: i % 2 ? 0xffffff : 0xff1a1a, pattern: "stripes", color2: 0x222233, sy: 0.4, narrow: true });
    const f = fwd(c.f.h);
    const rr = rgt(c.f.h);
    const top = p.y + p.sy / 2;
    for (const side of [-1, 1]) {
      for (let t = 0.6; t < len; t += 2.4) {
        const px = p.x - f.x * len / 2 + f.x * t + rr.x * side * 0.85;
        const pz = p.z - f.z * len / 2 + f.z * t + rr.z * side * 0.85;
        c.decor.push({ kind: "box", x: px, y: top + 0.7, z: pz, sx: 0.14, sy: 1.4, sz: 0.14, rotY: -c.f.h, color: 0xdddddd });
      }
      c.decor.push({ kind: "box", x: p.x + rr.x * side * 0.85, y: top + 1.4, z: p.z + rr.z * side * 0.85, sx: 0.1, sy: 0.1, sz: len, rotY: -c.f.h, color: 0xff2bd6 });
    }
  }
}

function pieceLongJump(c: Ctx, d2: number) {
  const r = c.rng;
  const n = r.int(1, 1 + Math.round(2 * d2));
  for (let i = 0; i < n; i++) {
    addPlat(c, { gap: i === 0 ? r.range(1, 2) : r.range(1.5, 2.5), len: 6.5, width: 4, color: col(c, i * 2), pattern: "checker", color2: 0xffffff });
    const g = maxGap(0, d2) * r.range(0.88, 1.0);
    addPlat(c, { gap: g, len: i === n - 1 ? 6 : 6.5, width: 4, color: col(c, i * 2 + 1), pattern: "stripes", glow: true });
  }
}

function pieceMultilevel(c: Ctx) {
  const r = c.rng;
  const n = r.int(5, 8);
  for (let i = 0; i < n; i++) {
    const dy = clampDy(c, r.pick([1.0, 0.8, -2.2, -1.5, -3, 1.1, 0, -1]));
    const gap = r.range(1.4, Math.max(1.6, maxGap(dy, c.d) * 0.92));
    addPlat(c, { gap, len: r.range(2.6, 3.8), width: r.range(2.6, 3.8), dy, lat: r.range(-1, 1), color: col(c, i + 3), sy: 2, pattern: i % 2 ? "tiles" : "solid" });
  }
}

function pieceDescent(c: Ctx) {
  const r = c.rng;
  const n = r.int(3, 5);
  for (let i = 0; i < n; i++) {
    const dy = clampDy(c, -r.range(1.8, 3.2));
    const gap = r.range(1.5, Math.min(4.8, maxGap(dy, c.d) * 0.92));
    addPlat(c, { gap, len: 3.4, width: 3.4, dy, color: col(c, i), sy: 1.2, pattern: "tiles" });
  }
}

function pieceCircles(c: Ctx) {
  const r = c.rng;
  const n = r.int(5, 9);
  for (let i = 0; i < n; i++) {
    const dy = clampDy(c, r.range(-0.6, 0.9));
    const rx = r.range(1.3, 1.9);
    const rz = rx * r.range(0.8, 1.5);
    const gap = r.range(1.4, Math.max(1.6, maxGap(dy, c.d) * 0.88));
    addPlat(c, { gap, len: rz * 2, width: rx * 2, shape: "ell", dy, lat: r.range(-1.2, 1.2), color: col(c, i), sy: 0.8, glow: r.chance(0.2) });
  }
}

function pieceTower(c: Ctx) {
  const r = c.rng;
  const n = Math.min(r.int(10, 15), Math.floor((MAXY - c.f.y) / 1.05));
  const rise = r.range(0.85, 1.05);
  const R = 4.3;
  const size = 2.5;
  const sign = r.sign();
  const dth = (((r.range(36, 44) + c.d * 8) * Math.PI) / 180) * sign;
  const gap = r.range(1.0, 2.0);
  const f = fwd(c.f.h);
  const y0 = c.f.y;
  const p0x = c.f.x + f.x * (gap + size / 2);
  const p0z = c.f.z + f.z * (gap + size / 2);
  const Cx = p0x + f.x * R;
  const Cz = p0z + f.z * R;
  const vx = -f.x * R;
  const vz = -f.z * R;
  let last: Platform | null = null;
  let lx = 0;
  let lz = 0;
  for (let i = 0; i <= n; i++) {
    const a = dth * i;
    const rx = vx * Math.cos(a) - vz * Math.sin(a);
    const rz = vx * Math.sin(a) + vz * Math.cos(a);
    const p = makePlat(c, { x: Cx + rx, z: Cz + rz, top: y0 + i * rise, sx: size, sz: size, sy: 1, rotY: Math.atan2(rx, rz), color: col(c, i + 1), pattern: i % 2 ? "tiles" : "solid" });
    c.route.push(p.id);
    addWp(c, p, p.x, p.z);
    last = p;
    lx = rx;
    lz = rz;
  }
  const topY = y0 + n * rise;
  const bottom = y0 - 6;
  const colTop = topY + 3;
  makePlat(c, { x: Cx, z: Cz, top: colTop, sx: 3.4, sz: 3.4, sy: colTop - bottom, rotY: 0, color: 0xd97a00, role: "solid" });
  c.decor.push({ kind: "box", x: Cx, y: colTop + 0.4, z: Cz, sx: 3.8, sy: 0.8, sz: 3.8, rotY: 0, color: 0xff8c00 });
  if (last) {
    const l = Math.hypot(lx, lz) || 1;
    const ox = lx / l;
    const oz = lz / l;
    c.f.h = Math.atan2(ox, -oz);
    c.f.x = last.x + ox * size / 2;
    c.f.z = last.z + oz * size / 2;
    c.f.y = topY;
  }
}

function checkpointPad(c: Ctx, role: "checkpoint" | "finish") {
  const r = c.rng;
  const finish = role === "finish";
  const size = finish ? 9 : 7;
  const p = addPlat(c, { gap: r.range(0.8, 1.8), len: size, width: size, role, wp: "none", color: finish ? 0xffe600 : 0xff2bd6, color2: finish ? 0xffffff : 0x9b30ff, pattern: "checker", glow: true, sy: 1.2 });
  addWp(c, p, p.x, p.z);
  c.cps.push({ x: p.x, y: p.y + p.sy / 2, z: p.z, wp: c.wps.length - 1, platform: p.id });
}

/* ------------------------------------------------------------------ build */

type PieceName = "straight" | "narrow" | "blocks" | "stairs" | "stairsDown" | "bars" | "mover" | "spheres" | "zigzag" | "bridge" | "longjump" | "multilevel" | "circles" | "tower" | "descent";

function runPiece(c: Ctx, name: PieceName, hard: boolean) {
  const saveD = c.d;
  if (hard) c.d = Math.min(1, c.d + 0.25);
  switch (name) {
    case "straight": pieceStraight(c); break;
    case "narrow": pieceNarrow(c); break;
    case "blocks": pieceBlocks(c); break;
    case "stairs": pieceStairs(c, false); break;
    case "stairsDown": pieceStairs(c, true); break;
    case "bars": pieceBars(c); break;
    case "mover": pieceMover(c); break;
    case "spheres": pieceSpheres(c); break;
    case "zigzag": pieceZigzag(c); break;
    case "bridge": pieceBridge(c); break;
    case "longjump": pieceLongJump(c, c.d); break;
    case "multilevel": pieceMultilevel(c); break;
    case "circles": pieceCircles(c); break;
    case "tower": pieceTower(c); break;
    case "descent": pieceDescent(c); break;
  }
  c.d = saveD;
  c.types.push(name);
}

function cornerPad(c: Ctx) {
  const r = c.rng;
  const angle = r.pick([90, 90, -90, -90, 60, -60, 45, -45]) * (Math.PI / 180);
  const size = 4.6;
  const square = Math.abs(Math.abs(angle) - Math.PI / 2) < 0.01;
  const oldH = c.f.h;
  const p = addPlat(c, { gap: r.range(0.8, 1.6), len: size, width: size, shape: square ? "box" : "ell", color: col(c, 5), pattern: "tiles", color2: col(c, 1), glow: true, advance: false });
  c.f.h = oldH + angle;
  const nf = fwd(c.f.h);
  c.f.x = p.x + nf.x * size / 2;
  c.f.z = p.z + nf.z * size / 2;
  c.f.y = p.y + p.sy / 2;
}

function build(id: number, attempt: number, simple: boolean): Stage {
  const baseSeed = stageSeed(id);
  const seed = (baseSeed + Math.imul(attempt, 0x9e3779b1)) >>> 0;
  const rng = makeRng(seed);
  const d = Math.min(1, 0.1 + 0.9 * Math.min(1, (id - 1) / 600));
  const c: Ctx = { rng, d, f: { x: 0, y: 0, z: 0, h: 0 }, plats: [], hazards: [], decor: [], wps: [], route: [], cps: [], piece: 0, colorBase: rng.int(0, 7), types: [], nextId: 1 };

  // start pad
  const start = makePlat(c, { x: 0, z: 0, top: 0, sx: 8, sz: 8, sy: 1.2, rotY: 0, color: 0x00e5ff, color2: 0xffffff, pattern: "checker", role: "start", glow: true });
  c.route.push(start.id);
  addWp(c, start, 0, 0);
  c.cps.push({ x: 0, y: 0, z: 0, wp: 0, platform: start.id });
  c.f = { x: 0, y: 0, z: -4, h: 0 };

  const nPieces = simple ? 5 : Math.round(8 + d * 8 + rng.range(0, 3));
  let since = 0;
  let prev = "";
  const finalPool: PieceName[] = simple ? ["straight"] : ["longjump", "narrow", "zigzag", "bars", "spheres", "mover", "multilevel", "circles"];
  for (let i = 0; i < nPieces; i++) {
    const final = i === nPieces - 1;
    c.piece++;
    let name: PieceName;
    if (final) name = rng.pick(finalPool);
    else {
      const y = c.f.y;
      const table: [PieceName, number][] = simple
        ? [["straight", 2], ["blocks", 2], ["stairs", 1]]
        : [
            ["straight", 1.2], ["narrow", 1.0 + d], ["blocks", 1.6], ["stairs", y < 12 ? 1.2 : 0], ["stairsDown", y > 5 ? 2.5 : 0],
            ["bars", d > 0.1 ? 0.9 : 0], ["mover", d > 0.05 ? 1.0 : 0], ["spheres", d > 0.15 ? 0.9 : 0], ["zigzag", 1.2], ["bridge", 0.8],
            ["longjump", 0.7 + d], ["multilevel", 1.0], ["circles", 1.0], ["tower", y < 4 && i > 1 ? 0.7 : 0], ["descent", y > 3 ? 2.5 + y / 4 : 0],
          ];
      const usable = table.filter(([n, w]) => w > 0 && n !== prev);
      const total = usable.reduce((s, [, w]) => s + w, 0);
      let pick = rng.next() * total;
      name = usable[0][0];
      for (const [n, w] of usable) {
        pick -= w;
        if (pick <= 0) {
          name = n;
          break;
        }
      }
    }
    runPiece(c, name, final);
    prev = name;
    since++;
    if (!final && since >= 3) {
      checkpointPad(c, "checkpoint");
      since = 0;
    } else if (!final && rng.chance(0.3 + 0.3 * d) && name !== "straight") {
      cornerPad(c);
    }
  }
  checkpointPad(c, "finish");

  let minTop = Infinity;
  for (const p of c.plats) minTop = Math.min(minTop, p.y + p.sy / 2 - (p.move ? Math.abs(p.move.ay) : 0));
  const fp = hashString(
    c.plats.map((p) => `${p.shape[0]}${p.x.toFixed(1)},${p.y.toFixed(1)},${p.z.toFixed(1)},${p.sx.toFixed(1)},${p.sz.toFixed(1)}`).join("|") +
      c.hazards.map((h) => `${h.kind}${h.x.toFixed(1)},${h.z.toFixed(1)}`).join("|"),
  );
  return {
    id,
    seed: baseSeed,
    name: `${THEMES[(id * 7 + c.colorBase) % THEMES.length]} #${id}`,
    difficulty: d,
    fingerprint: fp,
    platforms: c.plats,
    hazards: c.hazards,
    decor: c.decor,
    waypoints: c.wps,
    route: c.route,
    checkpoints: c.cps,
    pieceTypes: c.types,
    start: { x: 0, y: 0, z: 0, heading: 0 },
    killY: minTop - 16,
    validation: { ok: false, issues: [], edges: 0, maxGap: 0, attempts: 0 },
  };
}

const cache = new Map<number, Stage>();

/** Deterministically generates (and validates) stage `id` (>=1). Unlimited ids are supported. */
export function generateStage(id: number): Stage {
  id = Math.max(1, Math.floor(id));
  const hit = cache.get(id);
  if (hit) return hit;
  let last: Stage | null = null;
  for (let attempt = 0; attempt < 90; attempt++) {
    const simple = attempt >= 60;
    const s = build(id, attempt, simple);
    const v = validateStage(s);
    v.attempts = attempt + 1;
    s.validation = v;
    last = s;
    if (v.ok) break;
  }
  const stage = last as Stage;
  cache.set(id, stage);
  if (cache.size > 40) {
    const first = cache.keys().next().value;
    if (first !== undefined) cache.delete(first);
  }
  return stage;
}
