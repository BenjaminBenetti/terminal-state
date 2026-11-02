// Task reactor-expansion-20261101 (lane GASLIGHT): THE REACTOR PIT'S LAMPS — every lamp is a REAL, MOUNTED fixture, and the pit top is
// OPEN to the sky. User: "something is really wrong with the lights on the walls. They often have like an orange circle on them … but
// no light" and "there are lights floating in the air, around player level".
//
// Root causes (the previous build):
//  - the kit (world/reactor/archKit.ts KitPlan.lamp) drew ~260 DECORATIVE lamps (pit walls, deck edges, towers, pipe catwalks, ring
//    gantries) whose lens was an unlit per-tier material held at an emergency 28 % orange before the restart — none of them was a
//    fixture in the baked light field, so they glowed orange and lit nothing;
//  - the fixtures that DID cast (gen/reactor/structure.ts deckLights + the station dresser's stair-core lights over the pit runs) hung
//    on a 0.44 m rod from nothing: 2.6 m over bridges / landings, over the core ring, and some stair-core ones at heights computed from
//    a stair area's ceiling (rim + 3 m, even 30+ m above the rim).
// Now (applied once after layout.reactor is built; reactor layouts only, nothing else reads it):
//  - every non-virtual fixture inside the pit outline is replaced by MOUNTED lamps: WALL lamps on the pit walls of every storey (a
//    bracket between the pilasters, clear of the openings / rooms behind, the pipe banks, the fans and any walkway or flight passing at
//    the lamp — no head ever clips one) and POST lamps on the free-standing decks (bridges, tower decks: a post on the rail line, the
//    head over the walkway). `mount` records where (world/reactor/gaslightFixtures.ts draws the bracket / post / cage; the fixture's
//    tube instance is the lens, so the glass glows exactly as the fixture's baked light does);
//  - the circuit contract is kept: the rim on station power, a steady dim emergency lamp every POWERED_EMERGENCY_EVERY-th lamp and at
//    the generator / stair landings, the rest on the POWERED circuit 2 (`dying`: held at 0 until the restart, ramped at the win);
//  - the OPEN ROOF: levels[0].sky (gen/levels.ts LevelSky) at the pit roof line — the pit's roof slab is not built, rays leave into the
//    sky above it (world/reactor/gaslightSky.ts draws the toxic sky and the outdoor gas; world/gaslightRules.ts the gas above it).
// Deterministic (hash of the position, no RNG draws): the rest of the generator's output is unchanged.

import {CELL, FLOOR, SOLID, type Grid} from '../grid';
import type {LightMount, LightPlacement, StationLayout} from '../stationTypes';
import type {ReactorInfo} from './reactorTypes';
import {POWERED_EMERGENCY_EVERY} from './structure';
import {railedAt} from './pathsGen'; // task reactor-expansion-20261101 (lane PATHS)

/** Every lamp tunable (m). */
export const PIT_LAMPS = {
  /** Wall lamp head height above its storey's deck (below the painted tier band at +3.0) and its reach out of the wall. */
  wallY: 2.55, wallOut: 0.38,
  /** Pilaster pitch (world/reactor/archKit.ts KIT.ribPitch: lamps sit midway between the pilasters) and the corner clearance. */
  ribPitch: 7, corner: 1.2,
  /** A walkway / flight whose floor lies in (head - clearBelow, head + clearAbove) at the lamp clips it: no lamp there. */
  clearBelow: 2.2, clearAbove: 0.7,
  /** Post lamps on free-standing decks: pitch along the deck, head height above it, arm reach over the walkway, inset from the edge. */
  postPitch: 9, postY: 2.5, postArm: 0.5, postInset: 0.05,
  /** Keep-outs: fan centre radius, pipe-bank wall reach. */
  fanClear: 2.3, bankClear: 1.0,
  /** Emergency (steady) lamps near a generator use point / a stair link end (m), and their power. */
  genNear: 5, linkNear: 4, emergency: [0.5, 0.62] as readonly [number, number],
  /** Powered / rim lamp power range. */
  powered: [0.82, 1] as readonly [number, number],
} as const;

/** What planPitLamps did (QA / tests). */
export interface PitLampStats { removed: number; wall: number; post: number; steady: number; dying: number; skipped: Record<string, number> }

const r3 = (v: number) => Math.round(v * 1000) / 1000;
const hash = (x: number, y: number, z: number): number => {
  let h = Math.imul(Math.round(x * 100) | 0, 73856093) ^ Math.imul(Math.round(y * 100) | 0, 19349663) ^ Math.imul(Math.round(z * 100) | 0, 83492791);
  h = Math.imul(h ^ (h >>> 13), 0x5bd1e995);
  return ((h ^ (h >>> 15)) >>> 0) / 4294967296;
};

/** Point in the pit outline (convex / rectilinear polygon; even-odd). */
export function inOutline(P: readonly {x: number; z: number}[], x: number, z: number): boolean {
  let inside = false;
  for (let i = 0, j = P.length - 1; i < P.length; j = i++) {
    const a = P[i], b = P[j];
    if ((a.z > z) !== (b.z > z) && x < ((b.x - a.x) * (z - a.z)) / (b.z - a.z) + a.x) inside = !inside;
  }
  return inside;
}

/** Outline edges with their inward normal (world/reactor/archKit.ts pitEdges, duplicated: gen must not import world code). */
function edgesOf(info: ReactorInfo): {a: {x: number; z: number}; b: {x: number; z: number}; nx: number; nz: number; len: number}[] {
  const P = info.pit.outline, out: ReturnType<typeof edgesOf> = [];
  for (let i = 0; i < P.length; i++) {
    const a = P[i], b = P[(i + 1) % P.length];
    const ex = b.x - a.x, ez = b.z - a.z, len = Math.hypot(ex, ez);
    if (len < 0.5) continue;
    let nx = -ez / len, nz = ex / len;
    const mx = (a.x + b.x) / 2, mz = (a.z + b.z) / 2;
    if (nx * (info.pit.cx - mx) + nz * (info.pit.cz - mz) < 0) { nx = -nx; nz = -nz; }
    out.push({a, b, nx, nz, len});
  }
  return out;
}

const isOpen = (g: Grid, i: number) => g.cells[i] !== SOLID;
const bandOf = (g: Grid, i: number): [number, number] => [g.floorOf(i), g.hasCeil(i) ? g.ceil[i] : Infinity];

/**
 * Replace every fixture inside the pit outline by mounted lamps, and open the pit top (levels[0].sky). Needs layout.reactor. Returns
 * the stats (also kept on the layout object for QA as a non-enumerable property).
 */
export function planPitLamps(layout: StationLayout): PitLampStats {
  const info = layout.reactor!;
  const st: PitLampStats = {removed: 0, wall: 0, post: 0, steady: 0, dying: 0, skipped: {}};
  const skip = (why: string) => { st.skipped[why] = (st.skipped[why] ?? 0) + 1; };
  const P = info.pit.outline, levels = layout.levels;
  // 1. the old pit fixtures (floating rods, stair-core lights at stair-area heights, the deck lamps) go
  const before = layout.lights.length;
  layout.lights = layout.lights.filter(l => l.virtual || !inOutline(P, l.x, l.z));
  st.removed = before - layout.lights.length;
  const add: {l: LightPlacement; near: boolean}[] = [];
  const cellIdx = (g: Grid, x: number, z: number): number => { const [cx, cy] = g.cellOf(x, z); return g.inBounds(cx, cy) ? g.idx(cx, cy) : -1; };
  /** The level whose open band holds a lamp head at (x, y, z) (preferring `want`), or -1. */
  const levelFor = (x: number, y: number, z: number, want: number): number => {
    const order = [want, ...levels.map(l => l.id).filter(id => id !== want)];
    for (const id of order) {
      const g = levels[id]?.grid;
      if (!g) continue;
      const i = cellIdx(g, x, z);
      if (i < 0 || !isOpen(g, i)) continue;
      const [f, c] = bandOf(g, i);
      if (f <= y - 0.3 && c >= y + 0.25) return id;
    }
    return -1;
  };
  /** A walkway / stair flight passes at the lamp head (any storey): its floor in (y - clearBelow, y + clearAbove). */
  const clips = (x: number, y: number, z: number): boolean => {
    for (const L of levels) {
      const g = L.grid, i = cellIdx(g, x, z);
      if (i < 0 || g.cells[i] !== FLOOR) continue;
      const f = g.floorAt(x, z);
      if (f > y - PIT_LAMPS.clearBelow && f < y + PIT_LAMPS.clearAbove) return true;
    }
    return false;
  };
  /** Something open behind the wall at that height (a doorway, a room, a passage): no wall to mount on. */
  const opening = (x: number, y: number, z: number): boolean => {
    for (const L of levels) {
      const g = L.grid, i = cellIdx(g, x, z);
      if (i < 0 || !isOpen(g, i)) continue;
      const [f, c] = bandOf(g, i);
      if (f <= y + 0.4 && c >= y - 0.6) return true;
    }
    return false;
  };
  const nearFan = (x: number, y: number, z: number) => info.fans.some(f => Math.hypot(f.x - x, f.y - y, f.z - z) < PIT_LAMPS.fanClear + f.radius * 0.5);
  const onBank = (x: number, y: number, z: number) => info.pipeBanks.some(b => {
    if (y < b.y0 - 0.5 || y > b.y1 + 0.5) return false;
    const ex = b.x1 - b.x0, ez = b.z1 - b.z0, L2 = ex * ex + ez * ez;
    const t = L2 > 1e-6 ? Math.max(0, Math.min(1, ((x - b.x0) * ex + (z - b.z0) * ez) / L2)) : 0;
    return Math.hypot(b.x0 + ex * t - x, b.z0 + ez * t - z) < PIT_LAMPS.bankClear + b.depth;
  });
  const nearKey = (lv: number, x: number, z: number): boolean =>
    info.generators.some(g => g.level === lv && Math.hypot(g.use.x - x, g.use.z - z) < PIT_LAMPS.genNear)
    || layout.levelLinks.some(k => (k.lower === lv && Math.hypot(k.bottom.x - x, k.bottom.z - z) < PIT_LAMPS.linkNear) || (k.upper === lv && Math.hypot(k.top.x - x, k.top.z - z) < PIT_LAMPS.linkNear));
  const push = (lv: number, x: number, y: number, z: number, rot: number, mount: LightMount) => {
    const g = levels[lv].grid, i = cellIdx(g, x, z);
    const l: LightPlacement = {x: r3(x), y: r3(y), z: r3(z), rot: r3(rot), area: i >= 0 ? Math.max(0, g.area[i]) : 0, broken: false, flicker: false, warm: true, power: 1, dying: false, mount};
    if (lv) l.level = lv;
    add.push({l, near: lv > 0 && nearKey(lv, x, z)});
  };

  // 2. WALL lamps: every storey, every pit wall, midway between the pilasters
  const tiers = [...info.tiers].sort((a, b) => b.baseY - a.baseY);
  for (const t of tiers) {
    const y = t.baseY + PIT_LAMPS.wallY;
    for (const e of edgesOf(info)) {
      const tx = (e.b.x - e.a.x) / e.len, tz = (e.b.z - e.a.z) / e.len;
      const nR = Math.max(1, Math.round(e.len / PIT_LAMPS.ribPitch));
      for (let k = 0; k < nR; k++) {
        const s = (e.len * (k + 0.5)) / nR;
        if (s < PIT_LAMPS.corner || s > e.len - PIT_LAMPS.corner) { skip('corner'); continue; }
        const wx = e.a.x + tx * s, wz = e.a.z + tz * s;
        const hx = wx + e.nx * PIT_LAMPS.wallOut, hz = wz + e.nz * PIT_LAMPS.wallOut;
        if (opening(wx - e.nx * 0.25, y, wz - e.nz * 0.25)) { skip('opening'); continue; }
        if (clips(hx, y, hz) || clips(wx + e.nx * 0.8, y, wz + e.nz * 0.8)) { skip('walkway'); continue; }
        if (nearFan(wx, y, wz)) { skip('fan'); continue; }
        if (onBank(wx, y, wz)) { skip('pipe bank'); continue; }
        const lv = levelFor(hx, y - 0.15, hz, t.level);
        if (lv < 0) { skip('band'); continue; }
        push(lv, hx, y - 0.15, hz, Math.atan2(-tz, tx), {kind: 'wall', x: r3(wx), y: r3(y), z: r3(wz), nx: r3(e.nx), nz: r3(e.nz)});
        st.wall++;
      }
    }
  }
  // 3. POST lamps on the free-standing decks (bridges across the pit, tower decks): on the rail line, the head over the walkway
  for (const d of info.decks) {
    if (d.kind !== 'bridge' && d.kind !== 'tower') continue;
    const r = d.rect, alongX = r.x1 - r.x0 >= r.z1 - r.z0;
    const len = alongX ? r.x1 - r.x0 : r.z1 - r.z0;
    const n = Math.max(1, Math.round(len / PIT_LAMPS.postPitch));
    for (let k = 0; k < n; k++) {
      const s = (len * (k + 0.5)) / n, side = k % 2 === 0 ? -1 : 1;
      // the foot on the edge (inset), the arm reaching back over the deck
      let fx = alongX ? r.x0 + s : side < 0 ? r.x0 + PIT_LAMPS.postInset : r.x1 - PIT_LAMPS.postInset;
      let fz = alongX ? (side < 0 ? r.z0 + PIT_LAMPS.postInset : r.z1 - PIT_LAMPS.postInset) : r.z0 + s;
      // task reactor-expansion-20261101 (lane PATHS, audit): the post stands on a RAILED stretch of the edge — the middle of a tower
      // deck's edge is the bridge's open entry (the post stood in the walkway): slide along the edge to the nearest railed point
      const onRail = (o: number) => railedAt(layout, d.level, alongX ? fx + o : fx, alongX ? fz : fz + o, d.y);
      const slide = [0, 0.5, -0.5, 1, -1, 1.5, -1.5, 2, -2].find(o => s + o >= 0.3 && s + o <= len - 0.3 && onRail(o - 0.15) && onRail(o + 0.15));
      if (slide === undefined) { skip('post off rail'); continue; }
      if (alongX) fx += slide; else fz += slide;
      const nx = alongX ? 0 : -side, nz = alongX ? -side : 0;
      const hx = fx + nx * PIT_LAMPS.postArm, hz = fz + nz * PIT_LAMPS.postArm, hy = d.y + PIT_LAMPS.postY;
      const lv = levelFor(hx, hy, hz, d.level);
      if (lv < 0) { skip('post band'); continue; }
      if (nearFan(hx, hy, hz)) { skip('fan'); continue; }
      push(lv, hx, hy, hz, alongX ? 0 : Math.PI / 2, {kind: 'post', x: r3(fx), y: r3(d.y), z: r3(fz), nx, nz});
      st.post++;
    }
  }
  // 4. circuits: the rim on station power; emergency (steady, dim) every POWERED_EMERGENCY_EVERY-th lamp and at the generator / stair
  //    landings; the rest on the POWERED circuit 2 (held dark until the restart)
  add.forEach(({l, near}, k) => {
    const lv = l.level ?? 0, h = hash(l.x, l.y, l.z);
    const lerp = (r: readonly [number, number]) => r3(r[0] + (r[1] - r[0]) * h);
    if (lv === 0) { l.power = lerp(PIT_LAMPS.powered); st.steady++; }
    else if (near || k % POWERED_EMERGENCY_EVERY === 1) { l.power = lerp(PIT_LAMPS.emergency); st.steady++; }
    else { l.power = lerp(PIT_LAMPS.powered); l.dying = true; st.dying++; }
    layout.lights.push(l);
  });
  // 5. THE OPEN ROOF: the rim storey is an open-sky storey above the pit roof line (no roof slab over the pit; rays leave into the sky)
  openPitRoof(layout, info);
  Object.defineProperty(layout, 'pitLamps', {value: st, enumerable: false, configurable: true});
  return st;
}

/**
 * The pit top opens to the sky: levels[0].sky (gen/levels.ts LevelSky) with its band top / closed-column top at the pit roof line —
 * ceilings at or above it are not built (the pit's roof slab: only its open beam grid stays, world/reactor/archKit.ts planRoof) and
 * rays leaving the pit above it fly into the open sky. Nothing walkable comes near it (the rim is at 0, the roof 14-18 m up).
 */
export function openPitRoof(layout: StationLayout, info: ReactorInfo): void {
  const roofY = info.pit.roofY;
  if (!(roofY > info.pit.rimY + 2) || !layout.levels.length || layout.levels.some(l => l.sky)) return;
  layout.levels[0].sky = {y: info.pit.rimY, ceil: roofY, top: roofY};
}

/** QA / tests: the stats of the last planPitLamps on this layout (null when it never ran). */
export function pitLampStats(layout: StationLayout): PitLampStats | null {
  return (layout as unknown as {pitLamps?: PitLampStats}).pitLamps ?? null;
}

void CELL;
