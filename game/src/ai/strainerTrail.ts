// Task studio-alpha-strainer-lumbering-wetness-20261101-01 (user playtest: "should leave a trail of wet shine behind him"): the
// Strainer's wet-shine trail driver. While a Strainer actually walks, every STRAINER_TRAIL.spacingM of travel drops ONE wet film
// (world/fx.ts WET_TRAIL: a fixed instanced ring, one draw call, each mark fading out; the oldest is recycled) flat on the floor it
// stands on — the brain's own floor height, so every storey / stair landing / track bed gets its own marks — alternating left /
// right foot, a little behind the feet. Purely visual: no water physics, no slip, no damage, no global wetting.

/** Spacing (m of travel per mark), side offset of a footfall, how far behind the root it lands, and the mark size (m). */
export const STRAINER_TRAIL = {spacingM: 0.6, sideM: 0.17, behindM: 0.2, size: [0.42, 0.62] as const, liftM: 0.004} as const;

interface TrailBrain { x: number; y: number; z: number; yaw: number; alive: boolean; state: string }
interface TrailState { x: number; z: number; d: number; foot: number }

/** States in which the body is not walking on its own feet (no new marks). */
const STILL = new Set(['dead', 'climb', 'stagger']);

export class StrainerWetTrail {
  private readonly last = new WeakMap<object, TrailState>();

  /**
   * One step for one Strainer (call after its motor moved it). `drop(x, y, z, size)` places a mark; `rand` sizes it. Returns the
   * marks dropped this step (0 or a few after a long teleport-free move; never unbounded: at most 4 per call).
   */
  step(key: object, b: TrailBrain, ragdolled: boolean, drop: (x: number, y: number, z: number, size: number) => void, rand: () => number): number {
    let s = this.last.get(key);
    if (!s) { this.last.set(key, (s = {x: b.x, z: b.z, d: 0, foot: 0})); return 0; }
    const dx = b.x - s.x, dz = b.z - s.z, moved = Math.hypot(dx, dz);
    s.x = b.x; s.z = b.z;
    if (!b.alive || ragdolled || STILL.has(b.state) || moved > 3) { s.d = 0; return 0; } // (a > 3 m jump is a placement, not a walk)
    s.d += moved;
    let n = 0;
    const T = STRAINER_TRAIL, fx = Math.sin(b.yaw), fz = Math.cos(b.yaw);
    while (s.d >= T.spacingM && n < 4) {
      s.d -= T.spacingM;
      const side = s.foot ? -1 : 1;
      s.foot ^= 1;
      // root forward is +Z rotated by yaw; the footfall lands a little behind the root, on the stepping side
      const x = b.x - fx * T.behindM + fz * T.sideM * side, z = b.z - fz * T.behindM - fx * T.sideM * side;
      drop(x, b.y + T.liftM, z, T.size[0] + (T.size[1] - T.size[0]) * rand());
      n++;
    }
    return n;
  }
}
