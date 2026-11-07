// Task studio-skyways-destinations-20261106-170011-01 (lane LANDMARKS (A)): the Skyways LANDMARK courts and the destinations' renderer.
//  - kinds (gen/skyways/destinations/kindsLandmarks.ts): the six heroes + the shared poster / plaque kinds registered in PROP_DEFS /
//    PROP_DAMAGE (never break) / PROP_PHYSICS_AUDIT (static, honest reason) / OPENABLE_AUDIT, their footprints derived from the measured
//    kit table (lane KITS), the scale record; the lazy level-only model catalogue (keys = file names, bytes = the files, only the kinds
//    a layout placed); the hung rows' suspension points; the art adapter (every poster / plaque variant -> an ART2D atlas piece);
//  - the courts on REAL seeds (all six families): the centrepiece at its spot (or nudged <= 3 m), on its floor / hung >= 2.3 m clear,
//    its whole drawn model over carved floor and under the ceiling (+ headroom), the dinosaur along the court's longer axis, round
//    colliders + the collision-only upper parts stacked on it; the plaque (its family's art) near the hero facing outward; benches
//    facing the hero; nothing overlapping; the walking ring kept; a 1.2 m lane from the court's main opening to the hero's ring; warm
//    steady accent lights under the ceiling; the atrium greenery kept off the clear disc; skywaysIssues clean; deterministic;
//  - world/skywaysDestinations.ts in Node: every destination kind drawn as `prop-<kind>[-...]` (stand-ins without models; the real kit
//    GLBs at the table's size, k ~ 1, a shrunk placement drawn at its scale), nothing for collision-only parts, the geese's cables up to
//    the ceiling, art quads on their atlas pieces (atlas material when the runtime handed it in, else the plain board); the runtime's
//    preload (level-only atlases via LevelResources, a failed one keeps the board).
import {beforeAll, describe, expect, it} from 'vitest';
import fs from 'node:fs';
import {fileURLToPath} from 'node:url';
import * as THREE from 'three';
import type {GLTF} from 'three/addons/loaders/GLTFLoader.js';
import {LEVELS} from '../src/levels/registry';
import {skywaysIssues} from '../src/gen/skyways/index';
import {CELL, FLOOR, Grid, SOLID} from '../src/gen/grid';
import {PROP_DEFS, type PropKind, type PropPlacement} from '../src/gen/props';
import {PROP_DAMAGE, propPhysics} from '../src/damage/materials';
import {PROP_PHYSICS_AUDIT} from '../src/damage/physicsAudit';
import {OPENABLE_AUDIT} from '../src/world/openablesSpec';
import {SKYWAYS_DEST_PROPS, type SkywaysDestPropKey} from '../src/assets/skywaysDestProps.generated';
import {SKYWAYS_DEST_ART, SKYWAYS_DEST_PLAQUE_BY_LANDMARK} from '../src/assets/skywaysDestArt.generated';
import {SCIENCE_ART} from '../src/gen/skyways/stores/scienceArt.generated'; // task studio-alpha-skyways-shops-20261107-054512-01 (lane STORE-SCIENCE)
import {DEST_PLAQUE_OF, DEST_PLAQUE_PIECES, DEST_POSTER, DEST_POSTER_PIECES} from '../src/gen/skyways/destinations/art';
import {DEST_POSTER_BASE_Y, LANDMARK_KIND, LANDMARK_ROUND, LANDMARK_SCALE, LANDMARKS_KINDS, destCollisionOnly, landmarkUppers} from '../src/gen/skyways/destinations/kindsLandmarks';
import {SKYWAYS_DEST_KINDS, SKYWAYS_DEST_SPECS, type SkywaysDestKind} from '../src/gen/skyways/destinations/registry';
import {LANDMARK_DRESS, landmarkDressOf, type LandmarkDress} from '../src/gen/skyways/destinations/landmarks';
import {SKYWAYS_DEST_MODEL_BYTES, SKYWAYS_DEST_MODEL_FILES, destHangCables, destModelKey, skywaysDestModelKeysFor} from '../src/gen/skyways/destinations/skywaysDestModels';
import {destArtOf, destArtPiece} from '../src/gen/skyways/destinations/skywaysDestArtMap';
import {SKYWAYS_LANDMARK_FAMILIES, type SkywaysLandmark} from '../src/gen/skyways/skywaysTypes';
import {levelOfAsset} from '../src/assets/levelAssets';
import {WorldMaterials} from '../src/world/materials';
import {buildWorld} from '../src/world/builder';
import {DEST_CABLE, destPlacementScale, setSkywaysDestArtMaterial, skywaysDestArtLoaded, skywaysDestFit} from '../src/world/skywaysDestinations';
import {SkywaysDestRuntime} from '../src/world/skywaysDestRuntime';
import {fakeEnvTextures, loadStripped} from './helpers/openablesFixture';
import {installCanvasShim, ShimContext} from './helpers/canvas2d';
import type {Area, StationLayout} from '../src/gen/stationTypes';

installCanvasShim(false);
(ShimContext.prototype as unknown as {clip?: () => void}).clip ??= () => {};

const PUB = (rel: string) => fileURLToPath(new URL('../public/' + rel, import.meta.url));
/** Seeds whose landmark courts cover all six families (1: fountain, fig tree, orrery; 2: + geese, dinosaur; 4: + clock). */
const SEEDS = [1, 2, 4];
const HEROES = Object.values(LANDMARK_KIND);
const rowOf = (kind: SkywaysDestKind) => SKYWAYS_DEST_PROPS[SKYWAYS_DEST_SPECS[kind].model!];

const layouts = new Map<number, StationLayout>();
const gen = (seed: number): StationLayout => {
  let L = layouts.get(seed);
  if (!L) layouts.set(seed, (L = LEVELS.skyways.generate('main', {levelSeed: seed} as never)));
  return L;
};
const gridOf = (L: StationLayout, level: number): Grid => L.levels[level].grid;
/** Sample points over a box (rotated by a quarter turn: hx / hz already world) or a disc. */
function samples(x: number, z: number, hx: number, hz: number, disc: boolean): [number, number][] {
  const out: [number, number][] = [[x, z]];
  if (disc) { const r = Math.max(hx, hz); for (let k = 1; k <= 8; k++) for (let j = 0; j < 24; j++) { const t = (j / 24) * 2 * Math.PI, d = (r * k) / 8; out.push([x + Math.sin(t) * d, z + Math.cos(t) * d]); } return out; }
  for (let i = 0; i <= 12; i++) for (let j = 0; j <= 12; j++) out.push([x - hx + (2 * hx * i) / 12, z - hz + (2 * hz * j) / 12]);
  return out;
}
const boxGap = (a: PropPlacement, b: PropPlacement) => Math.max(Math.abs(a.x - b.x) - a.hx - b.hx, Math.abs(a.z - b.z) - a.hz - b.hz);
const yOverlap = (a: PropPlacement, b: PropPlacement) => a.y < b.y + b.h - 0.01 && b.y < a.y + a.h - 0.01;
/** BFS on cells whose centre has a free disc of radius r (Grid.circleClear: FLOOR, no blocking prop) from a point to any cell `goal` accepts. */
function reach(g: Grid, from: [number, number], goal: (x: number, z: number) => boolean, r: number): boolean {
  const ok = (cx: number, cy: number) => g.inBounds(cx, cy) && g.circleClear((cx + 0.5) * CELL, (cy + 0.5) * CELL, r);
  const [sx, sy] = g.cellOf(from[0], from[1]);
  if (!ok(sx, sy)) return false;
  const seen = new Uint8Array(g.w * g.h), q: number[] = [sx, sy];
  seen[g.idx(sx, sy)] = 1;
  for (let i = 0; i < q.length; i += 2) {
    const x = q[i], y = q[i + 1];
    if (goal((x + 0.5) * CELL, (y + 0.5) * CELL)) return true;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy;
      if (!g.inBounds(nx, ny) || seen[g.idx(nx, ny)] || !ok(nx, ny)) continue;
      seen[g.idx(nx, ny)] = 1;
      q.push(nx, ny);
    }
  }
  return false;
}

// ---------------------------------------------------------------------------------------------

describe('landmark kinds: registered, classified in both audits, derived from the measured kit, models / art on file', () => {
  it('every lane-A kind has a footprint, a never-breaking damage class, one openables row and a static physics row that agrees with the live physics', () => {
    expect([...LANDMARKS_KINDS].sort()).toEqual(['skyDClock', 'skyDDinosaur', 'skyDFigTree', 'skyDFountain', 'skyDGeese', 'skyDOrrery', 'skyDPlaque', 'skyDPoster']);
    for (const k of LANDMARKS_KINDS) {
      expect(SKYWAYS_DEST_KINDS, k).toContain(k);
      expect(/^[A-Za-z]+$/.test(k), `${k}: prop-<kind> mesh names (damage/propDamage.ts NAME_RE)`).toBe(true);
      const def = PROP_DEFS[k];
      expect(def.w * def.d * def.h, k).toBeGreaterThan(0);
      expect(PROP_DAMAGE[k], k).toMatchObject({breaks: 'never'});
      const open = OPENABLE_AUDIT.filter(r => r.kind === k);
      expect(open.length, k).toBe(1);
      expect(['none', 'exception'], k).toContain(open[0].cls);
      expect(PROP_PHYSICS_AUDIT[k], k).toMatchObject({src: 'skyways', cls: 'static'});
      expect(PROP_PHYSICS_AUDIT[k].why, k).toBeTruthy();
      expect(propPhysics(k).dynamic, k).toBe(false);
    }
    expect(PROP_PHYSICS_AUDIT.skyDGeese.why).toBe('mounted');
    expect(OPENABLE_AUDIT.find(r => r.kind === 'skyDClock')!.cls).toBe('exception'); // the pendulum hatch: equipment, not storage
    for (const k of HEROES) expect(LANDMARK_SCALE[k], `${k}: scale record (rule 5)`).toBeTruthy();
  });

  it('hero footprints derive from the kit table: the model box, or the round collider of the tree ring bench / fountain basin / orrery sphere', () => {
    for (const k of ['skyDClock', 'skyDDinosaur', 'skyDGeese'] as const) {
      const r = rowOf(k), d = PROP_DEFS[k];
      expect([d.w, d.h, d.d], k).toEqual([r.w, r.h, r.d]);
    }
    for (const k of LANDMARK_ROUND) expect(PROP_DEFS[k as PropKind].w, k).toBe(PROP_DEFS[k as PropKind].d);
    expect(PROP_DEFS.skyDOrrery.w).toBe(Math.min(rowOf('skyDOrrery').w, rowOf('skyDOrrery').d));
    expect(PROP_DEFS.skyDFountain.w).toBe(Math.min(rowOf('skyDFountain').w, rowOf('skyDFountain').d));
    // the measured basin wall (0.83 m on the 3.85 m fountain) and the tree's ring bench seat (~0.93 m at 7 m)
    expect(PROP_DEFS.skyDFountain.h).toBeGreaterThan(0.75);
    expect(PROP_DEFS.skyDFountain.h).toBeLessThan(0.9);
    expect(PROP_DEFS.skyDFigTree.w).toBeLessThan(rowOf('skyDFigTree').w);
    // the upper parts stack: tree seat -> planter rim -> trunk; fountain rim -> top
    const tree = landmarkUppers('skyDFigTree'), fountain = landmarkUppers('skyDFountain');
    expect(tree.map(u => u.variant)).toEqual([1, 2]);
    expect(tree[0].y0).toBeCloseTo(PROP_DEFS.skyDFigTree.h, 2);
    expect(tree[1].y0).toBeCloseTo(tree[0].y1, 6);
    expect(fountain[0].y0).toBeCloseTo(PROP_DEFS.skyDFountain.h, 2);
    expect(fountain[0].y1).toBe(rowOf('skyDFountain').h);
    expect(landmarkUppers('skyDClock')).toEqual([]);
    expect(destCollisionOnly({kind: 'skyDFountain', variant: 1})).toBe(true);
    expect(destCollisionOnly({kind: 'skyDFountain', variant: 0})).toBe(false);
    expect(destCollisionOnly({kind: 'skyDPoster', variant: 1})).toBe(false); // a poster's variant is its art
    // poster base: its centre at DEST_POSTER.y
    expect(DEST_POSTER_BASE_Y + PROP_DEFS.skyDPoster.h / 2).toBeCloseTo(DEST_POSTER.y, 6);
  });

  it('lazy level-only models: keys = file names, bytes = the files, only the destination kinds a layout placed', () => {
    for (const m of Object.keys(SKYWAYS_DEST_PROPS) as SkywaysDestPropKey[]) {
      const row = SKYWAYS_DEST_PROPS[m] as {url: string; planned?: boolean};
      if (row.planned) { expect(SKYWAYS_DEST_MODEL_FILES[destModelKey(m)], m).toBeUndefined(); continue; }
      const f = SKYWAYS_DEST_MODEL_FILES[destModelKey(m)];
      expect(f.url, m).toBe(`assets/models/${destModelKey(m)}.glb`);
      expect(destModelKey(m), m).toMatch(/^skyways-d-/);
      expect(levelOfAsset(f.url), m).toBe('skyways');
      expect(fs.statSync(PUB(f.url)).size, m).toBe(SKYWAYS_DEST_MODEL_BYTES[m]);
      expect(f.bytes, m).toBe(SKYWAYS_DEST_MODEL_BYTES[m]);
    }
    expect(skywaysDestModelKeysFor({props: [{kind: 'bench'}, {kind: 'skyDFountain'}, {kind: 'skyDClock'}, {kind: 'skyDPoster'}, {kind: 'skyDFountain'}]}))
      .toEqual(['skyways-d-lm-clock', 'skyways-d-lm-fountain']);
    expect(skywaysDestModelKeysFor({props: [{kind: 'bench'}]})).toEqual([]);
    // hung rows hang from their measured points: the geese's two rods at the beam ends (rod tops = hangY)
    const geese = destHangCables('skyways_d_lm_geese'), row = SKYWAYS_DEST_PROPS.skyways_d_lm_geese as {w: number; h: number; hangY?: number};
    expect(geese.xs.map(x => Math.round((x / row.w) * 100) / 100)).toEqual([-0.46, 0.46]);
    expect(geese.y).toBeCloseTo(row.hangY ?? row.h, 3);
  });

  it('art adapter: every poster / plaque variant shows its ART2D atlas piece; the family plaques are the right pieces', () => {
    for (let v = 0; v < DEST_POSTER_PIECES.length; v++) {
      const {atlas, piece} = destArtOf('skyDPoster', v);
      expect(atlas).toBe('posters');
      expect(piece).toBe(DEST_POSTER_PIECES[v]);
      const r = destArtPiece(atlas, piece)!;
      expect(r, piece).toBeTruthy();
      expect(r.aspect).toBeCloseTo(2 / 3, 1);
    }
    for (let v = 0; v < DEST_PLAQUE_PIECES.length; v++) {
      const {atlas, piece} = destArtOf('skyDPlaque', v);
      expect(atlas).toBe('plaques');
      expect(destArtPiece(atlas, piece), piece).toBeTruthy();
    }
    for (const fam of SKYWAYS_LANDMARK_FAMILIES) expect(destArtOf('skyDPlaque', DEST_PLAQUE_OF[fam]).piece, fam).toBe(SKYWAYS_DEST_PLAQUE_BY_LANDMARK[fam]);
    expect(destArtPiece('posters', 'no-such-piece')).toBeNull();
  });
});

// ---------------------------------------------------------------------------------------------

/** Every check of one dressed court (the real layout). */
function checkCourt(L: StationLayout, lm: SkywaysLandmark, d: LandmarkDress): void {
  const tag = `${L.seed}:${lm.family}`;
  const area = L.areas[lm.area], g = gridOf(L, lm.level), kind = LANDMARK_KIND[lm.family];
  expect(d.miss, tag).toEqual([]);
  const c = d.centre!;
  expect(c, tag).toBeTruthy();
  expect(L.props.includes(c), tag).toBe(true);
  expect([c.kind, c.level ?? 0, c.area], tag).toEqual([kind, lm.level, lm.area]);
  // at its spot (a stair approach / door zone may nudge it <= 3 m)
  expect(Math.hypot(c.x - lm.x, c.z - lm.z), tag).toBeLessThanOrEqual(3.01);
  const s = destPlacementScale(c), row = rowOf(kind);
  expect(s, tag).toBeCloseTo(d.scale, 2);
  expect(s, tag).toBeGreaterThanOrEqual(LANDMARK_DRESS.minScale);
  const floor = g.floorAt(lm.x, lm.z);
  // the drawn model's footprint: carved floor everywhere under it, the ceiling above its top (+ headroom; the geese: + 1 m of cable)
  const turned = Math.abs(Math.sin(c.rot)) > 0.5 && !c.round;
  const vhx = ((turned ? row.d : row.w) / 2) * s, vhz = ((turned ? row.w : row.d) / 2) * s;
  const pts = samples(c.x, c.z, vhx, vhz, !!c.round);
  for (const [x, z] of pts) { const [cx, cy] = g.cellOf(x, z); expect(g.cells[g.idx(cx, cy)], `${tag} drawn over carved floor`).toBe(FLOOR); }
  const ceil = Math.min(...pts.map(([x, z]) => g.ceilAt(x, z)));
  const top = c.y + row.h * s;
  if (kind === 'skyDGeese') {
    expect(c.mounted, tag).toBe(true);
    expect(c.y - floor, `${tag} underside clear`).toBeGreaterThanOrEqual(LANDMARK_DRESS.underside - 1e-6);
    expect(top, `${tag} cable room`).toBeLessThanOrEqual(ceil - LANDMARK_DRESS.cable + 1e-6);
    expect(top, tag).toBeLessThanOrEqual(floor + lm.height + 1e-6);
    // no fixture inside the flock
    expect(L.lights.some(l => (l.level ?? 0) === lm.level && Math.abs(l.x - c.x) < c.hx && Math.abs(l.z - c.z) < c.hz && l.y > c.y && l.y < c.y + c.h), tag).toBe(false);
  } else {
    expect(c.y, `${tag} on the floor`).toBeCloseTo(g.floorAt(c.x, c.z), 3);
    expect(top, `${tag} under the ceiling`).toBeLessThanOrEqual(ceil - LANDMARK_DRESS.headroom + 1e-6);
    expect(c.mounted, tag).toBeFalsy();
  }
  if (LANDMARK_ROUND.has(kind)) { expect(c.round, tag).toBe(true); expect(c.hx, tag).toBe(c.hz); expect(c.hx, tag).toBeCloseTo((PROP_DEFS[kind].w / 2) * s, 2); }
  // the dinosaur lies along the court's longer axis
  if (kind === 'skyDDinosaur') expect(c.hx > c.hz, tag).toBe(area.w >= area.h);
  // the collision-only parts stack on the hero, each on the part below
  expect(d.upper.length, tag).toBe(landmarkUppers(kind).length);
  let below = c;
  for (const u of d.upper) {
    expect([u.kind, u.x, u.z, u.round, u.level ?? 0], tag).toEqual([kind, c.x, c.z, true, lm.level]);
    expect(destCollisionOnly(u), tag).toBe(true);
    expect(u.y, tag).toBeCloseTo(below.y + below.h, 2);
    expect(L.props[u.host!], tag).toBe(below);
    below = u;
  }
  // the plaque: its family's art, on the court floor near the hero, facing away from it (the visitor)
  const pl = d.plaque!;
  expect(pl, tag).toBeTruthy();
  expect([pl.kind, pl.variant, pl.area], tag).toEqual(['skyDPlaque', DEST_PLAQUE_OF[lm.family], lm.area]);
  expect(pl.y, tag).toBeCloseTo(g.floorAt(pl.x, pl.z), 3);
  expect(Math.hypot(pl.x - c.x, pl.z - c.z), tag).toBeLessThan(10);
  expect(Math.sin(pl.rot) * (pl.x - c.x) + Math.cos(pl.rot) * (pl.z - c.z), `${tag} plaque faces out`).toBeGreaterThan(0);
  // seating faces the hero; everything on the court floor
  for (const b of d.benches) {
    expect([b.kind, b.area], tag).toEqual(['bench', lm.area]);
    expect(Math.sin(b.rot) * (c.x - b.x) + Math.cos(b.rot) * (c.z - b.z), `${tag} bench faces the hero`).toBeGreaterThan(0);
  }
  for (const p of [pl, ...d.benches, ...d.planters]) { expect(p.y, tag).toBeCloseTo(g.floorAt(p.x, p.z), 3); expect(p.level ?? 0, tag).toBe(lm.level); }
  // nothing overlaps: the floor props of this court against every other prop of the storey (boxes, vertical overlap; the placement
  // kit's cell test allows its 4 cm edge tolerance)
  const mine = new Set<PropPlacement>([c, ...d.upper, pl, ...d.benches, ...d.planters]);
  const others = L.props.filter(q => (q.level ?? 0) === lm.level && !q.mounted && !mine.has(q));
  for (const p of [c, pl, ...d.benches, ...d.planters].filter(q => !q.mounted)) {
    for (const q of others) if (yOverlap(p, q)) expect(boxGap(p, q), `${tag} ${p.kind} overlaps ${q.kind}`).toBeGreaterThanOrEqual(-0.045);
    for (const q of [pl, ...d.benches, ...d.planters]) if (q !== p) expect(boxGap(p, q), `${tag} ${p.kind} overlaps ${q.kind}`).toBeGreaterThanOrEqual(-0.045);
  }
  // the walking ring round a standing hero stays open (no other floor prop within it)
  if (kind !== 'skyDGeese') {
    expect(d.ring, tag).toBeGreaterThanOrEqual(LANDMARK_DRESS.rings[LANDMARK_DRESS.rings.length - 1]);
    for (const q of L.props) if ((q.level ?? 0) === lm.level && !q.mounted && !mine.has(q) && q.y < c.y + 2) expect(boxGap(c, q), `${tag} ring vs ${q.kind}`).toBeGreaterThanOrEqual(d.ring - 0.05);
  }
  // the atrium greenery / food-court seating kept off the clear disc
  for (const q of L.props) if ((q.level ?? 0) === lm.level && !mine.has(q) && ['planterTree', 'bench', 'foodCourtTableSet'].includes(q.kind)) expect(Math.hypot(q.x - lm.x, q.z - lm.z), `${tag} ${q.kind} in the clear disc`).toBeGreaterThan(lm.radius);
  // a 1.2 m walking lane from the court's main opening (its widest) to the hero's ring
  const main = d.openings.reduce((b, o) => (o.n > b.n ? o : b), d.openings[0]);
  expect(main, tag).toBeTruthy();
  const half = (ux: number, uz: number) => (c.round || kind === 'skyDGeese' ? (kind === 'skyDGeese' ? lm.radius : c.hx) : Math.abs(ux) * c.hx + Math.abs(uz) * c.hz);
  const goal = (x: number, z: number) => { const dd = Math.hypot(x - c.x, z - c.z) || 1; return dd <= half((x - c.x) / dd, (z - c.z) / dd) + d.ring + 1.6; };
  const inward = {N: [0, 1], S: [0, -1], W: [1, 0], E: [-1, 0]}[main.side];
  expect(reach(g, [main.x + inward[0] * 0.75, main.z + inward[1] * 0.75], goal, 0.6), `${tag} lane from the main opening`).toBe(true);
  // warm accent lights in the court under its ceiling (lit / broken / flickering: the lighting pass rolls them like every fixture)
  expect(d.lights.length, tag).toBeGreaterThan(0);
  for (const l of d.lights) {
    expect(L.lights.includes(l), tag).toBe(true);
    expect([l.warm, l.area, l.level ?? 0], tag).toEqual([true, lm.area, lm.level]);
    expect(l.y, tag).toBeLessThan(g.ceilAt(l.x, l.z));
    expect(l.y - floor, tag).toBeLessThanOrEqual(LANDMARK_DRESS.lightReach);
  }
}

describe('the landmark courts on real seeds', () => {
  it(`seeds ${SEEDS.join(', ')} cover all six landmark families`, () => {
    const fams = new Set(SEEDS.flatMap(s => (gen(s).skyways!.landmarks ?? []).map(m => m.family)));
    expect([...fams].sort()).toEqual([...SKYWAYS_LANDMARK_FAMILIES].sort());
  });

  for (const seed of SEEDS) {
    it(`seed ${seed}: every court's centrepiece, plaque, seating, lanes and lights; validation clean`, () => {
      const L = gen(seed);
      const lms = L.skyways!.landmarks ?? [];
      expect(lms.length).toBeGreaterThan(0);
      const dressed = landmarkDressOf(L);
      for (const lm of lms) {
        const d = dressed.find(q => q.id === lm.id);
        expect(d, `${seed}:${lm.id}`).toBeTruthy();
        checkCourt(L, lm, d!);
      }
      // the heroes in the layout are exactly the dressed ones (no strays)
      const heroes = L.props.filter(p => (HEROES as string[]).includes(p.kind) && p.variant === 0);
      expect(heroes.length).toBe(lms.length);
      expect(skywaysIssues(L)).toEqual([]);
    });
  }

  it('deterministic per seed (two generations of seed 2 dress the courts identically)', () => {
    const a = gen(2), b = LEVELS.skyways.generate('main', {levelSeed: 2} as never);
    const mine = (L: StationLayout) => JSON.stringify(L.props.filter(p => (LANDMARKS_KINDS as readonly string[]).includes(p.kind)));
    expect(mine(b)).toBe(mine(a));
    expect(JSON.stringify(landmarkDressOf(b).map(d => [d.id, d.scale, d.ring, d.benches.length, d.planters.length, d.lights]))).toBe(JSON.stringify(landmarkDressOf(a).map(d => [d.id, d.scale, d.ring, d.benches.length, d.planters.length, d.lights])));
  });
});

// ---------------------------------------------------------------------------------------------

const CEIL = 12;
function room(props: PropPlacement[]): StationLayout {
  const W = 130, H = 100, g = new Grid(W, H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const i = g.idx(x, y); g.cells[i] = x < 1 || y < 1 || x >= W - 1 || y >= H - 1 ? SOLID : FLOOR; g.area[i] = 0; g.ceil[i] = CEIL; g.floor[i] = 0; }
  return {
    seed: 3, name: 'destinations test', props, grid: g, areas: [{id: 0, x: 1, y: 1, w: W - 2, h: H - 2, kind: 'concourse', type: 'concourse', label: 'Court', ceil: CEIL, parent: -1, depth: 0, publicSpace: true, lighting: 'lit'} as unknown as Area],
    doors: [], playerSpawn: {x: 2, z: 2, yaw: 0}, lights: [], signs: [], pickups: [], zombies: [], decor: [], storefronts: [], trench: {floorY: -1.15}, trenches: [],
    attempt: 0, towards: ['A', 'B'], platform: 0, platforms: [], traversal: {stairs: [], ladders: [], underpasses: []}, rails: [], levelLinks: [],
  } as unknown as StationLayout;
}
const place = (kind: PropKind, x: number, z: number, o: Partial<PropPlacement> = {}): PropPlacement => {
  const d = PROP_DEFS[kind];
  return {kind, x, z, y: 0, rot: 0, area: 0, hx: d.w / 2, hz: d.d / 2, h: d.h, blocksSight: false, variant: 0, ...o};
};

describe('world/skywaysDestinations.ts + skywaysDestRuntime.ts: every destination kind drawn, real kit at its size, art on its pieces', () => {
  const mats = new WorldMaterials(fakeEnvTextures(), 7, {w: 1.2, h: 0.19, d: 0.17});
  let lib: Record<string, GLTF> = {};
  beforeAll(async () => {
    lib = {};
    for (const k of HEROES) { const m = SKYWAYS_DEST_SPECS[k].model!; if (!(SKYWAYS_DEST_PROPS[m] as {planned?: boolean}).planned) lib[destModelKey(m)] = await loadStripped(SKYWAYS_DEST_PROPS[m].url); }
  });

  function sample(): {layout: StationLayout; byKind: Map<string, PropPlacement[]>} {
    const props: PropPlacement[] = [];
    let x = 6;
    // every destination kind of every lane once (a code-drawn / model / art kind alike)
    for (const k of SKYWAYS_DEST_KINDS) { const d = PROP_DEFS[k]; props.push(place(k, x + d.w / 2, 40, k === 'skyDGeese' ? {y: 6, mounted: true} : {})); x += d.w + 1.5; if (x > 50) x = 6; }
    // a fountain shrunk to 0.8 (a low court) + its collision-only column; a tree with its two parts
    const f = place('skyDFountain', 20, 12, {h: PROP_DEFS.skyDFountain.h * 0.8, hx: PROP_DEFS.skyDFountain.w * 0.4, hz: PROP_DEFS.skyDFountain.w * 0.4, round: true});
    props.push(f);
    for (const u of landmarkUppers('skyDFountain')) props.push(place('skyDFountain', 20, 12, {variant: u.variant, y: u.y0 * 0.8, h: (u.y1 - u.y0) * 0.8, hx: u.r * 0.8, hz: u.r * 0.8, round: true, host: props.length - 1}));
    for (let v = 0; v < DEST_POSTER_PIECES.length; v++) props.push(place('skyDPoster', 4 + v, 0.53, {y: DEST_POSTER_BASE_Y, mounted: true, variant: v}));
    for (let v = 0; v < DEST_PLAQUE_PIECES.length; v++) props.push(place('skyDPlaque', 4 + v * 1.5, 25, {variant: v}));
    props.push(place('skyDGeese', 50, 20, {y: 7, rot: Math.PI / 2, mounted: true, hx: PROP_DEFS.skyDGeese.d / 2, hz: PROP_DEFS.skyDGeese.w / 2}));
    const byKind = new Map<string, PropPlacement[]>();
    for (const p of props) { const l = byKind.get(p.kind); if (l) l.push(p); else byKind.set(p.kind, [p]); }
    return {layout: room(props), byKind};
  }
  const meshes = (w: {group: THREE.Group}, pred: (n: string) => boolean) => { const out: THREE.InstancedMesh[] = []; w.group.traverse(o => { if ((o as THREE.InstancedMesh).isInstancedMesh && pred(o.name)) out.push(o as THREE.InstancedMesh); }); return out; };
  const of = (k: string) => (n: string) => n === `prop-${k}` || n.startsWith(`prop-${k}-`);

  it('missing models: stand-ins; every destination kind drawn as prop-<kind>[-...] per storey; collision-only parts draw nothing; the geese cables reach the ceiling', () => {
    const {layout, byKind} = sample();
    const w = buildWorld(layout, mats, {});
    for (const k of SKYWAYS_DEST_KINDS) expect(meshes(w, of(k)).length, k).toBeGreaterThan(0);
    for (const im of meshes(w, n => n.startsWith('prop-skyD'))) expect(im.userData.level, im.name).toBe(0);
    // fountains: 2 drawn (the row's and the shrunk one), the column placement not drawn
    for (const im of meshes(w, of('skyDFountain'))) expect(im.count, im.name).toBe(byKind.get('skyDFountain')!.filter(p => !destCollisionOnly(p)).length);
    // the geese: two cables per flock from the rod tops straight up to the 12 m ceiling
    const cables = meshes(w, n => n === 'prop-skyDGeese-cable');
    expect(cables.length).toBe(1);
    expect(cables[0].count).toBe(2 * byKind.get('skyDGeese')!.length);
    const m = new THREE.Matrix4(), hang = destHangCables('skyways_d_lm_geese');
    for (let i = 0; i < cables[0].count; i++) {
      cables[0].getMatrixAt(i, m);
      const b = new THREE.Box3().setFromBufferAttribute(cables[0].geometry.attributes.position as THREE.BufferAttribute).applyMatrix4(m);
      expect(b.max.y, 'cable top').toBeCloseTo(CEIL, 3);
      expect([6, 7].some(y => Math.abs(b.min.y - (y + hang.y)) < 1e-3), `cable foot ${b.min.y}`).toBe(true);
      expect(b.max.x - b.min.x).toBeCloseTo(DEST_CABLE.t, 4);
    }
  });

  it('loaded kit models: drawn at the table\'s real size (k ~ 1), grounded on the placement, a shrunk placement at its scale', () => {
    const {layout, byKind} = sample();
    if (!Object.keys(lib).length) return; // (rows still planned: covered by the stand-in test)
    const w = buildWorld(layout, mats, lib);
    for (const k of HEROES) {
      const m = SKYWAYS_DEST_SPECS[k].model!, gl = lib[destModelKey(m)];
      if (!gl) continue;
      const row = SKYWAYS_DEST_PROPS[m];
      const fit = skywaysDestFit(k, new THREE.Box3().setFromObject(gl.scene).getSize(new THREE.Vector3()));
      expect(fit.k, k).toBeCloseTo(1, 2);
      const ims = meshes(w, n => n === `prop-${k}`);
      expect(ims.length, k).toBeGreaterThan(0);
      // the first placement of the kind (the row): its drawn box = the table's size, grounded at its y
      const p = byKind.get(k)![0], all = new THREE.Box3(), mm = new THREE.Matrix4();
      for (const im of ims) for (let i = 0; i < im.count; i++) {
        im.getMatrixAt(i, mm);
        const b = new THREE.Box3().setFromBufferAttribute(im.geometry.attributes.position as THREE.BufferAttribute).applyMatrix4(mm);
        if (Math.abs((b.min.x + b.max.x) / 2 - p.x) < 1.0 && Math.abs((b.min.z + b.max.z) / 2 - p.z) < 1.0) all.union(b);
      }
      expect(all.min.y, k).toBeCloseTo(p.y, 2);
      expect(all.max.y - all.min.y, k).toBeCloseTo(row.h, 1);
      expect(all.max.x - all.min.x, k).toBeCloseTo(row.w, 1);
    }
    // the shrunk fountain (0.8) is drawn 0.8 of the row's height
    const fr = SKYWAYS_DEST_PROPS.skyways_d_lm_fountain, small = new THREE.Box3(), mm = new THREE.Matrix4();
    for (const im of meshes(w, n => n === 'prop-skyDFountain')) for (let i = 0; i < im.count; i++) {
      im.getMatrixAt(i, mm);
      const b = new THREE.Box3().setFromBufferAttribute(im.geometry.attributes.position as THREE.BufferAttribute).applyMatrix4(mm);
      if (Math.hypot((b.min.x + b.max.x) / 2 - 20, (b.min.z + b.max.z) / 2 - 12) < 1) small.union(b);
    }
    expect(small.max.y - small.min.y).toBeCloseTo(fr.h * 0.8, 1);
  });

  it('art: poster / plaque quads sample their atlas pieces; the runtime\'s atlas material is used, else the plain board', () => {
    const {layout} = sample();
    const w = buildWorld(layout, mats, {});
    for (const [kind, n] of [['skyDPoster', DEST_POSTER_PIECES.length], ['skyDPlaque', DEST_PLAQUE_PIECES.length]] as const) {
      for (let v = 0; v < n; v++) {
        const im = meshes(w, x => x === `prop-${kind}-art${v}`)[0];
        expect(im, `${kind} ${v}`).toBeTruthy();
        const {atlas, piece} = destArtOf(kind, v), r = destArtPiece(atlas, piece)!;
        const uv = im.geometry.attributes.uv as THREE.BufferAttribute;
        for (let i = 0; i < uv.count; i++) {
          expect(uv.getX(i)).toBeGreaterThanOrEqual(r.u0 - 1e-6); expect(uv.getX(i)).toBeLessThanOrEqual(r.u1 + 1e-6);
          expect(uv.getY(i)).toBeGreaterThanOrEqual(r.v0 - 1e-6); expect(uv.getY(i)).toBeLessThanOrEqual(r.v1 + 1e-6);
        }
        expect((im.material as THREE.Material).name, `${kind} ${v}`).toBe('skyways-dest-board-plain');
      }
    }
    const art = new THREE.MeshStandardMaterial({name: 'atlas'});
    setSkywaysDestArtMaterial('plaques', art);
    expect(meshes(buildWorld(layout, mats, {}), x => x.startsWith('prop-skyDPlaque-art')).every(im => im.material === art)).toBe(true);
    setSkywaysDestArtMaterial('plaques', null);
  });

  it('preload: the placed posters\' / plaques\' atlases (level-only, via LevelResources) become one material each; a failed atlas keeps the plain board', async () => {
    const {layout} = sample();
    const asked: string[] = [], owned: unknown[] = [];
    const rt = new SkywaysDestRuntime({levelResources: {
      load: async (level, url) => { asked.push(`${level}:${url}`); return url.includes('plaques') ? null : new THREE.Texture(); },
      own: (_l, r) => { owned.push(r); return r; }}});
    await rt.preload(layout);
    // (+ lane STORE-SCIENCE: the sample places every destination kind, the science store's wall art too -> its atlas, one more owned material)
    expect(asked.sort()).toEqual([`skyways:${SKYWAYS_DEST_ART.plaques.url}`, `skyways:${SKYWAYS_DEST_ART.posters.url}`, `skyways:${SCIENCE_ART.url}`]);
    for (const u of asked) expect(levelOfAsset(u.slice('skyways:'.length)), u).toBe('skyways');
    expect(skywaysDestArtLoaded('posters')).toBe(true);
    expect(skywaysDestArtLoaded('plaques')).toBe(false);
    expect(owned.length).toBe(2);
    expect(rt.counts).toEqual({artLoaded: 1, artMissing: 1});
    setSkywaysDestArtMaterial('posters', null);
    asked.length = 0;
    await rt.preload(room([place('bench', 5, 5), place('skyDClock', 10, 10)]));
    expect(asked).toEqual([]);
  });
});
