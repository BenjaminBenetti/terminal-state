// Task studio-refinement-batch-20261113-035659-01 (lane DROPS; user: "Multi-item inventory drops: modest bounded scatter instead of one
// coincident point, using valid floor positions without passing through walls. Preserve normal stacks, rounds, quantities, UIDs and
// ownership."): WHERE dropped inventory stacks lie. Pure placement (no three.js scene, no item state): Game.dropRef and the riding drop
// (world/trainCargo.ts dropRiding) pick their spots here and place the SAME stacks they did before — a dropped stack of 7 is still one
// pickup of 7 with its uid / rounds / contents; only a fuel-can stack lies as single cans (as before), each on its own spot.
//
// THE DROP POINT is today's: 0.9 m along the view on the player's own storey and floor (within 0.45 m), in sight of the player (Levels
// line of sight: walls, slabs, closed lift gates, sight-blocking props), no railing crossed — else the player's own x / z. New: no solid
// collider box at knee height (Game.propIndex: walls of the parked car, its partitions and door leaves, counters, crates) lies between the
// player and the spot either (Levels does not know the car's shell).
// THE SCATTER: successive drops (a drag-out of several stacks, the cans of one stack) take the first spot of a small fixed pattern round
// that point — the point itself, then a ring of 6 at 0.26 m (the old fuel-can row's step: a 2-can stack lies as before) and a ring of 10
// at 0.4 m (never past DROP_SCATTER.radius), turned with the heading, the spots back toward the player first — that passes the SAME
// validity rule and has no pickup lying within `spacing` of it (any ground pickup: the earlier drops, loot already there). All taken: the
// valid spot farthest from its nearest pickup. None valid: the drop point. Ownership stays by position (world/trainCargo.ts: inside the
// parked car = the train's), decided where each pickup lies.

/** Tuning (one place). */
export const DROP_SCATTER = {
  /** Today's drop point: along the view (m), the floor within `step` of the player's (m). */
  ahead: 0.9, step: 0.45,
  /** The pattern's rings (radius m, spots); every spot within `radius` of the drop point. */
  rings: [[0.26, 6], [0.4, 10]] as readonly (readonly [number, number])[],
  radius: 0.4,
  /** A pickup nearer than this (m, horizontal; within `dy` m vertically: not another storey's) occupies a spot. */
  spacing: 0.2, dy: 0.6,
  /** The no-collider rule: boxes spanning `knee` m above the player's floor (below `under` m from it) block; the item's own half size. */
  knee: 0.3, under: 0.6, itemR: 0.03,
} as const;

export interface V3 { x: number; y: number; z: number }

const D = DROP_SCATTER;
const cache = new Map<number, readonly (readonly [number, number])[]>();

/**
 * The pattern's offsets (x, z; m) round a drop point for a heading `yaw` (Player.yaw: forward = (-sin, -cos)): the point itself, then each
 * ring starting straight back toward the player and alternating left / right round to the far side. Deterministic.
 */
export function scatterOffsets(yaw: number): readonly (readonly [number, number])[] {
  const key = Math.round(yaw * 1e4);
  const hit = cache.get(key);
  if (hit) return hit;
  const out: [number, number][] = [[0, 0]];
  const back = Math.atan2(Math.sin(yaw), Math.cos(yaw)); // (the back direction (sin, cos) has this angle in atan2(x, z) terms)
  for (const [r, m] of D.rings) {
    const step = 2 * Math.PI / m;
    for (let k = 0; k < m; k++) {
      const j = k === 0 ? 0 : (k % 2 ? 1 : -1) * Math.ceil(k / 2); // 0, +1, -1, +2, -2, …
      const a = back + j * step;
      out.push([Math.sin(a) * r, Math.cos(a) * r]);
    }
  }
  if (cache.size > 512) cache.clear();
  cache.set(key, out);
  return out;
}

/** The horizontal distance from `s` to the nearest of `occupied` on its storey (Infinity: none). */
function gapTo(s: V3, occupied: readonly V3[]): number {
  let g = Infinity;
  for (const o of occupied) if (Math.abs(o.y - s.y) < D.dy) g = Math.min(g, Math.hypot(o.x - s.x, o.z - s.z));
  return g;
}

/**
 * The scatter round (x, z): the first pattern spot `spot` accepts (null = invalid there; else the spot as it lies) with no `occupied` point
 * within `spacing`; all occupied: the valid one farthest from its nearest occupied point; none valid: null.
 */
export function pickScatter(x: number, z: number, yaw: number, spot: (x: number, z: number) => V3 | null, occupied: readonly V3[]): V3 | null {
  let best: V3 | null = null, bestGap = -1;
  for (const [ox, oz] of scatterOffsets(yaw)) {
    const s = spot(x + ox, z + oz);
    if (!s) continue;
    const g = gapTo(s, occupied);
    if (g >= D.spacing) return s;
    if (g > bestGap) { bestGap = g; best = s; }
  }
  return best;
}

interface PropBox { x: number; y: number; z: number; hx: number; hz: number; h: number; round?: boolean }

/** What a ground drop reads of the world (Game: levels, the layout's grid, propIndex). */
export interface DropWorld {
  levels: {
    count: number;
    supportIn(x: number, z: number, y: number): {level: number; floor: number} | null;
    grid(level: number): {passable(cx: number, cy: number): boolean};
    lineOfSight(a: V3, b: V3): boolean;
    railCrosses(ax: number, az: number, bx: number, bz: number, r: number, feet: number): boolean;
    stepAt(x: number, z: number, y: number): number;
  };
  grid: {
    cellOf(x: number, z: number): [number, number];
    passable(cx: number, cy: number): boolean;
    floorAt(x: number, z: number): number;
    lineOfSight(ax: number, az: number, bx: number, bz: number): boolean;
    stepAt(x: number, z: number): number;
  };
  propIndex?: {near(x0: number, z0: number, x1: number, z1: number, out: Set<number>): Set<number>; props: readonly PropBox[]} | null;
}

/** A solid collider box at knee height lies on the line from the player's feet to (x, z) (sampled every 0.1 m, the end included). */
function crossesSolid(w: DropWorld, p: V3, x: number, z: number): boolean {
  const pi = w.propIndex;
  if (!pi) return false;
  const r = D.itemR, dx = x - p.x, dz = z - p.z, n = Math.max(1, Math.ceil(Math.hypot(dx, dz) / 0.1));
  const ids = pi.near(Math.min(p.x, x) - r, Math.min(p.z, z) - r, Math.max(p.x, x) + r, Math.max(p.z, z) + r, new Set());
  for (const i of ids) {
    const q = pi.props[i];
    if (!q || q.h <= 0.02 || q.y > p.y + D.under || q.y + q.h < p.y + D.knee) continue; // (a curb / rug underfoot or an overhead: no wall)
    for (let k = 1; k <= n; k++) {
      const sx = p.x + dx * k / n, sz = p.z + dz * k / n;
      if (q.round ? (sx - q.x) ** 2 + (sz - q.z) ** 2 < (q.hx + r) ** 2 : Math.abs(sx - q.x) < q.hx + r && Math.abs(sz - q.z) < q.hz + r) return true;
    }
  }
  return false;
}

/**
 * The spots (world; y = the floor / tread there) of `n` pickups dropped by the player now (Game.dropRef: one stack = 1, a fuel-can stack =
 * its cans): the drop point and the scatter round it (see the header). `occupied`: the ground pickups' positions (each spot taken here
 * counts for the next).
 */
export function groundDropSpots(w: DropWorld, p: V3 & {yaw: number}, f: V3, n: number, occupied: readonly V3[]): V3[] {
  const L = w.levels, g = w.grid;
  const height = (x: number, z: number): number => {
    if (L.count > 1) { const y = L.stepAt(x, z, p.y + 0.05); return Number.isFinite(y) ? y : p.y; }
    return g.stepAt(x, z);
  };
  // today's validity (Lane B / Lane T) + no collider crossed
  const spot = (x: number, z: number): V3 | null => {
    if (L.count > 1) {
      const s = L.supportIn(x, z, p.y + 0.05);
      if (!s || !L.grid(s.level).passable(...g.cellOf(x, z)) || Math.abs(s.floor - p.y) > D.step) return null;
      if (!L.lineOfSight({x: p.x, y: p.y + 0.6, z: p.z}, {x, y: p.y + 0.6, z}) || L.railCrosses(p.x, p.z, x, z, 0.05, p.y)) return null;
    } else if (!g.passable(...g.cellOf(x, z)) || Math.abs(g.floorAt(x, z) - p.y) > D.step || !g.lineOfSight(p.x, p.z, x, z)) return null;
    if (crossesSolid(w, p, x, z)) return null;
    return {x, y: height(x, z), z};
  };
  const base = spot(p.x + f.x * D.ahead, p.z + f.z * D.ahead) ?? {x: p.x, y: height(p.x, p.z), z: p.z};
  const near = occupied.filter(o => Math.abs(o.x - base.x) < 1.5 && Math.abs(o.z - base.z) < 1.5).map(o => ({x: o.x, y: o.y, z: o.z}));
  const out: V3[] = [];
  for (let k = 0; k < n; k++) {
    const s = pickScatter(base.x, base.z, p.yaw, spot, near) ?? {...base};
    out.push(s);
    near.push(s);
  }
  return out;
}
