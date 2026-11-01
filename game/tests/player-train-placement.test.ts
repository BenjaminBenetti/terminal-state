// Task player-train-shell-20261101-202805 (lane PLACE): where the player's home train is parked (gen/playerTrain.ts), the start
// arrival inside it (levels/registry.ts arrivalPose) and its one run identity (run/playerTrain.ts).
//
// Corpus (one cached layout each; ~27 levels): every Subway archetype (side / island / express / interchange / split / deep; seeds with
// and without the finishExtensions core translation), the Subway service-hatch levels, Office Space (incl. presence-fallback hatch
// levels) and every mall variant. Every level must place the car on its START platform's edge track: on a track centre line in the
// bed with the wheels on the rails, inside the platform span, clear of the rescue ladders / hatches / bed ends / props (columns) /
// bed spawns and loot, under the ceiling, its platform-side doors facing the platform across the gap; the start pose inside the
// saloon at the interior floor; deterministic; and the layout untouched.
import {describe, expect, it} from 'vitest';
import {LEVELS, arrivalPose} from '../src/levels/registry';
import {generateStation} from '../src/gen/station';
import {generateMallLevel} from '../src/gen/mall/index';
import {MALL_VARIANTS} from '../src/gen/mall/frame';
import {coreView} from '../src/gen/trackExt/index';
import {CELL, VOID} from '../src/gen/grid';
import {ARCHETYPES, TRENCH_DEPTH, type Archetype, type StationLayout} from '../src/gen/stationTypes';
import {
  EDGE_TO_TRACK, RAIL_GAUGE_HALF, RAIL_TOP_ABOVE_BED, TRAIN_CLEAR, TRAIN_SPAWN, playerTrainPlacement, trainSpawnLocal, trainSpawnPose,
  trainToWorld, worldToTrain, type TrainPlacement,
} from '../src/gen/playerTrain';
import {PLAYER_TRAIN_SPEC, type PlayerTrainSpec} from '../src/world/playerTrainSpec';
import {SHELL} from '../src/world/trackExt/shell';
import {PLAYER_TRAIN_L1, PLAYER_TRAIN_PARTICIPANT, PlayerTrainRecord} from '../src/run/playerTrain';
import {resetParticipants, restoreParticipants, type RunSnapshot} from '../src/run/snapshot';

type Entry = {tag: string; kind: 'subway' | 'office' | 'mall'; make: () => StationLayout};
const SUBWAY: Entry[] = ARCHETYPES.flatMap((arch: Archetype) => [11, 9001].map(seed => ({tag: `subway ${arch} ${seed}`, kind: 'subway' as const, make: () => generateStation(seed, {archetype: arch})})));
// tests/track-ext.test.ts SUBWAY_HATCH: island-ends (one hatch), express (two), interchange (a tunnel annex + a hatch)
const HATCH: Entry[] = [1514198804, 1549120013, 1874796201].map(seed => ({tag: `subway hatch ${seed}`, kind: 'subway' as const, make: () => generateStation(seed)}));
// 31702 / 3689933781: Office presence-fallback hatch levels (tests/office-area-fallback.test.ts FORMER)
const OFFICE: Entry[] = [4242, 222, 7, 13, 31702, 3689933781].map(levelSeed => ({tag: `office ${levelSeed}`, kind: 'office' as const, make: () => LEVELS.office.generate('main', {levelSeed})}));
const MALL: Entry[] = MALL_VARIANTS.map((variant, k) => ({tag: `mall ${variant}`, kind: 'mall' as const, make: () => generateMallLevel({levelSeed: 4242 + k}, {variant})}));
const CORPUS = [...SUBWAY, ...HATCH, ...OFFICE, ...MALL];

const cache = new Map<string, StationLayout>();
const layoutOf = (e: Entry): StationLayout => { let l = cache.get(e.tag); if (!l) cache.set(e.tag, (l = e.make())); return l; };
const entry = (tag: string): Entry => CORPUS.find(e => e.tag === tag)!;
const spec = PLAYER_TRAIN_SPEC;
const EPS = 1e-6;

/** The generated start pose (unchanged by this lane): Office / Mall platform start, else playerSpawn. */
const startOf = (L: StationLayout) => L.office?.start ?? L.mall?.start ?? {...L.playerSpawn, level: 0};

/** Every acceptance check of one placement (returns a one-line summary for the report). */
function check(tag: string, kind: Entry['kind'], L: StationLayout, p: TrainPlacement | null, s: PlayerTrainSpec = spec, ladderClear: number = TRAIN_CLEAR.ladder): string {
  expect(p, `${tag}: placed`).not.toBeNull();
  if (!p) return '';
  const t = L.trenches[p.trenchIndex], g = L.grid, plat = L.areas[p.platformArea];
  const W = s.width, roofY = p.railTopY + s.roofY;
  // the START platform (never a fallback): Subway P1, the Office island, the Mall's P2 (north platform, edge S) under the atrium
  const st = startOf(L);
  expect(p.platformArea, `${tag}: start platform`).toBe(g.areaAt(st.x, st.z));
  if (kind === 'subway') expect(p.platformArea, tag).toBe(L.platform);
  if (kind === 'office') expect(plat.edge, `${tag}: the island`).toBe('NS');
  if (kind === 'mall') {
    expect(plat.edge, `${tag}: P2`).toBe('S');
    const vb = L.mall!.void.bounds;
    expect(Math.min(vb.x1, p.x1) - Math.max(vb.x0, p.x0), `${tag}: under the atrium`).toBeGreaterThan(3);
  }
  // on a track centre line 2.0 m out from the platform edge, platform side / front / yaw consistent (right-handed frame)
  expect(p.z, tag).toBe(t.tracks[p.trackIndex]);
  expect(p.trackZ, tag).toBe(p.z);
  expect(Math.abs(p.z - p.platformEdgeZ), `${tag}: edge -> track`).toBeCloseTo(EDGE_TO_TRACK, 6);
  expect(Math.sign(p.platformEdgeZ - p.z), `${tag}: platform side`).toBe(p.platformSide);
  expect(p.platformEdgeZ, tag).toBe((p.platformSide === 1 ? plat.y : plat.y + plat.h) * CELL);
  expect(p.front, tag).toBe(-p.platformSide);
  expect(p.yaw, tag).toBe(p.front === 1 ? 0 : Math.PI);
  expect(p.level, tag).toBe(plat.level ?? 0);
  for (const [lx, ly, lz] of [[3.2, 1, -0.7], [-6, 0.4, 1.1]]) { // trainToWorld = (x, railTopY, z) + R_y(yaw) · local (three.js rotation.y)
    const w = trainToWorld(p, lx, ly, lz), c = Math.cos(p.yaw), sn = Math.sin(p.yaw);
    expect(w.x, tag).toBeCloseTo(p.x + c * lx + sn * lz, 9);
    expect(w.z, tag).toBeCloseTo(p.z - sn * lx + c * lz, 9);
    expect(w.y, tag).toBeCloseTo(p.railTopY + ly, 12);
    const back = worldToTrain(p, w.x, w.y, w.z);
    expect([back.x, back.y, back.z].map(v => +v.toFixed(9)), tag).toEqual([lx, ly, lz]);
  }
  // heights: rail top = bed + 0.295, interior floor one step at most above the platform
  expect(p.railTopY, tag).toBeCloseTo(t.floorY + RAIL_TOP_ABOVE_BED, 9);
  expect(p.floorY, tag).toBeCloseTo(p.railTopY + s.floorY, 9);
  const platFloor = g.floorAt(p.x, p.platformEdgeZ + p.platformSide * 0.75);
  expect(p.floorY - platFloor, `${tag}: step up into the car`).toBeGreaterThanOrEqual(0);
  expect(p.floorY - platFloor, `${tag}: step up into the car`).toBeLessThanOrEqual(TRAIN_CLEAR.maxStep);
  // wheels on the rails: the bogie centre lines (local z = +-gauge) land on that track's running rails at rail-top height
  const rails = [-1, 1].map(k => trainToWorld(p, 0, 0, k * RAIL_GAUGE_HALF)).sort((a, b) => a.z - b.z);
  expect(rails.map(r => r.z), tag).toEqual([p.z - RAIL_GAUGE_HALF, p.z + RAIL_GAUGE_HALF].map(v => expect.closeTo(v, 9)));
  for (const r of rails) expect(r.y, tag).toBeCloseTo(p.railTopY, 12);
  expect(W / 2, `${tag}: body spans both rails`).toBeGreaterThan(RAIL_GAUGE_HALF);
  // inside the bed (clear of its end faces / tunnel mouths) and inside the platform span
  expect(p.x1 - p.x0, tag).toBeCloseTo(s.length, 9);
  expect(p.x0, `${tag}: bed end`).toBeGreaterThanOrEqual(t.x0 + TRAIN_CLEAR.bedEnd - EPS);
  expect(p.x1, `${tag}: bed end`).toBeLessThanOrEqual(t.x1 - TRAIN_CLEAR.bedEnd + EPS);
  expect(p.z - W / 2, tag).toBeGreaterThanOrEqual(t.z0);
  expect(p.z + W / 2, tag).toBeLessThanOrEqual(t.z1);
  expect(p.x0, `${tag}: platform span`).toBeGreaterThanOrEqual(Math.max(t.platformX0, plat.x * CELL) - EPS);
  expect(p.x1, `${tag}: platform span`).toBeLessThanOrEqual(Math.min(t.platformX1, (plat.x + plat.w) * CELL) + EPS);
  // between rescue-ladder stations of the face it stands at, with room for a player at each ladder foot
  const near = L.traversal.ladders.filter(l => l.trench === p.trenchIndex && Math.abs(l.bottom.z - p.z) < W / 2 + ladderClear);
  expect(near.length, `${tag}: ladders on the face`).toBeGreaterThan(0);
  for (const l of near) expect(l.x <= p.x0 - ladderClear + EPS || l.x >= p.x1 + ladderClear - EPS, `${tag}: ladder at ${l.x} vs ${p.x0}..${p.x1}`).toBe(true);
  expect(near.some(l => l.x < p.x0) && near.some(l => l.x > p.x1), `${tag}: between ladder stations`).toBe(true);
  // service hatches (bed entries) keep their opening + approach
  const hatches = (L.extensions?.annexes ?? []).filter(n => n.bed && n.bed.trench === p.trenchIndex).map(n => n.bed!);
  for (const b of hatches) expect(b.x + b.width / 2 + TRAIN_CLEAR.hatch <= p.x0 + EPS || b.x - b.width / 2 - TRAIN_CLEAR.hatch >= p.x1 - EPS, `${tag}: hatch at ${b.x}`).toBe(true);
  // no prop in the body box (the two-track centre columns: lateral clearance, and the check is not vacuous on column beds)
  for (const q of L.props) {
    if ((q.level ?? 0) !== p.level || q.y >= roofY || q.y + q.h <= t.floorY + 0.02) continue;
    const hit = q.x + q.hx > p.x0 && q.x - q.hx < p.x1 && q.z + q.hz > p.z - W / 2 - TRAIN_CLEAR.prop && q.z - q.hz < p.z + W / 2 + TRAIN_CLEAR.prop;
    expect(hit, `${tag}: ${q.kind} at ${q.x},${q.z} inside the car`).toBe(false);
  }
  if (t.columns) {
    const cols = L.props.filter(q => q.kind === 'column' && q.x + q.hx > p.x0 && q.x - q.hx < p.x1 && q.z > t.z0 && q.z < t.z1);
    expect(cols.length, `${tag}: columns beside the car`).toBeGreaterThan(0);
    for (const q of cols) expect(Math.abs(q.z - p.z) - q.hz - W / 2, `${tag}: column clearance`).toBeGreaterThanOrEqual(TRAIN_CLEAR.prop - EPS);
  }
  // every cell under the body: track bed at the bed floor with headroom over the roof
  for (let cx = Math.floor(p.x0 / CELL); cx < Math.ceil(p.x1 / CELL); cx++) for (let cy = Math.floor((p.z - W / 2) / CELL); cy < Math.ceil((p.z + W / 2) / CELL); cy++) {
    const i = g.idx(cx, cy);
    expect(g.cells[i], `${tag}: cell ${cx},${cy}`).toBe(VOID);
    if (g.hasCeil(i)) expect(g.ceil[i], `${tag}: ceiling over ${cx},${cy}`).toBeGreaterThanOrEqual(roofY + TRAIN_CLEAR.ceiling);
  }
  // nothing generated starts inside / under the car: bed enemy spawns and loose pickups (on the car's level, below its roof)
  const under = (x: number, z: number) => x > p.x0 - TRAIN_CLEAR.spawn && x < p.x1 + TRAIN_CLEAR.spawn && z > Math.max(t.z0, p.z - W / 2 - TRAIN_CLEAR.spawn) && z < Math.min(t.z1, p.z + W / 2 + TRAIN_CLEAR.spawn);
  expect(L.zombies.filter(z => (z.level ?? 0) === p.level && (z.y ?? 0) < roofY && under(z.x, z.z)).map(z => `${z.x},${z.z} L${z.level} y${z.y} ${z.archetype ?? z.type}`), `${tag}: spawns`).toEqual([]);
  expect(L.pickups.filter(q => (q.level ?? 0) === p.level && q.y < roofY && under(q.x, q.z)).map(q => q.itemId), `${tag}: pickups`).toEqual([]);
  // the platform-side door openings face the platform edge across the gap, onto walkable platform; the far-side doors face away
  const gap = Math.abs(p.platformEdgeZ - p.z) - W / 2;
  expect(gap, `${tag}: platform gap`).toBeGreaterThan(0.35);
  expect(gap, `${tag}: platform gap`).toBeLessThanOrEqual(0.6);
  for (const d of s.doors) {
    const w = trainToWorld(p, d.x, s.floorY, d.side * W / 2);
    if (d.side === -1) {
      expect(Math.abs(w.z - p.platformEdgeZ), `${tag}: door ${d.x} faces the edge`).toBeCloseTo(gap, 9);
      expect(Math.sign(w.z - p.z), `${tag}: door ${d.x} on the platform side`).toBe(p.platformSide);
      for (const dx of [-d.width / 2, 0, d.width / 2]) {
        const [cx, cy] = g.cellOf(w.x + dx, p.platformEdgeZ + p.platformSide * CELL / 2);
        expect(g.area[g.idx(cx, cy)], `${tag}: door ${d.x} opens onto the platform`).toBe(p.platformArea);
        expect(g.walkable(cx, cy), `${tag}: door ${d.x} landing walkable`).toBe(true);
      }
    } else expect(Math.sign(w.z - p.z), `${tag}: far door ${d.x}`).toBe(-p.platformSide);
  }
  // the START arrival: inside the saloon at the interior floor (explicit y), facing the middle platform-side door
  const pose = arrivalPose(L, {kind: 'start'}, p);
  expect(pose, tag).toEqual(trainSpawnPose(L, p, s));
  expect(pose.source, tag).toBe('train');
  expect(pose.y, tag).toBe(p.floorY);
  expect(pose.level, tag).toBe(p.level);
  const loc = worldToTrain(p, pose.x, pose.y!, pose.z);
  expect(loc.y, tag).toBeCloseTo(s.floorY, 9);
  expect(loc.x, `${tag}: in the saloon`).toBeGreaterThanOrEqual(s.interior.x0 + TRAIN_SPAWN.wallClear - EPS);
  expect(loc.x, `${tag}: not in the cab`).toBeLessThanOrEqual(Math.min(s.interior.x1, s.cab.x0) - TRAIN_SPAWN.wallClear + EPS);
  expect(Math.abs(loc.z), `${tag}: off the side walls`).toBeLessThanOrEqual(s.interior.halfWidth - TRAIN_SPAWN.wallClear + EPS);
  const fwd = {x: -Math.sin(pose.yaw), z: -Math.cos(pose.yaw)}; // the player's forward (camera convention)
  expect(fwd.z * p.platformSide, `${tag}: faces the platform`).toBeCloseTo(1, 9);
  const mid = s.doors.filter(d => d.side === -1).sort((a, b) => Math.abs(a.x) - Math.abs(b.x))[0];
  expect(Math.abs(loc.x - mid.x), `${tag}: in front of the middle door`).toBeLessThan(mid.width / 2);
  expect(loc.z + s.interior.halfWidth, `${tag}: back from the door`).toBeGreaterThanOrEqual(1.0 - EPS);
  expect(loc.z + s.interior.halfWidth, `${tag}: back from the door`).toBeLessThanOrEqual(1.3 + EPS);
  // without the train (tests, censuses) the generated start is unchanged
  expect(arrivalPose(L, {kind: 'start'})).toMatchObject({x: st.x, z: st.z, yaw: st.yaw});
  return `${tag}: x ${p.x} (${p.x0}..${p.x1}) z ${p.z} front ${p.front} dx ${(p.x - st.x).toFixed(2)} gaps ${near.filter(l => l.x < p.x0).map(l => (p.x0 - l.x).toFixed(2)).pop()}/${near.filter(l => l.x > p.x1).map(l => (l.x - p.x1).toFixed(2))[0]}`;
}

/** Content hash of a layout (every own field, typed arrays by bytes): proves a call left it untouched. */
function fingerprint(root: unknown): string {
  let h = 0x811c9dc5, n = 0;
  const seen = new Set<object>();
  const mix = (v: number) => { h = Math.imul(h ^ v, 16777619) >>> 0; n++; };
  const str = (s: string) => { for (let i = 0; i < s.length; i++) mix(s.charCodeAt(i)); };
  const walk = (v: unknown): void => {
    if (typeof v === 'function') return;
    if (v === null || typeof v !== 'object') { str(`${typeof v}:${String(v)};`); return; }
    if (seen.has(v)) { str('@'); return; }
    seen.add(v);
    if (ArrayBuffer.isView(v)) {
      const words = v.byteLength % 4 === 0 && v.byteOffset % 4 === 0 ? new Int32Array(v.buffer, v.byteOffset, v.byteLength / 4) : new Uint8Array(v.buffer, v.byteOffset, v.byteLength);
      for (let i = 0; i < words.length; i++) mix(words[i]);
      return;
    }
    if (v instanceof Map || v instanceof Set) { for (const x of v) walk(x); return; }
    for (const k of Object.keys(v).sort()) { str(k); walk((v as Record<string, unknown>)[k]); }
  };
  walk(root);
  return `${h.toString(16)}:${n}`;
}

describe('player train placement (lane PLACE)', () => {
  it('the bed constants are the built rails: rail top = bed + 0.295, rails +-0.72 from the track centre', () => {
    expect(RAIL_TOP_ABOVE_BED).toBeCloseTo(SHELL.railY + SHELL.railH / 2, 12);
    expect(RAIL_GAUGE_HALF).toBe(SHELL.gauge);
    expect(-TRENCH_DEPTH + RAIL_TOP_ABOVE_BED).toBeCloseTo(-0.855, 9);
  });

  it('the placement, spawn pose and arrival never mutate the layout (Subway / Office / Mall stay byte-identical)', () => {
    for (const tag of ['subway side-mezzanine 11', 'subway hatch 1549120013', 'office 31702', 'mall arcade-loop']) {
      const L = layoutOf(entry(tag)); // first use of these layouts (this test runs first): nothing placed on them yet
      const before = fingerprint(L);
      const p = playerTrainPlacement(L)!;
      playerTrainPlacement(L, {...spec, length: 15});
      arrivalPose(L, {kind: 'start'}, p);
      trainSpawnPose(L, p);
      expect(fingerprint(L), tag).toBe(before);
    }
  });

  it('every corpus level parks the car at its start platform: track, rails, span, ladders, hatches, columns, doors, spawn inside', () => {
    const lines: string[] = [];
    for (const e of CORPUS) {
      const L = layoutOf(e);
      lines.push(check(e.tag, e.kind, L, playerTrainPlacement(L)));
    }
    process.stdout.write(`[player-train] ${lines.join('\n[player-train] ')}\n`);
  });

  it('a measured spec anywhere in the LANES fit limits (length <= 16.5, width 2.9-3.1) still fits every Office / Mall level and the Subway corpus', () => {
    for (const s of [{...spec, length: 16.5, width: 3.1}, {...spec, length: 16.5, width: 2.9}, {...spec, length: 14, width: 3.0}]) {
      for (const e of CORPUS) check(`${e.tag} (L ${s.length} W ${s.width})`, e.kind, layoutOf(e), playerTrainPlacement(layoutOf(e), s), s);
    }
  });

  it('deterministic: the same frozen object per layout, equal on a regenerated layout', () => {
    for (const tag of ['subway side-mezzanine 11', 'office 4242', 'mall terrace-cross']) {
      const e = entry(tag), L = layoutOf(e), p = playerTrainPlacement(L);
      expect(playerTrainPlacement(L), tag).toBe(p);
      expect(Object.isFrozen(p), tag).toBe(true);
      expect(playerTrainPlacement(e.make()), tag).toEqual(p);
      expect(playerTrainPlacement(L, {...spec}), `${tag}: uncached`).toEqual(p);
    }
  });

  it("uses FINAL coordinates: on a Subway level whose core finishExtensions translated, it is the core placement moved by the shift", () => {
    let shifted = 0;
    for (const tag of ['subway side-mezzanine 11', 'subway interchange 9001', 'subway split 9001', 'subway deep 9001']) {
      const L = layoutOf(entry(tag)), sh = L.extensions!.shift;
      if (sh.x === 0 && sh.z === 0) continue;
      shifted++;
      const p = playerTrainPlacement(L)!, c = playerTrainPlacement(coreView(L))!;
      expect(c, tag).not.toBeNull();
      expect([c.x + sh.x, c.z + sh.z, c.x0 + sh.x, c.platformEdgeZ + sh.z, c.front, c.trenchIndex, c.platformArea], tag)
        .toEqual([p.x, p.z, p.x0, p.platformEdgeZ, p.front, p.trenchIndex, p.platformArea].map(v => expect.closeTo(v, 6)));
    }
    expect(shifted).toBeGreaterThanOrEqual(3);
  });

  it('the arrival seam: only START arrivals use the train; any other kind (the unused return, a future resume / saved pose) and a level without room keep the generated start', () => {
    const L = layoutOf(entry('subway island-ends 11')), p = playerTrainPlacement(L)!, sp = L.playerSpawn;
    expect(arrivalPose(L, {kind: 'start'}, p).source).toBe('train');
    expect(arrivalPose(L, {kind: 'return'}, p)).toMatchObject({x: sp.x, z: sp.z, yaw: sp.yaw, source: 'playerSpawn'});
    expect(arrivalPose(L, {kind: 'resume'} as never, p)).toMatchObject({x: sp.x, z: sp.z, source: 'playerSpawn'});
    expect(arrivalPose(L, {kind: 'start'}, null)).toMatchObject({x: sp.x, z: sp.z, source: 'playerSpawn'});
    // a level that genuinely cannot fit the car: null, and the start arrival falls back to the generated start
    expect(playerTrainPlacement(L, {...spec, length: 400})).toBeNull();
    expect(playerTrainPlacement({...L, platforms: []})).toBeNull();
    const O = layoutOf(entry('office 4242'));
    expect(arrivalPose(O, {kind: 'start'}, playerTrainPlacement(O, {...spec, length: 400}))).toMatchObject({...O.office!.start, source: 'start'});
  });

  it('the ladder clearance relaxes to the player-radius minimum only when no platform edge fits with the full clearance', () => {
    // Office 4242: both island faces have 18.75 m ladder gaps; a 17.5 m car needs 19.0 m with 0.75 m clearances, 18.4 m with 0.45 m
    const O = layoutOf(entry('office 4242')), s = {...spec, length: 17.5}, p = playerTrainPlacement(O, s);
    check('office 4242 (L 17.5, minimum ladder clearance)', 'office', O, p, s, TRAIN_CLEAR.ladderMin);
    const near = O.traversal.ladders.filter(l => l.trench === p!.trenchIndex && Math.abs(l.bottom.z - p!.z) < s.width / 2 + TRAIN_CLEAR.ladder);
    expect(near.some(l => l.x > p!.x0 - TRAIN_CLEAR.ladder && l.x < p!.x1 + TRAIN_CLEAR.ladder)).toBe(true);
    expect(playerTrainPlacement(O)).not.toBeNull(); // the real car keeps the full clearance (the corpus test)
  });

  it('the spawn point is in the saloon in front of the middle platform-side door for any door layout', () => {
    // the measured car: its middle platform-side door (the side -1 door nearest x = 0; x 0.182 on the cooked shell)
    const mid = spec.doors.filter(d => d.side === -1).sort((a, b) => Math.abs(a.x) - Math.abs(b.x))[0];
    expect(Math.abs(mid.x)).toBeLessThan(1);
    expect(trainSpawnLocal(spec)).toEqual({x: mid.x, z: expect.closeTo(-spec.interior.halfWidth + TRAIN_SPAWN.doorBack, 9)});
    // no middle door: the platform-side door nearest x = 0 inside the saloon (never one in the cab)
    const s2 = {...spec, doors: [{side: -1 as const, x: -4, width: 1.3, height: 1.95}, {side: -1 as const, x: 7, width: 1.3, height: 1.95}, {side: 1 as const, x: 0.5, width: 1.3, height: 1.95}]};
    expect(trainSpawnLocal(s2).x).toBe(-4);
  });
});

describe('player train identity (run/playerTrain.ts)', () => {
  it('one level-one train per run: travel keeps it, Retry restores it, NewGame starts a fresh one; it carries no player state', () => {
    const rec = new PlayerTrainRecord(), part = rec.participant();
    expect(part.id).toBe(PLAYER_TRAIN_PARTICIPANT);
    expect(rec.state).toEqual({id: PLAYER_TRAIN_L1.id, tier: 1, at: null});
    expect(Object.keys(rec.state).sort()).toEqual(['at', 'id', 'tier']); // no hp / inventory / survival / ammo: spawning in it refills nothing
    rec.parkAt({level: 'subway', section: 'main'});
    const entrySave = structuredClone(part.save()); // Retry snapshot at level entry (JSON-safe)
    rec.parkAt({level: 'office', section: 'main'}); // Travel: the same train in the next level
    expect(rec.state).toEqual({id: 'player-train-l1', tier: 1, at: {level: 'office', section: 'main'}});
    const snap = {lanes: {[PLAYER_TRAIN_PARTICIPANT]: entrySave}} as unknown as RunSnapshot;
    restoreParticipants(snap, [part]);
    expect(rec.state).toEqual({id: 'player-train-l1', tier: 1, at: {level: 'subway', section: 'main'}});
    const copy = rec.state;
    copy.tier = 9;
    expect(rec.state.tier).toBe(1); // the getter hands out a copy
    resetParticipants([part]);
    expect(rec.state).toEqual({id: 'player-train-l1', tier: 1, at: null});
    part.load({id: '', tier: 0, at: 'nowhere'}); // malformed data never yields a broken identity
    expect(rec.state).toEqual({id: 'player-train-l1', tier: 1, at: null});
    restoreParticipants({lanes: {}} as unknown as RunSnapshot, [part]); // a snapshot without the record: fresh level-one train
    expect(rec.id).toBe('player-train-l1');
  });
});
