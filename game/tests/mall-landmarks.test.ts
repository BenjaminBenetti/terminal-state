// Task track3-eaton-centre-20261031 (lane ARCH) -> task mall-playtest-revision-20261031 (lane ARCH): landmarks and navigation signage of
// the seeded "<Name> Center" (gen/mall/landmarks.ts placement, world/mallArch.ts render), REWRITTEN for the revised topology (station +
// three floors, corridor wings; variants terrace-cross / arcade-loop / elbow-branch):
//  - the pit-plaza fountain (basin + tiered centrepiece + sitting ledge, stagnant water), anchored static fixture with an honest
//    reason in both audits; the concentric terrazzo rings centre on it;
//  - directory pylons (the storey plan with a "You are here" dot, the brand directory) in the station court and on every ring near an
//    escalator head — never by a railing, in a shopfront entry zone, on a run mouth;
//  - wayfinding signs hung over every public run mouth ("Level N" up / "Level N" or "Subway" down) and every ring washroom mouth;
//    the station-return chain (lane GEN's wayfinding[].stationReturn) signed "... · Subway" at its run heads; "Atrium · Escalators"
//    inside every corridor wing where it meets the atrium court; the directory plan draws the way to the Subway;
//  - placement is deterministic, reachability is unchanged (mallIssues clean, every cell reachable without the landmarks stays
//    reachable with them), colliders = visuals, the Subway / Office generate nothing of it.
import * as THREE from 'three';
import {describe, expect, it} from 'vitest';
import {installCanvasShim} from './helpers/canvas2d';
import {fakeEnvTextures} from './helpers/openablesFixture';
import {CELL} from '../src/gen/grid';
import {levelDistance} from '../src/gen/levelGen';
import {generateMallLevel, mallIssues, MALL_GEN_STATS} from '../src/gen/mall/index';
import {FOUNTAIN, PYLON, WAYFINDING} from '../src/gen/mall/landmarks';
import {MALL_OPEN_AUDIT, MALL_PHYS} from '../src/gen/mall/kinds';
import {generateStation, type StationLayout} from '../src/gen/station';
import {OPENABLE_AUDIT} from '../src/world/openablesSpec';
import {PROP_PHYSICS_AUDIT} from '../src/damage/physicsAudit';
import {WorldMaterials} from '../src/world/materials';
import {buildWorld} from '../src/world/builder';
import {PYLON_FACE, directoryListTexture, directoryPlanTexture, splitFinishKey} from '../src/world/mallArch';
import {mallTableData} from '../src/world/mallSurfaces';
import {FLOOR as FLOOR_CODE} from '../src/world/mallFinishes';

installCanvasShim(false);

const KINDS = ['fountainBasin', 'fountainSpire', 'directoryPylon'] as const;
const VARIANTS = ['terrace-cross', 'arcade-loop', 'elbow-branch'] as const;
const gen = (seed: number, variant?: string) => generateMallLevel({levelSeed: seed, startWeapon: 'rifle'} as never, (variant ? {variant} : {}) as never) as StationLayout;
const cache = new Map<string, StationLayout>();
const mall = (seed = 12345, variant: string = VARIANTS[0]) => { const k = `${seed}|${variant}`; let l = cache.get(k); if (!l) cache.set(k, (l = gen(seed, variant))); return l; };
const landmarks = (l: StationLayout) => l.props.filter(p => (KINDS as readonly string[]).includes(p.kind));
const mats = () => new WorldMaterials(fakeEnvTextures(), 7, {w: 1.2, h: 0.19, d: 0.17});

describe('mall landmarks: placement', () => {
  it('every variant gets one fountain (basin + centrepiece), a directory pylon on every storey and wayfinding signs; mallIssues stays clean', () => {
    for (const v of VARIANTS) {
      const l = mall(12345, v);
      expect(l.mall!.variant).toBe(v);
      expect(mallIssues(l), v).toEqual([]);
      const lm = landmarks(l);
      expect(lm.filter(p => p.kind === 'fountainBasin').length, v).toBe(1);
      expect(lm.filter(p => p.kind === 'fountainSpire').length, v).toBe(1);
      const pylons = lm.filter(p => p.kind === 'directoryPylon');
      expect(new Set(pylons.map(p => p.level ?? 0)).size, `${v} pylon storeys`).toBe(l.mall!.storeys.length);
      expect(pylons.length, `${v} pylons`).toBeLessThanOrEqual(2 * l.mall!.storeys.length);
      expect(l.signs.filter(s => s.style && s.hang).length, v).toBeGreaterThan(12);
    }
  });

  it('is deterministic: the same seed places identical landmarks and signs', () => {
    const a = gen(4242), b = gen(4242);
    const key = (l: StationLayout) => JSON.stringify([landmarks(l).map(p => [p.kind, p.x, p.z, p.y, p.hx, p.hz, p.h, p.rot, p.level ?? 0]), l.signs.filter(s => s.style).map(s => [s.x, s.y, s.z, s.rot, s.text, s.arrow])]);
    expect(key(a)).toBe(key(b));
    expect(MALL_GEN_STATS.landmarks?.fountain).toBeTruthy();
  });

  it('reachability is unchanged: every cell reachable without the landmarks stays reachable with them; the fountain ring is walkable', () => {
    for (const v of [VARIANTS[0], VARIANTS[2]]) {
      const l = mall(12345, v);
      const st = l.mall!.start, [sx, sy] = l.grid.cellOf(st.x, st.z);
      const withLm = levelDistance(l.levels!, sx, sy, 0, l.levelLinks);
      // unblock the landmark footprints, measure again, re-block
      const cells: [number, number][] = [];
      for (const p of landmarks(l)) {
        const g = l.levels![p.level ?? 0].grid;
        for (let cy = Math.floor((p.z - p.hz) / CELL); cy < Math.ceil((p.z + p.hz) / CELL); cy++) for (let cx = Math.floor((p.x - p.hx) / CELL); cx < Math.ceil((p.x + p.hx) / CELL); cx++) {
          const i = g.idx(cx, cy);
          if (g.blocked[i]) { cells.push([p.level ?? 0, i]); g.blocked[i] = 0; }
        }
      }
      const without = levelDistance(l.levels!, sx, sy, 0, l.levelLinks);
      for (const [lv, i] of cells) l.levels![lv].grid.blocked[i] = 1;
      const foot = new Set(cells.map(([lv, i]) => `${lv}|${i}`));
      let lost = 0;
      for (const L of l.levels!) for (let i = 0; i < L.grid.cells.length; i++) if (without[L.id][i] >= 0 && withLm[L.id][i] < 0 && !foot.has(`${L.id}|${i}`)) lost++;
      expect(lost, `${v}: cells cut off by a landmark`).toBe(0);
      // the fountain: its whole clearance ring is open floor (a ring round a convex footprint never disconnects the floor)
      const f = landmarks(l).find(p => p.kind === 'fountainBasin')!, g0 = l.levels![f.level ?? 0].grid; // (the station court, else floor 1's atrium court)
      const r = f.hx + FOUNTAIN_RING(f.hx);
      for (let z = f.z - r + 0.25; z < f.z + r; z += 0.5) for (let x = f.x - r + 0.25; x < f.x + r; x += 0.5) {
        if (Math.abs(x - f.x) < f.hx + CELL / 2 && Math.abs(z - f.z) < f.hx + CELL / 2) continue; // the footprint, cell-rounded
        const [cx, cy] = g0.cellOf(x, z);
        expect(g0.walkable(cx, cy), `${v} ring cell ${x},${z}`).toBe(true);
      }
    }
  });

  it('pylons stand >= 2.5 m off every run mouth (near an escalator / stair / the lift / a link), >= 1.5 m from every railing, never in a shopfront entry zone; the fountain stays off run mouths and the track bed', () => {
    for (const v of VARIANTS) {
      const l = mall(12345, v), m = l.mall!;
      for (const p of landmarks(l).filter(q => q.kind === 'directoryPylon')) {
        const lv = p.level ?? 0;
        const mouths = m.verticals.filter(q => q.lower === lv || q.upper === lv).map(q => (q.lower === lv ? q.foot : q.head));
        const near = Math.min(...mouths.map(q => Math.hypot(q.x - p.x, q.z - p.z)));
        expect(near, `${v} L${lv} mouth distance`).toBeGreaterThanOrEqual(PYLON.mouth - 1e-6);
        expect(near).toBeLessThanOrEqual(12.5);
        for (const r of (l.rails ?? []).filter(q => q.level === lv)) {
          const dx = r.x1 - r.x0, dz = r.z1 - r.z0, L2 = dx * dx + dz * dz, t = L2 ? Math.max(0, Math.min(1, ((p.x - r.x0) * dx + (p.z - r.z0) * dz) / L2)) : 0;
          expect(Math.hypot(p.x - r.x0 - dx * t, p.z - r.z0 - dz * t), `${v} L${lv} rail`).toBeGreaterThanOrEqual(PYLON.rail);
        }
        for (const s of m.shops.filter(q => q.level === lv)) {
          const f = s.frontage;
          // the opening itself and 2 m in front of it (either side) stay clear
          const inZone = p.x + p.hx > Math.min(f.x0, f.x1) && p.x - p.hx < Math.max(f.x0, f.x1) && p.z + p.hz > Math.min(f.z0, f.z1) - 2 && p.z - p.hz < Math.max(f.z0, f.z1) + 2
            && (Math.abs(f.x1 - f.x0) >= Math.abs(f.z1 - f.z0));
          const inZoneZ = p.z + p.hz > Math.min(f.z0, f.z1) && p.z - p.hz < Math.max(f.z0, f.z1) && p.x + p.hx > Math.min(f.x0, f.x1) - 2 && p.x - p.hx < Math.max(f.x0, f.x1) + 2
            && (Math.abs(f.x1 - f.x0) < Math.abs(f.z1 - f.z0));
          expect(inZone || inZoneZ, `${v} pylon in ${s.id}'s entry`).toBe(false);
        }
      }
      const f = landmarks(l).find(q => q.kind === 'fountainBasin')!, fl = f.level ?? 0;
      for (const q of m.verticals.filter(x => x.lower === fl || x.upper === fl)) { const p = q.lower === fl ? q.foot : q.head; expect(Math.hypot(p.x - f.x, p.z - f.z), v).toBeGreaterThanOrEqual(FOUNTAIN.mouth + f.hx - 1e-6); }
      const g0 = l.levels![fl].grid;
      for (let i = 0; i < g0.cells.length; i++) if (g0.cells[i] === 2) {
        const cx = i % g0.w, cy = (i - cx) / g0.w, x = (cx + 0.5) * CELL, z = (cy + 0.5) * CELL;
        expect(Math.abs(x - f.x) < f.hx + FOUNTAIN.bed - 0.3 && Math.abs(z - f.z) < f.hx + FOUNTAIN.bed - 0.3, `${v} bed cell near the fountain`).toBe(false);
      }
    }
  });

  it('wayfinding: every public run has a foot sign (up) and a head sign (down); the station-return chain reads "· Subway"; corridor wings point back to the atrium; all hung above head height', () => {
    for (const v of VARIANTS) {
      const l = mall(12345, v), m = l.mall!;
      const signs = l.signs.filter(s => s.style && s.hang);
      const lab = (lv: number) => (lv === 0 ? 'Subway' : `Level ${lv}`);
      const banks = new Set(m.verticals.filter(q => q.kind === 'escalator' || q.kind === 'stair').map(q => `${q.lower}|${q.upper}`));
      for (const k of banks) {
        const [lo, up] = k.split('|').map(Number);
        expect(signs.some(s => s.level === lo && s.arrow === 'up' && s.text === `Level ${up}`), `${v} foot ${k}`).toBe(true);
        expect(signs.some(s => s.level === up && s.arrow === 'down' && (s.text === lab(lo) || s.text === `${lab(lo)} · Subway`)), `${v} head ${k}`).toBe(true);
      }
      // the way back to the station: from every retail floor, the first run of its stationReturn chain is signed at its head
      for (const w of m.wayfinding ?? []) {
        if (w.level === 0) continue;
        expect(w.stationReturn.length, `${v} L${w.level} has a way down`).toBeGreaterThan(0);
        const first = w.stationReturn[0];
        if (first.kind === 'elevator') continue;
        const want = first.to === 0 ? 'Subway' : `Level ${first.to} · Subway`;
        expect(signs.some(s => s.level === w.level && s.arrow === 'down' && s.text === want), `${v} L${w.level} return sign "${want}"`).toBe(true);
      }
      // corridor wings that meet the atrium court carry a sign back to it
      for (const c of m.corridors ?? []) if (c.areas.length) {
        const n = signs.filter(s => s.level === c.level && s.text === 'Atrium · Escalators').length;
        expect(n, `${v} L${c.level} corridor signs`).toBeLessThanOrEqual(c.areas.length);
      }
      expect(signs.some(s => s.text === 'Atrium · Escalators') || !(m.corridors ?? []).some(c => c.areas.length), `${v} corridor signs`).toBe(true);
      for (const s of signs) expect(s.y - (l.levels![s.level ?? 0].baseY)).toBeCloseTo(WAYFINDING.y, 5);
    }
  });

  it('the Subway and the Office generate no landmark props or mall wayfinding signs', () => {
    const s = generateStation(4242);
    expect(landmarks(s)).toEqual([]);
    expect(s.signs.some(x => x.style?.bg === 0x1f2b38)).toBe(false);
  });
});

describe('mall landmarks: classification, render (colliders = visuals), plaza rings', () => {
  it('each landmark kind is a classified STATIC fixture with an honest reason (physics audit + openables audit)', () => {
    for (const k of KINDS) {
      expect(MALL_PHYS[k].dynamic, k).toBe(false);
      expect((MALL_PHYS[k] as {how: string}).how.length).toBeGreaterThan(30);
      expect(MALL_OPEN_AUDIT[k].cls).toBe('none');
      expect(PROP_PHYSICS_AUDIT[k]?.cls, k).toBe('static');
      expect(OPENABLE_AUDIT.some(e => e.kind === k), k).toBe(true);
    }
  });

  it('the fountain and the pylons are drawn exactly in their colliders; the plaza rings centre on the fountain; bounded meshes', () => {
    const l = mall();
    const w = buildWorld(l, mats(), {});
    const meshes: THREE.Mesh[] = [];
    w.group.traverse(o => { if ((o as THREE.Mesh).isMesh) meshes.push(o as THREE.Mesh); });
    const box = (name: string) => { const ms = meshes.filter(m => m.name === name); expect(ms.length, name).toBe(1); return new THREE.Box3().setFromObject(ms[0]); };
    const basin = landmarks(l).find(p => p.kind === 'fountainBasin')!, spire = landmarks(l).find(p => p.kind === 'fountainSpire')!;
    const near = (a: number, b: number) => expect(Math.abs(a - b)).toBeLessThan(0.011);
    const bs = box('mall-fountain-stone').union(box('mall-fountain-coping'));
    near(bs.min.x, basin.x - basin.hx); near(bs.max.x, basin.x + basin.hx); near(bs.min.z, basin.z - basin.hz); near(bs.max.z, basin.z + basin.hz);
    near(bs.min.y, basin.y); expect(bs.max.y).toBeLessThanOrEqual(spire.y + spire.h + 0.01);
    const br = box('mall-fountain-bronze');
    expect(br.min.x).toBeGreaterThanOrEqual(spire.x - spire.hx - 0.01); expect(br.max.x).toBeLessThanOrEqual(spire.x + spire.hx + 0.01);
    near(br.max.y, spire.y + spire.h);
    const wa = box('mall-fountain-water');
    // stagnant water inside the basin (below the coping) and a puddle in the centrepiece's lowest bowl (inside its collider)
    expect(wa.min.x).toBeGreaterThan(basin.x - basin.hx); expect(wa.max.y).toBeLessThan(spire.y + 1.0);
    expect(wa.min.y).toBeLessThan(basin.y + basin.h);
    // pylons: the sign-box mesh of the storey holds the body box exactly; two faces (plan + directory) per pylon in the atlas
    for (const p of landmarks(l).filter(q => q.kind === 'directoryPylon')) {
      const m = meshes.find(q => q.name === `mall-sign-boxes-${p.level ?? 0}`)!;
      const P = m.geometry.attributes.position, b = new THREE.Box3();
      for (let i = 0; i < P.count; i++) { const v = new THREE.Vector3().fromBufferAttribute(P, i); if (Math.abs(v.x - p.x) <= p.hx + 1e-3 && Math.abs(v.z - p.z) <= p.hz + 1e-3 && v.y >= p.y - 1e-3 && v.y <= p.y + p.h + 1e-3) b.expandByPoint(v); }
      near(b.min.x, p.x - p.hx); near(b.max.x, p.x + p.hx); near(b.min.z, p.z - p.hz); near(b.max.z, p.z + p.hz); near(b.min.y, p.y); near(b.max.y, p.y + p.h);
    }
    const st = w.mallArch!.stats;
    expect(st.fountains).toBe(1);
    expect(st.pylons).toBe(landmarks(l).filter(q => q.kind === 'directoryPylon').length);
    expect(meshes.filter(m => m.name.startsWith('mall-fountain')).length).toBe(4);
    expect(meshes.filter(m => m.name.startsWith('mall-sign-faces')).length).toBeLessThanOrEqual(4);
    expect(PYLON_FACE.w).toBeLessThan(PYLON.w);
    // the court's concentric rings centre on the fountain (when it stands in the station court)
    if ((basin.level ?? 0) === 0) {
      const g0 = l.levels![0].grid, [cx, cy] = g0.cellOf(basin.x + basin.hx + 1, basin.z);
      const k = w.mallArch!.floorKey(0, g0.idx(cx, cy))!;
      const r = splitFinishKey(k).row, T = mallTableData();
      expect(T[(r * 4) * 4 + 3]).toBe(FLOOR_CODE.rings);
      expect(T[(r * 4 + 3) * 4 + 1]).toBeCloseTo(basin.x, 4);
      expect(T[(r * 4 + 3) * 4 + 2]).toBeCloseTo(basin.z, 4);
    }
    console.log(`[mall landmarks] fountain at ${basin.x},${basin.z} (half ${basin.hx}); ${st.pylons} pylons; ${l.signs.filter(s => s.style && s.hang).length} wayfinding signs; atrium meshes ${st.meshes}`);
  });

  it('the directory faces draw (plan with "You are here", brand list) for every storey without errors', () => {
    const l = mall();
    for (const s of l.mall!.storeys) {
      const t = directoryPlanTexture(l, s.level, {x: l.mall!.void.bounds.x0, z: l.mall!.void.bounds.z0}, null, 1);
      expect(l.mall!.name).toMatch(/ Center$/);
      expect((t.image as {width: number}).width).toBe(320);
      expect((directoryListTexture(l, s.level, 2).image as {height: number}).height).toBe(480);
    }
  });
});

/** The clearance ring the fountain was placed with (the full size or the smaller fallback). */
function FOUNTAIN_RING(half: number): number { return half >= FOUNTAIN.half - 1e-6 ? FOUNTAIN.ring : 1.2; }
