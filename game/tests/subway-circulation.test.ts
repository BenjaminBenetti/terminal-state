// Task studio-subway-vertical-layout-20261118-022131-01: THE SUBWAY'S LAYOUT-VERSION-4 CIRCULATION PLANS (gen/subwayCirculation.ts).
// User: "Prioritize real differences in floorplans and vertical circulation between stations and within families ... Keep some
// compact/current plans and let other stations gain different levels, loops, landings, overlook connections or branches where they fit.
// Make added areas reachable, legible and useful, with sensible stairs, clearances and wayfinding ... Version structural changes for
// new/unvisited Subway stations only. Preserve visited layouts and saved objects ... Keep independent add-on/Surface eligibility and the
// normal closed-exit cargo-lift contract; new plans must not move access to the food court or strand the player."
//  - the roll: its own salt and weights; a compact roll (and a recorded version 3 or older) builds the version-3 station byte for byte;
//  - a GALLERY station: a double-height hall with an upper overlook gallery at the upper level, an open stair bank (capped well,
//    balustrades), a gallery bridge from a platform deck where the rock allows (a loop), a beam ceiling (no vault over the gallery), no hall
//    fixture over the bank, wayfinding at both ends;
//  - an UNDERPASS station: a public pedestrian subway on the service level at the far end of the platforms from the stair cores, a stair
//    down behind each platform's back wall, plant rooms off it, wayfinding;
//  - every plan validates (stacked-level rules, reachability on every level), keeps the train and the Surface Run's closed-exit lift, and
//    never touches the food court.

import {describe, expect, it} from 'vitest';
import {validateLayout, type StationLayout} from '../src/gen/station';
import {LEVELS} from '../src/levels/registry';
import {SURFACE_VERSION, surfacePresent} from '../src/gen/surface/surfaceRun';
import {CELL, FLOOR, SOLID} from '../src/gen/grid';
import {LEVEL_LOWER, LEVEL_MAIN, LEVEL_UPPER, LOWER_FLOOR, SLAB, levelDistance} from '../src/gen/levelGen';
import {CIRC, CIRCULATION_WEIGHTS, circulationMouths, circulationOf, type CirculationPlan} from '../src/gen/subwayCirculation';
import {SUBWAY_CIRCULATION_MIN_VERSION, SUBWAY_LAYOUT_LANE, SUBWAY_LAYOUT_VERSION, subwayLayoutVersionFor} from '../src/gen/subwayLayoutVersion';
import {planFamilyOf} from '../src/gen/stationPlans';
import {ceilingFormOf} from '../src/gen/subwayCeilings';
import {playerTrainPlacement} from '../src/gen/playerTrain';
import {Levels, levelsOf} from '../src/gen/levels';

/** Natural seeds (nothing forced): what each rolls and builds at version 4 (the game's call, the current Surface Run). */
const GALLERY_SEEDS = {hubGrandStair: 19, mezzanineBridge: 37, cavernTicketHall: 5, splitTicketHall: 22} as const;
const UNDERPASS_SEEDS = {grandHallTunnel: 3, cavern: 8, hub: 16} as const;
const BOTH_SEEDS = {cavern: 14, hubGrandStair: 104, split: 26} as const;
const COMPACT_SEEDS = [0, 1, 4, 6, 7] as const;

const cache = new Map<string, StationLayout>();
const gen = (seed: number, version: number, surface = SURFACE_VERSION): StationLayout => {
  const key = `${seed}:${version}:${surface}`;
  let L = cache.get(key);
  if (!L) cache.set(key, (L = LEVELS.subway.generate('main', {levelSeed: seed, surfaceVersion: surface, layoutVersion: version}) as StationLayout));
  return L;
};
function layoutHash(l: unknown): string {
  const json = JSON.stringify(l, (_k, v) => {
    if (ArrayBuffer.isView(v)) { const b = new Uint8Array(v.buffer, v.byteOffset, v.byteLength); let x = 2166136261; for (let i = 0; i < b.length; i++) x = Math.imul(x ^ b[i], 16777619); return `#${b.length}:${x >>> 0}`; }
    return v;
  });
  let x = 2166136261;
  for (let i = 0; i < json.length; i++) x = Math.imul(x ^ json.charCodeAt(i), 16777619);
  return `${json.length}:${(x >>> 0).toString(16)}`;
}
const inRect = (a: {x: number; y: number; w: number; h: number}, x: number, z: number, m = 0) =>
  x >= a.x * CELL - m && x < (a.x + a.w) * CELL + m && z >= a.y * CELL - m && z < (a.y + a.h) * CELL + m;
/** Walking distance on every level from the player spawn (the validator's own flood). */
const reach = (L: StationLayout) => { const [sx, sy] = L.grid.cellOf(L.playerSpawn.x, L.playerSpawn.z); return levelDistance(L.levels, sx, sy, 0, L.levelLinks); };
const reachedIn = (L: StationLayout, d: Int32Array[], a: {id: number; level?: number}) => {
  const lv = a.level ?? 0, g = L.levels[lv].grid;
  for (let i = 0; i < g.area.length; i++) if (g.area[i] === a.id && g.cells[i] === FLOOR && d[lv][i] >= 0) return true;
  return false;
};

describe('the version-4 roll and the version policy', () => {
  it('its own salt and weights; about a third of the stations keep the compact plan', () => {
    const N = 3000, count = new Map<CirculationPlan, number>();
    for (let s = 1; s <= N; s++) count.set(circulationOf(s), (count.get(circulationOf(s)) ?? 0) + 1);
    for (const [p, w] of CIRCULATION_WEIGHTS) {
      expect((count.get(p) ?? 0) / N, p).toBeGreaterThan(w - 0.04);
      expect((count.get(p) ?? 0) / N, p).toBeLessThan(w + 0.04);
    }
    // independent of the family roll (both families' shares of every plan stay near the plan's weight)
    for (const fam of ['classic', 'cavern'] as const) {
      const seeds = Array.from({length: N}, (_, i) => i + 1).filter(s => planFamilyOf(s) === fam);
      expect(seeds.filter(s => circulationOf(s) === 'compact').length / seeds.length, fam).toBeGreaterThan(0.25);
      expect(seeds.filter(s => circulationOf(s) === 'compact').length / seeds.length, fam).toBeLessThan(0.39);
    }
    expect(Object.values(GALLERY_SEEDS).every(s => circulationOf(s) === 'gallery')).toBe(true);
    expect(COMPACT_SEEDS.every(s => circulationOf(s) === 'compact')).toBe(true);
  });

  it('version 4 is the new build; a recorded version (3 or older) is kept', () => {
    expect(SUBWAY_LAYOUT_VERSION).toBe(4);
    expect(SUBWAY_CIRCULATION_MIN_VERSION).toBe(4);
    expect(subwayLayoutVersionFor(undefined)).toBe(4);
    expect(subwayLayoutVersionFor({visits: 2, lanes: {}})).toBe(1);
    for (const v of [1, 2, 3, 4]) expect(subwayLayoutVersionFor({visits: 5, lanes: {[SUBWAY_LAYOUT_LANE]: {v}}})).toBe(v);
  });

  it('a compact roll builds its version-3 station byte for byte; version 3 carries no circulation at any seed', () => {
    for (const s of COMPACT_SEEDS) {
      const a = gen(s, 3), b = gen(s, 4);
      expect(b.levelPlan?.circ, `seed ${s}`).toBeUndefined();
      expect(layoutHash(b), `seed ${s} (${b.archetype})`).toBe(layoutHash(a));
    }
    for (const s of [...Object.values(GALLERY_SEEDS), ...Object.values(UNDERPASS_SEEDS), ...Object.values(BOTH_SEEDS)]) {
      const L = gen(s, 3);
      expect(L.levelPlan?.circ ?? L.levelPlan?.runs, `seed ${s}`).toBeUndefined();
      expect(L.areas.some(a => a.galleried || a.role === 'overlook' && a.label.startsWith('Gallery') || a.label === 'Pedestrian subway'), `seed ${s}`).toBe(false);
    }
  }, 240_000);

  it('a version-4 station regenerates identically (its saved objects / ids / loot keep referring to the same build)', () => {
    for (const s of [GALLERY_SEEDS.hubGrandStair, UNDERPASS_SEEDS.grandHallTunnel, BOTH_SEEDS.split]) {
      const a = gen(s, 4);
      const b = LEVELS.subway.generate('main', {levelSeed: s, surfaceVersion: SURFACE_VERSION, layoutVersion: 4});
      expect(layoutHash(b), `seed ${s}`).toBe(layoutHash(a));
    }
  }, 240_000);

  it('the family, identity and platforms are version 3\'s (the plan only adds circulation round the same skeleton)', () => {
    for (const s of [...Object.values(GALLERY_SEEDS), ...Object.values(UNDERPASS_SEEDS), ...Object.values(BOTH_SEEDS)]) {
      const a = gen(s, 3), b = gen(s, 4);
      expect(b.archetype, `seed ${s}`).toBe(a.archetype);
      expect(b.identity, `seed ${s}`).toEqual(a.identity);
      expect(b.name, `seed ${s}`).toBe(a.name);
      const plat = (L: StationLayout) => L.areas.filter(x => x.kind === 'platform').map(p => [p.platformNo, p.w, p.h, p.label]);
      expect(plat(b), `seed ${s}`).toEqual(plat(a));
    }
  }, 240_000);
});

describe('gallery stations', () => {
  for (const [name, s] of Object.entries({...GALLERY_SEEDS, ...Object.fromEntries(Object.entries(BOTH_SEEDS).map(([k, v]) => [`${k}+underpass`, v]))})) {
    it(`${name} (seed ${s}): a double-height hall, its overlook gallery, the open stair bank, railings, ceiling and wayfinding`, () => {
      const L = gen(s, 4);
      expect(validateLayout(L), `seed ${s}`).toEqual([]);
      const c = L.levelPlan!.circ!;
      expect(c.plan).toBe((Object.values(BOTH_SEEDS) as number[]).includes(s) ? 'gallery+underpass' : 'gallery');
      const g = c.gallery!, lp = L.levelPlan!;
      const H = L.areas[g.host], G = L.areas[g.gallery], S = L.areas[g.stair];
      expect(H.galleried).toBe(true);
      expect(H.level ?? 0).toBe(LEVEL_MAIN);
      expect(H.type === 'food-court' || H.type === 'retail-arcade').toBe(false);
      // the gallery: on the upper level at the deck height, inside the hall, at least ~14 m long and 2.5 m deep
      expect(G.level).toBe(LEVEL_UPPER);
      expect(G.floorY).toBeCloseTo(lp.hu, 6);
      expect(G.x >= H.x && G.x + G.w <= H.x + H.w && G.y >= H.y && G.y + G.h <= H.y + H.h).toBe(true);
      expect(G.w * CELL).toBeGreaterThanOrEqual(CIRC.galleryMin * CELL);
      expect(G.h * CELL).toBeGreaterThanOrEqual(2.5);
      // the hall's cells: double height in the open part, a slab below the gallery under it
      const g0 = L.grid;
      let open = 0, under = 0;
      for (let y = H.y; y < H.y + H.h; y++) for (let x = H.x; x < H.x + H.w; x++) {
        const i = g0.idx(x, y);
        if (g0.area[i] !== H.id) continue;
        if (inRect(G, (x + 0.5) * CELL, (y + 0.5) * CELL)) { expect(g0.ceil[i]).toBeLessThanOrEqual(lp.hu - SLAB + 1e-6); under++; }
        else { expect(g0.ceil[i]).toBeGreaterThanOrEqual(lp.upperCeil - 1e-6); open++; }
      }
      expect(open).toBeGreaterThan(under);
      // the open stair bank: one flight set from the hall floor to the gallery, capped well, its own LevelLink, 2 m wide
      const run = lp.runs!.find(r => r.area === S.id)!;
      expect(run.open).toBe(true);
      const fl = run.flights.map(id => L.traversal.stairs[id]);
      expect(Math.min(...fl.map(f => Math.min(f.h0, f.h1)))).toBeCloseTo(0, 6);
      expect(Math.max(...fl.map(f => Math.max(f.h0, f.h1)))).toBeCloseTo(lp.hu, 6);
      for (const f of fl) { expect(L.grid.ramps[f.ramp].capCeil).toBe(true); expect(Math.abs(f.a1 - f.a0)).toBeGreaterThanOrEqual(1.8); }
      const link = L.levelLinks.find(k => k.traversalId === fl[0].id)!;
      expect([link.kind, link.lower, link.upper]).toEqual(['stairs', LEVEL_MAIN, LEVEL_UPPER]);
      // reachable: the gallery from the spawn; with a bridge also from the deck without the bank (a loop through the platform)
      const d = reach(L);
      expect(reachedIn(L, d, G), 'the gallery is reachable').toBe(true);
      if (g.bridge >= 0) {
        const B = L.areas[g.bridge];
        expect(B.level).toBe(LEVEL_UPPER);
        expect(L.doors.some(o => o.level === LEVEL_UPPER && ((o.a === g.deck && o.b === B.id) || (o.b === g.deck && o.a === B.id))), 'deck -> bridge').toBe(true);
        expect(L.doors.some(o => o.level === LEVEL_UPPER && ((o.a === B.id && o.b === G.id) || (o.b === B.id && o.a === G.id))), 'bridge -> gallery').toBe(true);
        // the main level under the bridge: rock, or a space a slab below the deck level
        for (let y = B.y; y < B.y + B.h; y++) for (let x = B.x; x < B.x + B.w; x++) {
          const i = g0.idx(x, y);
          if (g0.cells[i] !== SOLID) expect(g0.ceil[i], `under the bridge ${x},${y}`).toBeLessThanOrEqual(lp.hu - SLAB + 1e-6);
        }
      }
      // balustrades: the pitched rails along both flanks of the bank (main level), and railed gallery edges (upper level)
      const pitched = L.rails.filter(r => r.level === LEVEL_MAIN && Math.abs(r.y1 - r.y0) > 1 && (inRect(S, r.x0, r.z0, 0.05) || inRect(S, r.x1, r.z1, 0.05)));
      expect(pitched.length, 'two pitched flank rails').toBeGreaterThanOrEqual(2);
      const galleryEdge = L.rails.filter(r => r.level === LEVEL_UPPER && Math.abs(r.y0 - lp.hu) < 1e-3 && inRect(G, (r.x0 + r.x1) / 2, (r.z0 + r.z1) / 2, 0.3));
      expect(galleryEdge.length, 'the gallery edge is railed').toBeGreaterThanOrEqual(1);
      // the flank rails follow the walking surface: every ~0.25 m along each flight and landing a rail stands on it (the bank's own on the
      // main level, a derived piece over an aperture on the upper level: collision reads the rail's height, not its level)
      const alongX = fl[0].axis === 'x', down = [...fl].sort((f, q) => Math.max(q.h0, q.h1) - Math.max(f.h0, f.h1));
      const top = (f: (typeof fl)[0]) => (f.h0 >= f.h1 ? [f.s0, f.h0] : [f.s1, f.h1]), foot = (f: (typeof fl)[0]) => (f.h0 >= f.h1 ? [f.s1, f.h1] : [f.s0, f.h0]);
      const pieces: number[][] = [];
      down.forEach((f, k) => { pieces.push([...top(f), ...foot(f)]); if (k + 1 < down.length) pieces.push([...foot(f), ...top(down[k + 1])]); });
      for (const q of alongX ? [S.y * CELL, (S.y + S.h) * CELL] : [S.x * CELL, (S.x + S.w) * CELL]) {
        const onLine = L.rails.filter(r => (alongX ? r.z0 === q && r.z1 === q : r.x0 === q && r.x1 === q));
        for (const [sA, yA, sB, yB] of pieces) {
          const n = Math.max(1, Math.ceil(Math.abs(sB - sA) / 0.25));
          for (let j = 0; j < n; j++) {
            const t = (j + 0.5) / n, s = sA + (sB - sA) * t, y = yA + (yB - yA) * t, [x, z] = alongX ? [s, q] : [q, s];
            const hit = onLine.some(r => { const u = alongX ? r.x0 : r.z0, v = alongX ? r.x1 : r.z1; return s >= Math.min(u, v) - 1e-6 && s <= Math.max(u, v) + 1e-6 && Math.abs(Levels.railBaseAt(r, x, z) - y) < 0.05; });
            expect(hit, `flank ${q} at ${s.toFixed(2)}`).toBe(true);
          }
        }
      }
      // the lead's mouth stays open: a straight walk from the top of the bank 1 m onto the gallery's floor beside it / beyond it clears
      // every railing
      const Lv = levelsOf(L), gu = L.levels[LEVEL_UPPER].grid, [st, sy] = top(down[0]);
      const [a0, a1] = alongX ? [S.x * CELL, (S.x + S.w) * CELL] : [S.y * CELL, (S.y + S.h) * CELL];
      const [c0, c1] = alongX ? [S.y * CELL, (S.y + S.h) * CELL] : [S.x * CELL, (S.x + S.w) * CELL];
      const topEdge = Math.abs(st - a0) < Math.abs(st - a1) ? a0 : a1, lead = (st + topEdge) / 2, mid = (c0 + c1) / 2;
      const xz = (s: number, c: number): [number, number] => (alongX ? [s, c] : [c, s]);
      const onGallery = ([x, z]: [number, number]) => { const [cx, cz] = gu.cellOf(x, z); const i = gu.idx(cx, cz); return gu.cells[i] === FLOOR && Math.abs(gu.floor[i] - lp.hu) < 0.05; };
      const mouth = [xz(lead, c0 - 1), xz(lead, c1 + 1), xz(topEdge + Math.sign(topEdge - st) * 1, mid)].find(onGallery);
      expect(mouth, 'the gallery floor at the mouth').toBeDefined();
      const [lx, lz] = xz(lead, mid);
      expect(Lv.walkLineClear(lx, sy, lz, mouth![0], mouth![1], 0.3, lp.hu), `the mouth (${lx},${lz}) -> (${mouth})`).toBe(true);
      // ... and nothing the dresser placed stands on the gallery in front of it
      const mouths = circulationMouths(L);
      expect(mouths.length, 'the bank has a mouth').toBeGreaterThanOrEqual(1);
      for (const m of mouths) for (let y = m.y; y < m.y + m.h; y++) for (let x = m.x; x < m.x + m.w; x++) expect(gu.blocked[gu.idx(x, y)], `mouth cell ${x},${y}`).toBeFalsy();
      // a beam ceiling over the full-height part (never a vault reaching down over the gallery)
      expect(ceilingFormOf(L, H).kind === 'vault' || ceilingFormOf(L, H).kind === 'rock').toBe(false);
      // nothing of the hall hangs or stands over the bank; wayfinding at its foot and head
      expect(L.lights.filter(l => !l.level && l.area !== S.id && inRect(S, l.x, l.z, 0.25)), 'hall fixtures over the bank').toEqual([]);
      expect(L.signs.filter(x => !x.level && x.hang && inRect(S, x.x, x.z, 0.25)), 'hall signs over the bank').toEqual([]);
      for (const k of ['props', 'pickups', 'zombies'] as const) {
        expect((L[k] as {x: number; z: number; level?: number}[]).filter(p => !p.level && inRect(S, p.x, p.z)), k).toEqual([]);
      }
      expect(L.signs.some(x => x.area === H.id && /GALLERY/.test(x.text) && x.arrow === 'up'), 'the way up').toBe(true);
      expect(L.signs.some(x => x.area === G.id && /STAIRS DOWN/.test(x.text)), 'the way down').toBe(true);
      // no drop edge is left open (Levels' own drop rule: the bank's lead, a gallery's end over the hall)
      expect(levelsOf(L).unrailedDrops(), 'unrailed drops').toEqual([]);
      expect(playerTrainPlacement(L), 'the player train').not.toBeNull();
    }, 120_000);
  }

  it('the plans differ within a family: a hub grand stair with a bridge loop, a mezzanine bank with a bridge, ticket-hall banks', () => {
    const notes = Object.values(GALLERY_SEEDS).map(s => gen(s, 4).levelPlan!.circ!.notes.join(' '));
    expect(notes[0]).toMatch(/interchange-hall:N:grand-stair:.*\+bridge/);
    expect(notes[1]).toMatch(/mezzanine:N:bank:.*\+bridge/);
    expect(notes[2]).toMatch(/ticket-hall:[NS]:bank/);
    expect(new Set(notes.map(n => n.split(':').slice(1, 4).join(':'))).size).toBeGreaterThanOrEqual(3);
  }, 120_000);
});

describe('underpass stations', () => {
  for (const [name, s] of Object.entries({...UNDERPASS_SEEDS, ...BOTH_SEEDS})) {
    it(`${name} (seed ${s}): a public pedestrian subway beneath the platforms at their far end, its stairs, rooms and wayfinding`, () => {
      const L = gen(s, 4);
      expect(validateLayout(L), `seed ${s}`).toEqual([]);
      const c = L.levelPlan!.circ!, u = c.underpass!, lp = L.levelPlan!;
      expect(c.plan).toBe((Object.values(BOTH_SEEDS) as number[]).includes(s) ? 'gallery+underpass' : 'underpass');
      const X = L.areas[u.subway];
      expect([X.level, X.floorY, X.publicSpace, X.type]).toEqual([LEVEL_LOWER, LOWER_FLOOR, true, 'underpass']);
      // beneath both platforms (it spans their rows and the beds between)
      const [P1, P2] = u.platforms.map(id => L.areas[id]);
      for (const P of [P1, P2]) expect(X.y <= P.y && X.y + X.h >= P.y + P.h, `under platform ${P.platformNo}`).toBe(true);
      // far from the stair cores: the other end of the platforms
      const cores = lp.cores.map(k => L.areas[k.lobby]);
      for (const C of cores) expect(Math.min(Math.abs(X.x - (C.x + C.w)), Math.abs(C.x - (X.x + X.w))) * CELL, 'away from a core').toBeGreaterThanOrEqual(CIRC.coreGap * CELL);
      // a stair down behind each platform's back wall (their own LevelLinks), a lobby doorway onto each platform
      expect(u.stairs.length).toBe(2);
      for (const [k, id] of u.stairs.entries()) {
        const run = lp.runs!.find(r => r.area === id)!;
        const fl = run.flights.map(f => L.traversal.stairs[f]);
        const link = L.levelLinks.find(q => q.traversalId === fl[0].id)!;
        expect([link.lower, link.upper]).toEqual([LEVEL_LOWER, LEVEL_MAIN]);
        const P = k === 0 ? P1 : P2, lobby = u.lobbies[k];
        expect(L.doors.some(d => (d.a === P.id && d.b === lobby) || (d.b === P.id && d.a === lobby)), `platform ${P.platformNo} -> lobby`).toBe(true);
      }
      const d = reach(L);
      expect(reachedIn(L, d, X), 'the subway is reachable').toBe(true);
      for (const id of u.rooms) { expect(L.areas[id].level).toBe(LEVEL_LOWER); expect(reachedIn(L, d, L.areas[id]), `room ${id}`).toBe(true); }
      if (u.tunnel >= 0) expect(L.doors.some(o => o.a === lp.gallery && o.b === u.tunnel), 'tunnel joins the service gallery').toBe(true);
      // lit as a public passage: its own fixtures; no service-crossing landmark lamp at its stair feet
      expect(L.lights.some(l => l.area === X.id)).toBe(true);
      expect(L.lights.filter(l => l.area === lp.crossing && inRect(X, l.x, l.z))).toEqual([]);
      // wayfinding: on each platform, in each lobby, at each stair foot
      for (const P of [P1, P2]) expect(L.signs.some(x => x.area === P.id && /PEDESTRIAN SUBWAY/.test(x.text)), `platform ${P.platformNo}`).toBe(true);
      expect(L.signs.filter(x => x.area === X.id && /STAIRS UP/.test(x.text)).length).toBe(2);
      expect(levelsOf(L).unrailedDrops(), 'unrailed drops').toEqual([]);
      expect(playerTrainPlacement(L), 'the player train').not.toBeNull();
    }, 120_000);
  }
});

describe('access contracts', () => {
  it('the Surface Run access: its closed exit-stair lift on every version-4 plan, never from the food court; eligibility is the seed\'s', () => {
    let checked = 0;
    for (let s = 0; s < 120 && checked < 8; s++) {
      if (circulationOf(s) === 'compact' || !surfacePresent('subway', s, SURFACE_VERSION)) continue;
      const L0 = gen(s, 4, 0), L = gen(s, 4);
      if (!L.levelPlan?.circ) continue;
      expect(L0.surfaceAccess, `seed ${s}`).toBeUndefined();
      const a = L.surfaceAccess!;
      expect(a?.kind, `seed ${s}`).toBe('lift');
      const hall = L.areas[a.hall!];
      expect(hall.type, `seed ${s}`).toBe('exit-stair');
      const parent = L.areas[hall.parent];
      expect(parent.type === 'food-court' || parent.type === 'retail-arcade', `seed ${s}`).toBe(false);
      const base = new Set(validateLayout(L0));
      expect(validateLayout(L).filter(x => !base.has(x)), `seed ${s}`).toEqual([]);
      // the Surface eligibility roll does not depend on the layout version
      expect(surfacePresent('subway', s, SURFACE_VERSION)).toBe(true);
      checked++;
    }
    expect(checked).toBeGreaterThanOrEqual(4);
  }, 600_000);

  it('the food court and every exit stay reachable; no new area joins the food court or a retail arcade', () => {
    for (const s of [...Object.values(GALLERY_SEEDS), ...Object.values(UNDERPASS_SEEDS), ...Object.values(BOTH_SEEDS)]) {
      const L = gen(s, 4), c = L.levelPlan!.circ!;
      const ids = new Set([c.gallery?.gallery, c.gallery?.stair, c.gallery?.bridge, c.underpass?.subway, ...(c.underpass?.lobbies ?? []), ...(c.underpass?.stairs ?? []), ...(c.underpass?.rooms ?? []), c.underpass?.tunnel].filter((v): v is number => v !== undefined && v >= 0));
      const fc = new Set(L.areas.filter(a => a.type === 'food-court' || a.type === 'retail-arcade').map(a => a.id));
      expect(L.doors.filter(o => (ids.has(o.a) && fc.has(o.b)) || (ids.has(o.b) && fc.has(o.a))), `seed ${s}`).toEqual([]);
      if (c.gallery) expect(fc.has(c.gallery.host), `seed ${s}`).toBe(false);
      const d = reach(L);
      for (const a of L.areas.filter(x => x.type === 'food-court' || x.type === 'exit-stair')) expect(reachedIn(L, d, a), `seed ${s} ${a.label}`).toBe(true);
    }
  }, 240_000);
});
