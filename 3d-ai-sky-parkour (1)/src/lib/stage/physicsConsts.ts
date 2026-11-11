/** Physics constants shared by the game engine, the stage generator and the validator. */
export const PHYS = {
  runSpeed: 9,
  jumpSpeed: 11,
  gravity: 28,
  radius: 0.32,
  height: 2.7,
  stepUp: 0.35,
  groundAccel: 70,
  airAccel: 30,
  coyote: 0.1,
  buffer: 0.12,
};

/** Time from jump takeoff until the character is back at height `dy` relative to takeoff (descending branch). */
export function airTime(dy: number): number {
  const disc = PHYS.jumpSpeed * PHYS.jumpSpeed - 2 * PHYS.gravity * dy;
  if (disc < 0) return 0;
  return (PHYS.jumpSpeed + Math.sqrt(disc)) / PHYS.gravity;
}

export function reach(dy: number, speed: number): number {
  return airTime(dy) * speed;
}

/** Conservative horizontal edge-to-edge distance that a jump can always cross. */
export function safeReach(dy: number): number {
  return Math.min(6.6, reach(dy, 8.2) * 0.8);
}

/** Generator limit for a gap at difficulty d (0..1). Always <= safeReach. */
export function maxGap(dy: number, d: number): number {
  return safeReach(dy) * (0.62 + 0.38 * d);
}

export function runupNeeded(gap: number): number {
  return Math.max(0, (gap - 3.2) * 1.6);
}

export const MAX_RISE = 1.35;
