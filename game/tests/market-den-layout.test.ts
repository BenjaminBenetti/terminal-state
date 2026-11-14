// Task studio-corpse-market-shop-20261114-031614-01 (lane LAYOUT): THE SURVIVOR MARKET's layout version 4 = version 3 plus the corpse
// buyer's DEN (gen/market/v4/: a back passage off the Back Lane, a customer room with the floor chute and the buyer's barred booth, the
// buyer's sealed back room behind it) over a seed sample, both mirror states —
//  - the version policy: 4 is the current version (new / unvisited markets); a recorded 1 / 2 / 3 stays what it was (a recorded 3 has no
//    den, byte for byte the shipped version 3: fingerprints of the generator BEFORE this task, gen/market at 54ef3445);
//  - DETERMINISM / PARITY: the den draws nothing from version 3's streams and is appended after version 3's whole output — for every
//    seed version 4 takes the same attempt as version 3, and minus the den it IS version 3 (areas / doors / props / lights / signs
//    prefixes, the market record's stalls / spots / residents, every storey's grid outside the den's cells — which were rock —, rails,
//    links, stairs, ladders, the spawn, the name, every other layout field);
//  - the den itself (independent of gen/market/v4/denValidate.ts): its door off the Back Lane, its rock border; the booth closes the only
//    opening into the back room (no cell of it reachable on foot, the booth spanning the opening into the jambs); the door, the chute,
//    the customer's spot and the payout spot (on the floor in front of the booth) reachable on foot and carrying a body; the boards and
//    the red lamp; the two den kinds' sizes from the cooked kit, classified for the prop rules; no loot, no refuge, no resident in it.
import {describe, expect, it} from 'vitest';
import * as crypto from 'node:crypto';
import {CELL, FLOOR, SOLID} from '../src/gen/grid';
import {levelDistance} from '../src/gen/levelGen';
import {LEVELS} from '../src/levels/registry';
import {DEN, MARKET_EMPTY_KEY, MARKET_LAYOUT_LANE, MARKET_LAYOUT_VERSION, denIssues, generateMarketLevel, marketLayoutIssues, marketLayoutVersionFor, marketStandOk} from '../src/gen/market/index';
import {SETTLE_GEN_STATS} from '../src/gen/market/v2/index';
import {SETTLE} from '../src/gen/market/v2/frame';
import {CORPSE_BOOTH_KIND, CORPSE_CHUTE_KIND, CORPSE_DEN_KINDS, CORPSE_DEN_PROP_DEFS} from '../src/gen/market/v4/denKinds';
import {CORPSE_SHOP_KIT} from '../src/assets/corpseShopKit.generated';
import {DEN_LIGHTS, DEN_SIGNS} from '../src/gen/market/v4/denDress';
import {OPENABLE_AUDIT} from '../src/world/openablesSpec';
import {PROP_PHYSICS_AUDIT, unclassifiedPhysicsKinds} from '../src/damage/physicsAudit';
import {gearAreaWeight} from '../src/gen/gearLoot';
import {refugeKindOf} from '../src/market/people/refuges';
import {marketAwnings, marketFans} from '../src/gen/market/art';
import {isLootHolderKind} from '../src/items/loot';
import type {Door, PropPlacement, StationLayout} from '../src/gen/stationTypes';

// seeds 1-48 (every frame depth, both mirror states, the three seeds whose version 3 never validates) + the bar test's sample
const SEEDS = [...Array.from({length: 48}, (_, k) => k + 1), 42, 777, 4242, 9001, 123456, 0xdeadbeef, 20261108];
const runs = SEEDS.map(seed => {
  const L = generateMarketLevel({levelSeed: seed});
  const a4 = SETTLE_GEN_STATS.attempts, ms = SETTLE_GEN_STATS.ms;
  const V3 = generateMarketLevel({levelSeed: seed, layoutVersion: 3});
  return {seed, L, V3, a4, a3: SETTLE_GEN_STATS.attempts, ms};
});

/** Version 3 fingerprints of the generator before this task (gen/market at 54ef3445, run from a `git archive` of it side by side with
 *  this branch: identical) — a recorded version 3 must keep regenerating exactly this. */
const V3_SHIPPED: Record<number, string> = {
  1: '8b8fdc3c3fd2e51a', 2: '8749b4e5e32cb0cf', 3: 'e9f029315e7527a8', 6: 'a1dd6758bc803a06', 42: 'c71dd428a42cf237',
  777: '46a860c2524511cb', 4242: 'd5b31b34da0ccbc4', 9001: '2fa731ae871d3462', 31337: '0909ce98a9e84bc0',
};
function fingerprint(l: StationLayout): string {
  const g = l.levels.map(L => crypto.createHash('sha256').update(Buffer.from(L.grid.cells)).update(Buffer.from(L.grid.area.buffer)).update(Buffer.from(L.grid.floor.buffer)).update(Buffer.from(L.grid.ceil.buffer)).update(Buffer.from(L.grid.blocked)).update(Buffer.from(L.grid.sightBlocked)).digest('hex'));
  const s = JSON.stringify({g, areas: l.areas, doors: l.doors, props: l.props, lights: l.lights, signs: l.signs, market: l.market, rails: l.rails, links: l.levelLinks, spawn: l.playerSpawn, lad: l.traversal.ladders, st: l.traversal.stairs, name: l.name});
  return crypto.createHash('sha256').update(s).digest('hex').slice(0, 16);
}

const near = (a: number, b: number, e = 1e-3) => Math.abs(a - b) <= e;
const boxDist = (p: PropPlacement, x: number, z: number) => Math.hypot(Math.max(0, Math.abs(x - p.x) - p.hx), Math.max(0, Math.abs(z - p.z) - p.hz));

/** The den's parts: its record, its door, its three areas (passage, customer room, back room), mirror state, canonical column. */
function denOf(L: StationLayout) {
  const den = L.market!.den!, g = L.grid, W = g.w;
  const door: Door = L.doors.find(d => near(d.x * CELL, den.door.x0) && near(d.y * CELL, den.door.z0) && near((d.x + d.w) * CELL, den.door.x1) && near((d.y + d.h) * CELL, den.door.z1))!;
  const passage = door.b, ids = new Set([passage, den.area, den.back]);
  const mirror = den.door.x > W * CELL / 2;
  return {den, door, passage, ids, mirror, canon: (x: number) => (mirror ? W - 1 - x : x), chute: L.props[den.chute.prop], booth: L.props[den.booth.prop]};
}

/** Level-0 cells reached from `starts` stepping through walkable cells whose centre has a clear disc of radius `r` (no ramps). */
function flood(L: StationLayout, starts: number[], r: number): Uint8Array {
  const g = L.grid, W = g.w, seen = new Uint8Array(g.cells.length);
  const ok = (i: number) => { const x = i % W, y = (i / W) | 0, [cx, cz] = g.center(x, y); return g.walkable(x, y) && g.rampIdx[i] < 0 && (r <= 0 || g.circleClear(cx, cz, r)); };
  const q = starts.filter(ok);
  for (const i of q) seen[i] = 1;
  while (q.length) {
    const c = q.pop()!, x = c % W;
    for (const j of [x > 0 ? c - 1 : -1, x < W - 1 ? c + 1 : -1, c - W, c + W]) {
      if (j < 0 || j >= g.cells.length || seen[j] || !ok(j)) continue;
      seen[j] = 1;
      q.push(j);
    }
  }
  return seen;
}

describe('the Survivor Market, layout version 4 (version 3 plus the corpse buyer\'s den)', () => {
  it('the version policy: 4 for new / unvisited markets; a recorded 1 / 2 / 3 is kept (a recorded 3: the shipped version 3, no den)', () => {
    expect(MARKET_LAYOUT_VERSION).toBe(4);
    expect(marketLayoutVersionFor(undefined)).toBe(4);
    expect(marketLayoutVersionFor({visits: 0, lanes: {}})).toBe(4);
    expect(marketLayoutVersionFor({visits: 2, lanes: {}})).toBe(1);
    for (const v of [1, 2, 3, 4]) expect(marketLayoutVersionFor({visits: 2, lanes: {[MARKET_LAYOUT_LANE]: {v}}})).toBe(v);
    expect(marketLayoutVersionFor({visits: 2, lanes: {[MARKET_LAYOUT_LANE]: {v: 5}}})).toBe(1);
    expect(marketLayoutVersionFor({visits: 0, lanes: {[MARKET_LAYOUT_LANE]: {v: 5}}})).toBe(4);
    for (const [s, want] of Object.entries(V3_SHIPPED)) {
      const v3 = generateMarketLevel({levelSeed: Number(s), layoutVersion: 3});
      expect(fingerprint(v3), `seed ${s}`).toBe(want);
      expect(fingerprint(LEVELS.market.generate('main', {levelSeed: Number(s), layoutVersion: 3})), `seed ${s} (registry)`).toBe(want);
      expect([v3.market!.v, v3.market!.den, v3.props.filter(p => (CORPSE_DEN_KINDS as readonly string[]).includes(p.kind)).length]).toEqual([3, undefined, 0]);
    }
    // the default (and the registry) builds version 4, deterministically
    const sig = (L: StationLayout) => JSON.stringify({areas: L.areas, doors: L.doors, props: L.props, lights: L.lights, signs: L.signs, market: L.market, rails: L.rails, links: L.levelLinks});
    expect(runs[0].L.market!.v).toBe(4);
    expect(sig(generateMarketLevel({levelSeed: SEEDS[0], layoutVersion: 4}))).toBe(sig(runs[0].L));
    expect(sig(LEVELS.market.generate('main', {levelSeed: SEEDS[0]}))).toBe(sig(runs[0].L));
  });

  it('parity: for every seed version 4 takes version 3\'s attempt and, minus the appended den, IS version 3 (no draw moved)', () => {
    for (const {seed, L, V3, a4, a3} of runs) {
      const at = `seed ${seed}`;
      expect([seed, a4]).toEqual([seed, a3]);
      expect([seed, marketLayoutIssues(L)]).toEqual([seed, marketLayoutIssues(V3)]); // (the den adds no issue; v3's own, if any, the same)
      expect([seed, denIssues(L)]).toEqual([seed, []]);
      const {ids, door} = denOf(L);
      // areas / doors / props / lights / signs: version 3's, then the den's
      const n = V3.areas.length;
      expect(L.areas.slice(0, n), at).toEqual(V3.areas);
      expect(L.areas.slice(n).map(a => a.label), at).toEqual(['Back passage', 'Corpse buyer', 'Back room']);
      expect(L.doors.slice(0, V3.doors.length), at).toEqual(V3.doors);
      expect(L.doors.slice(V3.doors.length), at).toEqual([door]);
      for (const k of ['props', 'lights', 'signs'] as const) {
        expect(L[k].slice(0, V3[k].length), `${at} ${k}`).toEqual(V3[k]);
        expect(L[k].length, `${at} ${k}`).toBeGreaterThan(V3[k].length);
      }
      expect(L.props.slice(V3.props.length).every(p => ids.has(p.area) && !(p.level ?? 0)), at).toBe(true);
      expect(L.lights.slice(V3.lights.length).every(l => ids.has(l.area)), at).toBe(true);
      expect(L.signs.slice(V3.signs.length).every(s => ids.has(s.area) || s.area === door.a), at).toBe(true);
      // the market record: version 3's (stalls, spots, residents, names ...) plus the den
      const {v, den, ...m4} = L.market!, {v: v3, ...m3} = V3.market!;
      expect([v, v3, !!den]).toEqual([4, 3, true]);
      expect(m4, at).toEqual(m3);
      // every storey's grid: identical outside the den's cells (rock in version 3); the den on the ground storey only
      for (const [li, Lv] of L.levels.entries()) {
        const G = Lv.grid, H = V3.levels[li].grid;
        expect([G.w, G.h]).toEqual([H.w, H.h]);
        let bad = 0;
        for (const key of ['cells', 'area', 'floor', 'ceil', 'blocked', 'sightBlocked', 'rampIdx'] as const) {
          const a = G[key], b = H[key];
          for (let i = 0; i < a.length; i++) if (a[i] !== b[i] && !(li === 0 && ids.has(L.grid.area[i]) && H.cells[i] === SOLID)) bad++;
        }
        expect([at, li, bad]).toEqual([at, li, 0]);
        expect(JSON.stringify([G.ramps, G.links]), at).toBe(JSON.stringify([H.ramps, H.links]));
      }
      expect(L.levels.map(({grid: _g, ...r}) => r)).toEqual(V3.levels.map(({grid: _g, ...r}) => r));
      // every other layout field (spawn, name, rails, links, traversal, pickups, zombies ...)
      const rest = (q: StationLayout) => { const {grid: _g, levels: _l, areas: _a, doors: _d, props: _p, lights: _li, signs: _s, market: _m, ...r} = q; return JSON.stringify(r); };
      expect(rest(L), at).toBe(rest(V3));
    }
    // both mirror states; the market's own art (fans, awnings) unchanged
    expect(new Set(runs.map(({L}) => denOf(L).mirror)).size).toBe(2);
    for (const {L, V3} of runs.slice(0, 8)) {
      expect(marketFans(L)).toEqual(marketFans(V3));
      expect(marketAwnings(L)).toEqual(marketAwnings(V3));
    }
  });

  it('is quick: a seed version 3 accepts on its first attempts builds version 4 within version 3\'s budget', () => {
    for (const {seed, a4, ms} of runs) if (a4 <= 2) expect(ms, `seed ${seed}`).toBeLessThan(400);
  });

  it('the den: off the Back Lane through the shed\'s west wall, in the rock outside the shed (its border kept), ground storey, a container\'s height', () => {
    for (const {seed, L} of runs) {
      const at = `seed ${seed}`, g = L.grid, W = g.w, H = g.h;
      const {den, door, passage, ids, canon} = denOf(L);
      const A = L.areas;
      expect([A[door.a].label, A[passage].label, A[den.area].label, A[den.back].label], at).toEqual(['Back Lane', 'Back passage', 'Corpse buyer', 'Back room']);
      expect([canon(door.x), door.w, door.h, door.level ?? 0], at).toEqual([SETTLE.x0 - 1, 1, DEN.doorW, 0]);
      expect(door.height, at).toBeGreaterThanOrEqual(2.0);
      expect(door.y >= A[door.a].y && door.y + door.h <= A[door.a].y + A[door.a].h, at).toBe(true);
      for (const id of ids) expect([at, A[id].level ?? 0, A[id].publicSpace, A[id].noFloorLoot]).toEqual([at, 0, false, true]);
      let cells = 0;
      for (let i = 0; i < g.cells.length; i++) {
        if (!ids.has(g.area[i]) || g.cells[i] !== FLOOR) continue;
        cells++;
        const x = i % W, y = (i / W) | 0;
        expect(x >= 1 && x <= W - 2 && y >= 1 && y <= H - 2, `${at} border ${x},${y}`).toBe(true);
        // (every den cell was rock on every storey in version 3: the parity test)
        for (const Lv of L.levels.slice(1)) expect(Lv.grid.cells[i], `${at} storey ${Lv.id} over the den`).toBe(SOLID);
        if (g.blocked[i] || (x >= door.x && x < door.x + door.w && y >= door.y && y < door.y + door.h)) continue;
        expect([at, Math.round((g.ceil[i] - g.floorOf(i)) * 1000)]).toEqual([at, Math.round(DEN.ceil * 1000)]);
      }
      expect(cells, at).toBeGreaterThan(60);
      // the customer room: south of the settlement's back row, the passage along its west end (canonical)
      expect(canon(A[passage].x + (denOf(L).mirror ? A[passage].w - 1 : 0)), at).toBe(DEN.passageX);
      expect(A[den.area].y, at).toBe(A[passage].y + A[passage].h);
      expect(A[den.area].y + A[den.area].h, at).toBe(H - DEN.border);
    }
  });

  it('sealed: the booth closes the only opening into the back room; no back-room cell is reachable on foot (any storey, any link)', () => {
    for (const {seed, L} of runs) {
      const at = `seed ${seed}`, g = L.grid, W = g.w;
      const {den, booth, door} = denOf(L);
      // every way out of the back room: a floor cell under the booth (blocked, inside its box)
      const opening: number[] = [];
      for (let i = 0; i < g.cells.length; i++) {
        if (g.area[i] !== den.back || g.cells[i] !== FLOOR) continue;
        const x = i % W;
        for (const j of [x > 0 ? i - 1 : -1, x < W - 1 ? i + 1 : -1, i - W, i + W]) {
          if (j < 0 || g.cells[j] === SOLID || g.area[j] === den.back) continue;
          const [jx, jz] = g.center(j % W, (j / W) | 0);
          expect([at, g.blocked[j], Math.abs(jx - booth.x) <= booth.hx && Math.abs(jz - booth.z) <= booth.hz]).toEqual([at, 1, true]);
          opening.push(j);
        }
      }
      expect(opening.length, at).toBeGreaterThanOrEqual(2);
      // the booth reaches past both ends of the opening into solid jambs (no gap at either end)
      const ys = opening.map(j => (j / W) | 0), xs = new Set(opening.map(j => j % W));
      expect(xs.size, at).toBe(1);
      const y0 = Math.min(...ys), y1 = Math.max(...ys), x = [...xs][0];
      expect([g.get(x, y0 - 1), g.get(x, y1 + 1)], at).toEqual([SOLID, SOLID]);
      expect(booth.z - booth.hz <= y0 * CELL + 1e-6 && booth.z + booth.hz >= (y1 + 1) * CELL - 1e-6, at).toBe(true);
      // the walking flood from the spawn (every storey, stairs and ladders) and from the den's own door never enters it
      const [sx, sy] = g.cellOf(L.playerSpawn.x, L.playerSpawn.z);
      const walk = levelDistance(L.levels, sx, sy, 0, L.levelLinks);
      for (let i = 0; i < g.cells.length; i++) if (g.area[i] === den.back) expect([at, walk[0][i]]).toEqual([at, -1]);
      const fromDoor = flood(L, [g.idx(door.x, door.y + 1)], 0);
      expect(fromDoor.some((v, i) => v && g.area[i] === den.back), at).toBe(false);
      expect(L.levelLinks.some(k => k.lower === 0 && g.area[g.idx(...g.cellOf(k.bottom.x, k.bottom.z))] === den.back), at).toBe(false);
    }
  });

  it('the dealing: door, chute, customer\'s spot and payout spot reachable on foot and carrying a body; the buyer behind the bars', () => {
    for (const {seed, L} of runs) {
      const at = `seed ${seed}`, g = L.grid, W = g.w;
      const {den, door, chute, booth} = denOf(L);
      const [sx, sy] = g.cellOf(L.playerSpawn.x, L.playerSpawn.z);
      const walk = levelDistance(L.levels, sx, sy, 0, L.levelLinks)[0];
      const onFoot = (x: number, z: number) => walk[g.idx(...g.cellOf(x, z))] >= 0;
      for (let y = door.y; y < door.y + door.h; y++) expect([at, walk[g.idx(door.x, y)] >= 0]).toEqual([at, true]);
      expect([at, onFoot(den.front.x, den.front.z), onFoot(den.booth.tray.x, den.booth.tray.z)]).toEqual([at, true, true]);
      // carrying a body (a 1 m clear disc) from the door's approach on the Back Lane: to the door, the chute, the customer's spot
      const starts: number[] = [];
      for (let y = door.y - 2; y < door.y + door.h + 2; y++) for (let x = door.x - 2; x <= door.x + 2; x++) if (g.inBounds(x, y) && g.area[g.idx(x, y)] === door.a) starts.push(g.idx(x, y));
      const carry = flood(L, starts, 0.5);
      const reach = (d: (x: number, z: number) => number) => carry.some((v, i) => v === 1 && d(...g.center(i % W, (i / W) | 0)) <= 1.2);
      expect([at, reach((x, z) => Math.hypot(x - den.door.x, z - den.door.z)), reach((x, z) => boxDist(chute, x, z)), reach((x, z) => Math.hypot(x - den.front.x, z - den.front.z))]).toEqual([at, true, true, true]);
      // the booth: kit size, front (+Z) toward the customer; the payout spot ON THE FLOOR 0.35-0.5 m in front of its face, a clear 0.7 m disc
      const B = CORPSE_DEN_PROP_DEFS[CORPSE_BOOTH_KIND], fx = Math.sin(booth.rot), fz = Math.cos(booth.rot);
      const out = (x: number, z: number) => (x - booth.x) * fx + (z - booth.z) * fz - B.d / 2;
      const t = den.booth.tray;
      expect([at, t.y, t.level]).toEqual([at, 0, 0]);
      expect(out(t.x, t.z), at).toBeGreaterThanOrEqual(0.35 - 1e-3);
      expect(out(t.x, t.z), at).toBeLessThanOrEqual(0.5 + 1e-3);
      expect(Math.abs((t.x - booth.x) * fz - (t.z - booth.z) * fx), at).toBeLessThanOrEqual(0.3);
      expect(g.circleClear(t.x, t.z, 0.35), at).toBe(true);
      for (const p of L.props) if (!p.mounted && p.y < 1) expect([at, p.kind, boxDist(p, t.x, t.z) >= 0.35 - 1e-6]).toEqual([at, p.kind, true]);
      expect(Math.hypot(t.x - den.front.x, t.z - den.front.z), at).toBeLessThanOrEqual(1.2);
      // the customer's spot: clear floor in front of the booth, within 2 m of the chute's centre; the chute's ring clear floor
      expect([at, marketStandOk(g, den.front.x, den.front.z), out(den.front.x, den.front.z) > 0.6, Math.hypot(den.front.x - chute.x, den.front.z - chute.z) <= 2]).toEqual([at, true, true, true]);
      const [cx0, cy0] = g.cellOf(chute.x - chute.hx + 0.04, chute.z - chute.hz + 0.04), [cx1, cy1] = g.cellOf(chute.x + chute.hx - 0.04, chute.z + chute.hz - 0.04);
      for (let y = cy0 - 1; y <= cy1 + 1; y++) for (let x = cx0 - 1; x <= cx1 + 1; x++) if (x < cx0 || x > cx1 || y < cy0 || y > cy1) expect([at, x, y, g.walkable(x, y)]).toEqual([at, x, y, true]);
      // the chute's near edge 0.5-2.6 m in front of the booth; its rim at the floor + the kit's rim height
      const ce = out(chute.x, chute.z) - (Math.abs(fx) * chute.hx + Math.abs(fz) * chute.hz);
      expect(ce, at).toBeGreaterThanOrEqual(0.5);
      expect(ce, at).toBeLessThanOrEqual(2.6);
      expect(den.chute.rimY, at).toBeCloseTo(chute.y + CORPSE_SHOP_KIT.chute.rimY, 3);
      // the buyer: clear floor in the back room 0.4-0.8 m behind the booth, facing the customer (forward = (-sin yaw, -cos yaw))
      const bu = den.buyer, behind = -out(bu.x, bu.z) - B.d;
      expect([at, g.area[g.idx(...g.cellOf(bu.x, bu.z))], marketStandOk(g, bu.x, bu.z)]).toEqual([at, den.back, true]);
      expect(behind, at).toBeGreaterThanOrEqual(0.4);
      expect(behind, at).toBeLessThanOrEqual(0.8);
      expect(-Math.sin(bu.yaw) * fx - Math.cos(bu.yaw) * fz, at).toBeGreaterThan(0.99);
    }
  });

  it('discoverable and moody: the painted boards over the door on the Back Lane and at the booth, a dim red lamp by the booth, a dim passage lamp', () => {
    for (const {seed, L} of runs) {
      const at = `seed ${seed}`;
      const {den, door, passage, ids, booth} = denOf(L);
      const lane = L.signs.filter(s => s.area === door.a && Math.hypot(s.x - den.door.x, s.z - den.door.z) <= 1.6);
      expect(lane.map(s => s.text).sort(), at).toEqual([DEN_SIGNS.door, DEN_SIGNS.price].sort());
      for (const s of lane) expect(s.y, at).toBeGreaterThan(door.height); // over the door's head
      expect(L.signs.filter(s => s.area === den.area).map(s => s.text), at).toEqual([DEN_SIGNS.booth]);
      expect(DEN_SIGNS.booth).toMatch(/DEAD ONES ONLY/);
      expect(DEN_SIGNS.door).toMatch(/BODIES BOUGHT/);
      expect(DEN_SIGNS.price).toMatch(/\b10 TIES\b/);
      const lamps = L.lights.filter(l => ids.has(l.area));
      const red = lamps.filter(l => l.tint && l.tint[0] > 1.5 * Math.max(l.tint[1], l.tint[2]));
      expect(red.some(l => l.area === den.area && Math.hypot(l.x - booth.x, l.z - booth.z) <= 2.5 && l.power === DEN_LIGHTS.booth), at).toBe(true);
      expect(lamps.some(l => l.area === passage && !l.tint && l.power === DEN_LIGHTS.passage), at).toBe(true);
      for (const l of lamps) expect([at, l.power <= 0.6, l.broken, l.y < DEN.ceil]).toEqual([at, true, false, true]);
    }
  });

  it('its props: the two den kinds at the cooked kit\'s real size, classified (openables + physics audits); light dressing; no loot, refuge or resident', () => {
    // the kinds: real size from the cooked kit record, every one classified (the audits fail for an unclassified kind)
    for (const [k, m] of [[CORPSE_CHUTE_KIND, CORPSE_SHOP_KIT.chute], [CORPSE_BOOTH_KIND, CORPSE_SHOP_KIT.booth]] as const) {
      const d = CORPSE_DEN_PROP_DEFS[k];
      expect([d.w, d.h, d.d]).toEqual(m.dims.map(v => Math.round(v * 1000) / 1000));
      const open = OPENABLE_AUDIT.find(e => e.kind === k);
      expect([k, open?.cls, open?.role]).toEqual([k, 'none', 'equipment']);
      expect([k, PROP_PHYSICS_AUDIT[k]?.cls]).toEqual([k, 'static']);
      expect(PROP_PHYSICS_AUDIT[k].why).toMatch(/anchored|built-in/);
    }
    expect(unclassifiedPhysicsKinds()).toEqual([]);
    expect(CORPSE_DEN_PROP_DEFS[CORPSE_BOOTH_KIND].w).toBeLessThanOrEqual(2.3 + 1e-6); // (the opening is cut for a booth up to 2.3 m)
    for (const {seed, L} of runs) {
      const at = `seed ${seed}`;
      const {ids} = denOf(L);
      const own = L.props.filter(p => ids.has(p.area));
      expect(own.filter(p => p.kind === CORPSE_CHUTE_KIND).length + own.filter(p => p.kind === CORPSE_BOOTH_KIND).length, at).toBe(2);
      const decor = own.filter(p => !(CORPSE_DEN_KINDS as readonly string[]).includes(p.kind));
      expect(decor.length, at).toBeGreaterThanOrEqual(3);
      for (const p of own) {
        expect([at, p.kind, !!PROP_PHYSICS_AUDIT[p.kind], p.y, p.level ?? 0]).toEqual([at, p.kind, true, 0, 0]); // classified, on the floor
        if (isLootHolderKind(p.kind)) expect([at, p.kind, p.purpose]).toEqual([at, p.kind, MARKET_EMPTY_KEY]);
      }
      const stallAreas = new Set(L.market!.stalls.map(s => s.area));
      for (const id of ids) expect([at, refugeKindOf(L.areas[id], stallAreas), gearAreaWeight(L.areas[id])]).toEqual([at, null, 0]);
      expect(L.market!.spots.some(s => ids.has(s.area)) || L.market!.stalls.some(s => ids.has(s.area)), at).toBe(false);
    }
  });
});
