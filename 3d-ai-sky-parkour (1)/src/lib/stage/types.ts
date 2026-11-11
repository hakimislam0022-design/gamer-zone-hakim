export type Pattern = "solid" | "checker" | "road" | "stripes" | "tiles";

export interface MoveSpec {
  ax: number;
  ay: number;
  az: number;
  period: number;
  phase: number;
}

export interface Platform {
  id: number;
  shape: "box" | "ell";
  /** centre */
  x: number;
  y: number;
  z: number;
  /** full sizes (ell: sx/sz are the diameters) */
  sx: number;
  sy: number;
  sz: number;
  rotY: number;
  color: number;
  color2: number;
  pattern: Pattern;
  glow?: boolean;
  move?: MoveSpec;
  piece: number;
  role: "start" | "checkpoint" | "finish" | "normal" | "solid";
}

export interface Hazard {
  id: number;
  kind: "bar" | "sphere";
  x: number;
  y: number;
  z: number;
  /** bar: half length. sphere: radius */
  len: number;
  thick: number;
  height: number;
  /** bar: angular speed (rad/s) */
  speed: number;
  phase: number;
  /** sphere oscillation amplitude vector (world) */
  ax: number;
  az: number;
  period: number;
  color: number;
  piece: number;
  platform: number;
}

export interface Decor {
  kind: "box" | "cyl" | "sphere";
  x: number;
  y: number;
  z: number;
  sx: number;
  sy: number;
  sz: number;
  rotY: number;
  color: number;
}

export interface Waypoint {
  x: number;
  y: number;
  z: number;
  platform: number;
  /** precision walking: slow down, follow line */
  narrow?: boolean;
}

export interface Checkpoint {
  x: number;
  y: number;
  z: number;
  wp: number;
  platform: number;
}

export interface StageValidation {
  ok: boolean;
  issues: string[];
  edges: number;
  maxGap: number;
  attempts: number;
}

export interface Stage {
  id: number;
  seed: number;
  name: string;
  difficulty: number;
  fingerprint: string;
  platforms: Platform[];
  hazards: Hazard[];
  decor: Decor[];
  waypoints: Waypoint[];
  route: number[];
  checkpoints: Checkpoint[];
  pieceTypes: string[];
  start: { x: number; y: number; z: number; heading: number };
  killY: number;
  validation: StageValidation;
}

export function movePos(p: { x: number; y: number; z: number; move?: MoveSpec }, t: number) {
  const m = p.move;
  if (!m) return { x: p.x, y: p.y, z: p.z };
  const s = Math.sin((t / m.period) * Math.PI * 2 + m.phase);
  return { x: p.x + m.ax * s, y: p.y + m.ay * s, z: p.z + m.az * s };
}

export function spherePos(h: Hazard, t: number) {
  const s = Math.sin((t / (h.period || 1)) * Math.PI * 2 + h.phase);
  return { x: h.x + h.ax * s, y: h.y, z: h.z + h.az * s };
}

export function barAngle(h: Hazard, t: number) {
  return h.phase + h.speed * t;
}
