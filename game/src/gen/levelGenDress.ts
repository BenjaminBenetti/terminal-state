// Iteration 08 (Lane A): dressing of the multi-level program that the generator owns (pure data).
//
// Lane P's dressing (stationDress / compose / props07Dress) furnishes every area on its own level
// grid and lifts it to absolute heights inside dress(). After that this module adds:
//  - WAYFINDING between levels (existing sign system): "UPPER CONCOURSE ↑" / "SERVICE LEVEL ↓" over
//    the stair-core doors and in the lobbies, platform numbers + "STAIRS DOWN" at the upper
//    landings, crossover plates on the bridges, "PLATFORM n · STAIRS UP" in the service crossing;
//  - high-bay fixtures on the ceiling of the light wells over the tracks, and full-height track
//    columns through the wells;
//  - SPAWNS: when spawn placement left every zombie / loose supply on the main level, a weighted
//    share (same area weights as placeSpawns, totals unchanged) moves onto upper / lower cells.
// Everything placed here carries `level` and absolute y.

import type {Rng} from '../core/rng';
import {CELL, FLOOR, type Grid} from './grid';
import {purposeById} from './purposes';
import {PUBLIC_FLOOR_WEIGHTS} from '../items/lootTables';
import {signDims, wallSignSpot} from './doorways';
import {LEVEL_LOWER, LEVEL_UPPER, levelArrays, levelDistance} from './levelGen';
import {MIN_ZOMBIE_SPAWN_CELLS, type Area, type Door, type Side, type SignPlacement, type StationLayout} from './stationTypes';

const platNo = (P: Area) => (P.label.match(/\d+(?:\s*·\s*\d+)?/)?.[0] ?? String(P.platformNo ?? 1)).replace(/\s+/g, ' ');

/** Wayfinding, well fixtures and track columns of the level program (after dress()). */
export function dressLevels(layout: StationLayout, _rng: Rng): void {
  const plan = layout.levelPlan;
  if (!plan || layout.levels.length < 3) return;
  const g0 = layout.grid;
  const A = layout.areas;
  const sign = (s: SignPlacement) => layout.signs.push(s);
  const wall = (g: Grid, area: Area, side: Side, t: number, y: number, base: number, level: number, s: Omit<SignPlacement, 'x' | 'y' | 'z' | 'rot' | 'area'>): boolean => {
    // wallSignSpot works in the grid's absolute frame (lintel heights): pass absolute y.
    const spot = wallSignSpot(g, area, side, t, base + y, signDims(s));
    if (spot === null) return false;
    const ax0 = area.x * CELL, az0 = area.y * CELL, ax1 = (area.x + area.w) * CELL, az1 = (area.y + area.h) * CELL;
    const pos = side === 'N' ? {x: spot, z: az0 + 0.02, rot: 0} : side === 'S' ? {x: spot, z: az1 - 0.02, rot: Math.PI}
      : side === 'W' ? {x: ax0 + 0.02, z: spot, rot: Math.PI / 2} : {x: ax1 - 0.02, z: spot, rot: -Math.PI / 2};
    sign({...s, ...pos, y: base + y, area: area.id, ...(level ? {level} : {})});
    return true;
  };
  const doorBetween = (a: number, b: number): Door[] => layout.doors.filter(d => (d.a === a && d.b === b) || (d.a === b && d.b === a));
  const plats = layout.platforms.map(id => A[id]);
  const others = (P: Area) => plats.filter(q => q.id !== P.id).map(platNo);

  // --- Main level: stair-core doors and lobbies --------------------------------------------------
  for (const c of plan.cores) {
    const P = A[c.platform], lobby = A[c.lobby], up = A[c.up];
    const dest = others(P);
    const upText = dest.length ? `UPPER CONCOURSE · TO PLATFORM${dest.length > 1 || dest[0].includes('·') ? 'S' : ''} ${dest.join(' · ')}` : 'UPPER CONCOURSE · CROSSOVER';
    for (const d of doorBetween(P.id, lobby.id)) {
      const mid = (d.x + d.w / 2) * CELL;
      if (!c.island) {
        const side: Side = d.y >= P.y + P.h ? 'S' : 'N';
        wall(g0, P, side, mid, d.height + 0.32, 0, 0, {kind: 'info', text: 'UPPER CONCOURSE · SERVICE LEVEL', arrow: 'up', w: 2.6});
        wall(g0, P, side, mid + d.w * CELL / 2 + 0.2 + 0.8, 1.9, 0, 0, {kind: 'service', text: 'SERVICE LEVEL · STAFF', arrow: 'down', w: 1.6});
        const z = side === 'S' ? (P.y + P.h) * CELL - 3.2 : P.y * CELL + 3.2;
        sign({x: mid, y: Math.min(P.ceil - 0.6, 2.95), z, rot: Math.PI / 2, kind: 'info', text: upText, arrow: 'up', area: P.id, hang: true, w: 2.6});
      } else {
        // Island enclosure: plates hang in front of both openings, facing the platform edges.
        const north = d.y < lobby.y;
        const z = north ? d.y * CELL - 1.2 : (d.y + 1) * CELL + 1.2;
        sign({x: mid, y: Math.min(P.ceil - 0.6, 2.95), z, rot: 0, kind: 'info', text: 'STAIRS · UPPER CONCOURSE · SERVICE LEVEL', arrow: 'up', area: P.id, hang: true, w: 2.8});
      }
    }
    // In the lobby: over the mouth of each run.
    const lz = (lobby.y + lobby.h / 2) * CELL;
    const upAtHi = up.x > lobby.x;
    const lx0 = lobby.x * CELL, lx1 = (lobby.x + lobby.w) * CELL;
    sign({x: upAtHi ? lx1 - 0.7 : lx0 + 0.7, y: 2.55, z: lz, rot: Math.PI / 2, kind: 'info', text: 'UPPER CONCOURSE', arrow: 'up', area: lobby.id, hang: true, w: 1.8});
    if (c.down >= 0) sign({x: upAtHi ? lx0 + 0.7 : lx1 - 0.7, y: 2.55, z: lz, rot: Math.PI / 2, kind: 'service', text: 'SERVICE LEVEL', arrow: 'down', area: lobby.id, hang: true, w: 1.6});

    // --- Upper level: where the stairs come up ----------------------------------------------------
    const deck = A[plan.decks.find(id => A[id].parent === P.id) ?? plan.decks[0]];
    if (c.landing >= 0) {
      const T = A[c.landing];
      for (const d of doorBetween(deck.id, T.id)) {
        const side: Side = d.y >= deck.y + deck.h ? 'S' : 'N';
        wall(layout.levels[LEVEL_UPPER].grid, deck, side, (d.x + d.w / 2) * CELL, d.height + 0.3, plan.hu, LEVEL_UPPER, {kind: 'info', text: `PLATFORM ${platNo(P)} · STAIRS DOWN`, arrow: 'down', w: 2.2});
      }
    } else {
      // Island: the run surfaces inside the deck; a plate hangs just in front of its head.
      const headX = upAtHi ? (up.x + up.w) * CELL + 1.0 : up.x * CELL - 1.0;
      sign({x: headX, y: plan.hu + 2.6, z: (up.y + up.h / 2) * CELL, rot: Math.PI / 2, kind: 'info', text: `PLATFORM ${platNo(P)} · STAIRS DOWN`, arrow: 'down', area: deck.id, hang: true, w: 2.2, level: LEVEL_UPPER});
    }
    // --- Lower level: the foot of the down run ------------------------------------------------------
    if (c.down >= 0 && plan.crossing >= 0) {
      const X = A[plan.crossing];
      sign({x: (X.x + X.w / 2) * CELL, y: plan.lowerFloor + 2.15, z: (c.y0 + c.y1) / 2 * CELL, rot: Math.PI / 2, kind: 'info', text: `PLATFORM ${platNo(P)} · STAIRS UP`, arrow: 'up', area: X.id, hang: true, w: 2.0, level: LEVEL_LOWER});
    }
  }
  // Bridges: crossover plates facing the walking direction (along Z).
  const allNos = plats.map(platNo);
  for (const id of plan.bridges) {
    const B = A[id];
    const catwalkSide = plan.catwalks.some(cid => { const C = A[cid]; return C.y + C.h === B.y || B.y + B.h === C.y; });
    const text = catwalkSide && !plats.some(P => P.y + P.h === B.y || B.y + B.h === P.y)
      ? 'MAINTENANCE CATWALK · STAFF ONLY' : `CROSSOVER · PLATFORMS ${allNos.join(' / ')}`;
    sign({x: (B.x + B.w / 2) * CELL, y: plan.hu + 2.65, z: (B.y + B.h / 2) * CELL, rot: 0, kind: catwalkSide && text.startsWith('MAINT') ? 'service' : 'info', text, area: B.id, hang: true, w: Math.min(2.6, B.w * CELL - 0.4), level: LEVEL_UPPER});
  }
  // Service gallery mouth.
  if (plan.gallery >= 0 && plan.crossing >= 0) {
    const Gy = A[plan.gallery], X = A[plan.crossing];
    const atHi = Gy.x > X.x;
    const rooms = plan.lowerRooms.map(id => A[id].label.toUpperCase()).slice(0, 2).join(' · ');
    sign({x: atHi ? Gy.x * CELL + 0.8 : (Gy.x + Gy.w) * CELL - 0.8, y: plan.lowerFloor + 2.15, z: (Gy.y + Gy.h / 2) * CELL, rot: Math.PI / 2, kind: 'service', text: rooms ? `SERVICE GALLERY · ${rooms}` : 'SERVICE GALLERY', area: Gy.id, hang: true, w: 2.4, level: LEVEL_LOWER});
  }

  // --- High-bay fixtures on the well ceilings; track columns run up through the wells -------------
  for (const w of plan.wells) {
    const zc = (w.y + w.h / 2) * CELL;
    const near = plats.slice().sort((p, q) => Math.abs((p.y + p.h / 2) * CELL - zc) - Math.abs((q.y + q.h / 2) * CELL - zc))[0];
    const n = Math.max(1, Math.round(w.w * CELL / 6));
    for (let i = 0; i < n; i++) {
      const x = (w.x + w.w * (i + 0.5) / n) * CELL;
      layout.lights.push({x, y: plan.upperCeil - 0.02, z: zc, rot: 0, area: near.id, broken: false, flicker: false, warm: false, power: 1, dying: false, level: 0});
    }
  }
  for (const p of layout.props) {
    if (p.level || p.kind !== 'column') continue;
    const [cx, cy] = g0.cellOf(p.x, p.z);
    if (!g0.inBounds(cx, cy)) continue;
    const i = g0.idx(cx, cy);
    if (g0.cells[i] === FLOOR || g0.rampIdx[i] >= 0) continue;
    const c = g0.ceil[i];
    if (c > p.y + p.h + 0.05) p.h = c - p.y;
  }
}

// ---------------------------------------------------------------------------------------------
// Spawns on the levels

// Task loot-tables-20261030 (lane LOOT): where moved loose finds may land — items/lootTables.ts (its own copy, kept distinct).
const PUBLIC_FLOOR = PUBLIC_FLOOR_WEIGHTS.stationLevels;
const zombieWeight = (a: Area) => a.kind === 'platform' ? 2.2 : a.type === 'exit-stair' || a.type === 'washroom' ? 0.5 : a.type === 'eatery' || a.type === 'shop' ? 0.5 : a.publicSpace ? 1 : a.kind === 'closet' ? 0.6 : 1.4;

/**
 * Moves a weighted share of the zombies and loose floor supplies onto the upper / lower levels
 * (totals unchanged) when spawn placement left them all on the main level.
 */
export function placeLevelSpawns(layout: StationLayout, rng: Rng): void {
  const levels = layout.levels;
  if (levels.length < 3) return;
  const g0 = layout.grid, W = g0.w;
  const [sx, sy] = g0.cellOf(layout.playerSpawn.x, layout.playerSpawn.z);
  const dist = levelDistance(levels, sx, sy);
  const clear1 = (g: Grid, x: number, y: number) => {
    for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) {
      if (!g.walkable(x + ox, y + oy) || g.rampIdx[g.idx(x + ox, y + oy)] >= 0) return false;
    }
    return true;
  };
  const doorZone = levels.map(L => {
    const m = new Uint8Array(W * g0.h);
    for (const d of layout.doors) {
      if ((d.level ?? layout.areas[d.a]?.level ?? 0) !== L.id) continue;
      for (let y = d.y - 2; y < d.y + d.h + 2; y++) for (let x = d.x - 2; x < d.x + d.w + 2; x++) if (L.grid.inBounds(x, y)) m[L.grid.idx(x, y)] = 1;
    }
    return m;
  });
  // Candidate cells per level area (main areas only count toward the weights: cheaper test).
  const cells = new Map<number, number[]>();
  const mainAreas = new Set<number>();
  const {box: [bx0, by0, bx1, by1]} = levelArrays(levels);
  for (const L of levels) {
    const g = L.grid, gc = g.cells, ga = g.area, dl = dist[L.id];
    // Off-main levels only exist inside the stacked box.
    const [x0, y0, x1, y1] = L.id ? [Math.max(1, bx0), Math.max(1, by0), Math.min(g.w - 1, bx1), Math.min(g.h - 1, by1)] : [1, 1, g.w - 1, g.h - 1];
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
      const i = y * W + x;
      if (gc[i] !== FLOOR || dl[i] < MIN_ZOMBIE_SPAWN_CELLS) continue;
      const a = ga[i];
      if (a < 0 || (layout.areas[a].level ?? 0) !== L.id || layout.areas[a].role === 'stair') continue;
      if (!L.id) { mainAreas.add(a); continue; }
      if (!clear1(g, x, y)) continue;
      let l = cells.get(a);
      if (!l) cells.set(a, (l = []));
      l.push(i);
    }
  }
  const levelAreas = [...cells.keys()];
  // --- Zombies -----------------------------------------------------------------------------------
  // Never on a stair flight (main-level spawning only checks for floor): those move first.
  const onStairs = (z: StationLayout['zombies'][number]) => {
    const g = levels[z.level ?? 0]?.grid ?? g0, [cx, cy] = g.cellOf(z.x, z.z);
    if (!g.inBounds(cx, cy)) return false;
    const i = g.idx(cx, cy);
    // Flights and the landings between them (the whole stair run), not just ramp cells.
    return g.rampIdx[i] >= 0 || layout.areas[g.area[i]]?.role === 'stair';
  };
  const stairZ = layout.zombies.filter(onStairs);
  const share = levelAreas.length > 0 && !layout.zombies.some(z => z.level);
  if (levelAreas.length && (share || stairZ.length)) {
    const wMain = [...mainAreas].reduce((s, id) => s + zombieWeight(layout.areas[id]), 0);
    const wLev = levelAreas.reduce((s, id) => s + zombieWeight(layout.areas[id]), 0);
    const N = layout.zombies.length;
    const perLevel = new Set(levelAreas.map(id => layout.areas[id].level!));
    const want = share ? Math.min(Math.max(N - 6, 0), Math.max(perLevel.size, Math.round(N * wLev / (wLev + wMain)))) : 0;
    const nMove = Math.max(want, stairZ.length);
    // Donors: zombies on stairs, then those in the most crowded main areas (ties: latest placed).
    const crowd = new Map<number, number>();
    for (const z of layout.zombies) crowd.set(z.area, (crowd.get(z.area) ?? 0) + 1);
    const donors = layout.zombies.map((z, i) => ({z, i})).filter(d => share || onStairs(d.z))
      .sort((p, q) => (+onStairs(q.z) - +onStairs(p.z)) || (crowd.get(q.z.area)! - crowd.get(p.z.area)!) || q.i - p.i);
    // Area order: one area per level first (each level gets a creature), then weighted.
    const order = levelAreas.map(id => ({id, k: Math.pow(rng.next(), 1 / zombieWeight(layout.areas[id]))})).sort((p, q) => q.k - p.k).map(o => o.id);
    const firstPer = [...perLevel].map(lv => order.find(id => layout.areas[id].level === lv)!).filter(id => id !== undefined);
    const seq = [...firstPer, ...order.filter(id => !firstPer.includes(id))];
    let moved = 0, di = 0;
    for (let pass = 0; pass < 3 && moved < nMove; pass++) {
      for (const id of seq) {
        if (moved >= nMove || di >= donors.length) break;
        const a = layout.areas[id], g = levels[a.level!].grid, list = cells.get(id)!;
        for (let t = 0; t < 12; t++) {
          const i = rng.pick(list);
          const [zx, zz] = g.center(i % W, (i / W) | 0);
          const zy = g.floorOf(i);
          if (layout.zombies.some(o => Math.hypot(o.x - zx, o.z - zz) < 4 && Math.abs((o.y ?? 0) - zy) < 2)) continue;
          const z = donors[di++].z;
          z.x = zx; z.z = zz; z.y = zy; z.level = a.level; z.area = id; z.yaw = rng.range(-Math.PI, Math.PI);
          moved++;
          break;
        }
      }
    }
  }
  // --- Loose floor supplies ------------------------------------------------------------------------
  if (levelAreas.length && !layout.pickups.some(p => p.level)) {
    const floorW = (a: Area, cat: 'ammo' | 'med') => { const p = purposeById(a.purpose); return p ? p.floor?.[cat] ?? 0 : PUBLIC_FLOOR[a.type] ?? 0; };
    const lootAreas = layout.areas.filter(a => a.level && a.type !== 'stair-core');
    const share = (cat: 'ammo' | 'med') => {
      const lv = lootAreas.reduce((s, a) => s + floorW(a, cat), 0);
      const mn = layout.areas.filter(a => !a.level && a.storefront === undefined).reduce((s, a) => s + floorW(a, cat), 0);
      return lv / Math.max(1e-6, lv + mn);
    };
    const sp = layout.playerSpawn;
    const loose = layout.pickups.filter(p => !p.level && p.y === 0 && (p.itemId.startsWith('ammo') || p.itemId === 'medkit' || p.itemId === 'bandage') && Math.hypot(p.x - sp.x, p.z - sp.z) > 15);
    const used = new Set<string>();
    const free = (a: Area): number[] => {
      const g = levels[a.level!].grid, z = doorZone[a.level!];
      const out: number[] = [];
      for (let y = a.y; y < a.y + a.h; y++) for (let x = a.x; x < a.x + a.w; x++) {
        const i = g.idx(x, y);
        if (!g.walkable(x, y) || g.rampIdx[i] >= 0 || z[i] || g.area[i] !== a.id || used.has(`${a.level}:${i}`) || dist[a.level!][i] < 12) continue;
        out.push(i);
      }
      return out;
    };
    const moveTo = (p: (typeof loose)[number], cat: 'ammo' | 'med'): boolean => {
      const pool = lootAreas.map(a => [a, floorW(a, cat)] as [Area, number]).filter(e => e[1] > 0);
      for (let t = 0; t < 8 && pool.length; t++) {
        const a = rng.weighted(pool), list = free(a);
        if (!list.length) continue;
        const i = rng.pick(list), g = levels[a.level!].grid;
        used.add(`${a.level}:${i}`);
        const [x, z] = g.center(i % W, (i / W) | 0);
        p.x = x + rng.range(-0.1, 0.1); p.z = z + rng.range(-0.1, 0.1); p.y = g.floorOf(i); p.area = a.id; p.level = a.level;
        return true;
      }
      return false;
    };
    const shares = {ammo: share('ammo'), med: share('med')};
    for (const p of loose) {
      const cat = p.itemId.startsWith('ammo') ? 'ammo' : 'med';
      if (rng.chance(shares[cat])) moveTo(p, cat);
    }
    // Each level offers at least something to find on the floor.
    for (const lv of [LEVEL_UPPER, LEVEL_LOWER]) {
      if (layout.pickups.some(p => p.level === lv)) continue;
      const p = loose.find(q => !q.level);
      if (!p) break;
      const cat = p.itemId.startsWith('ammo') ? 'ammo' : 'med';
      const pool = lootAreas.filter(a => a.level === lv && floorW(a, cat) > 0);
      for (const a of rng.shuffle(pool)) {
        const list = free(a);
        if (!list.length) continue;
        const i = rng.pick(list), g = levels[lv].grid;
        used.add(`${lv}:${i}`);
        const [x, z] = g.center(i % W, (i / W) | 0);
        p.x = x; p.z = z; p.y = g.floorOf(i); p.area = a.id; p.level = lv;
        break;
      }
    }
  }
}

// ---------------------------------------------------------------------------------------------
// Service-level lighting (after applyLighting)

/** Low output of the service level's working fixtures (warm sodium / amber tint: `warm`). */
export const SERVICE_LAMP = {spacing: 9, power: [0.28, 0.38] as const, landmark: 0.4, door: 0.32};

/**
 * Keeps the lower level dark-moody but readable by sight (QA: the service crossing read pitch black
 * outside the flashlight cone). After applyLighting: the crossing and gallery get a sparse run of
 * WORKING dim warm fixtures (every ~9 m, the rest stay dead tubes), one at the foot of every down
 * stair and one outside every plant-room door; each plant room keeps at least one lamp that works,
 * flickers or sputters. Existing fixture models / profiles only.
 */
export function lightServiceLevel(layout: StationLayout, rng: Rng): void {
  const plan = layout.levelPlan;
  if (!plan || layout.levels.length < 3) return;
  const A = layout.areas;
  const y = Math.round((plan.lowerCeil - 0.02) * 1000) / 1000;
  const lamp = (x: number, z: number, rot: number, area: number, power: number, flicker = false) =>
    layout.lights.push({x, y, z, rot, area, broken: false, flicker, warm: true, power, dying: false, level: LEVEL_LOWER});
  const working = (area: number) => layout.lights.filter(l => l.area === area && !l.broken && !l.dying);
  const near = (area: number, x: number, z: number, r: number) => working(area).some(l => Math.hypot(l.x - x, l.z - z) < r);
  const r2 = (v: number) => Math.round(v * 100) / 100;
  // Crossing + gallery: dim profile, a working fixture every ~9 m along the centre line.
  for (const id of [plan.crossing, plan.gallery]) {
    if (id < 0) continue;
    const a = A[id];
    a.lighting = 'dim';
    const alongX = a.w >= a.h;
    const s0 = (alongX ? a.x : a.y) * CELL, s1 = (alongX ? a.x + a.w : a.y + a.h) * CELL;
    const c = (alongX ? a.y + a.h / 2 : a.x + a.w / 2) * CELL;
    const own = layout.lights.filter(l => l.area === id).sort((p, q) => (alongX ? p.x - q.x : p.z - q.z));
    let last = -Infinity;
    for (const l of own) {
      const s = alongX ? l.x : l.z;
      l.warm = true; l.dying = false;
      if (s - last >= SERVICE_LAMP.spacing - 1.5) { l.broken = false; l.power = r2(rng.range(...SERVICE_LAMP.power)); l.flicker = rng.chance(0.12); last = s; }
      else { l.broken = true; l.flicker = false; }
    }
    // Fill any gap the existing fixtures leave.
    const n = Math.max(1, Math.round((s1 - s0 - 2) / SERVICE_LAMP.spacing));
    for (let k = 0; k < n; k++) {
      const s = s0 + 1 + (s1 - s0 - 2) * (k + 0.5) / n;
      const [x, z] = alongX ? [s, c] : [c, s];
      if (!near(id, x, z, SERVICE_LAMP.spacing / 2)) lamp(r2(x), r2(z), alongX ? 0 : Math.PI / 2, id, r2(rng.range(...SERVICE_LAMP.power)));
    }
  }
  // The foot of every down stair (the way back up stays findable).
  if (plan.crossing >= 0) {
    for (const k of layout.levelLinks) {
      if (k.lower !== LEVEL_LOWER) continue;
      if (!near(plan.crossing, k.bottom.x, k.bottom.z, 2.5)) lamp(r2(k.bottom.x), r2(k.bottom.z), 0, plan.crossing, SERVICE_LAMP.landmark);
    }
  }
  // Outside every plant-room door (gallery side), and one live lamp in every plant room.
  const rooms = plan.lowerRooms.map(id => A[id]);
  for (const R of rooms) {
    for (const d of layout.doors) {
      if (d.b !== R.id || d.a !== plan.gallery) continue;
      const G = A[plan.gallery];
      const x = (d.x + d.w / 2) * CELL;
      const z = d.y < G.y ? (d.y + 1) * CELL + 0.6 : d.y * CELL - 0.6;
      if (!near(G.id, x, z, 2)) lamp(r2(x), r2(z), 0, G.id, SERVICE_LAMP.door);
    }
    const own = layout.lights.filter(l => l.area === R.id);
    if (!own.length || own.some(l => !l.broken)) continue;
    // Dark room: one tube sputters (still dark), or now and then one dim lamp works.
    const l = own[0];
    l.broken = false; l.warm = true;
    if (rng.chance(0.3)) { R.lighting = 'dim'; l.power = SERVICE_LAMP.door; l.flicker = true; l.dying = false; }
    else { l.dying = true; l.flicker = true; l.power = 0.5; }
  }
  // Every station keeps at least one fully dark back-of-house space (applyLighting's rule).
  if (!A.some(a => !a.publicSpace && a.lighting === 'dark')) {
    const R = rooms.find(r => r.lighting === 'dim');
    if (R) { R.lighting = 'dark'; for (const l of layout.lights) if (l.area === R.id) { l.broken = true; l.flicker = false; l.dying = false; } }
  }
}
