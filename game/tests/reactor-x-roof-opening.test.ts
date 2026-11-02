// Task reactor-submit-roof-fog-20261102 (lane ROOF): THE PIT ROOF's SINGLE OPENING. User: "the roof, is not looking correct … I want a
// single hole above the reactor not a totally open roof." (Was: levels[0].sky with no mask opened the WHOLE pit top: no roof slab, an
// open beam grid against the green sky.) On real generated Reactors (both stair walls, single + twin towers) and the kit fixture:
//  - the generator: ONE connected round opening centred on the core, its diameter (2.4 core radii, clamped to keep a solid band to
//    every wall), the LevelSky.open mask = exactly its cells; the roof slab (ceiling runs at roofY) everywhere else in the pit;
//  - rays: only those crossing the roof plane inside the opening leave into the sky (what the sky / outside gas can be seen through);
//    every other upward ray stops at the roof; walls still stop horizontal rays; the mask survives a re-frame (Track 2 growth);
//  - the kit: girders + secondary beams under the slab, none crossing the opening, none through the crane trolley, trimmed into the
//    curb ring; the curb ring meshes (steel ring girder + concrete upstand) on the opening radius, faces pointing out of the solid;
//  - the sky dome over the opening (inside the far plane), none without an opening; the shafts only through the opening (CPU mirror);
//  - the Levels mask semantics on a synthetic grid (the Office's unmasked open roof unchanged).
import {describe, expect, it} from 'vitest';
import * as THREE from 'three';
import {LEVELS} from '../src/levels/registry';
import {CELL, FLOOR, Grid, SOLID} from '../src/gen/grid';
import {Levels, levelsOf, type Level} from '../src/gen/levels';
import type {StationLayout} from '../src/gen/stationTypes';
import type {ReactorInfo} from '../src/gen/reactor/reactorTypes';
import {inOutline} from '../src/gen/reactor/gaslightLamps';
import {ROOF_OPENING, roofOpeningMask, roofOpeningOf} from '../src/gen/reactor/roofOpening';
import {reframe} from '../src/gen/trackExt/core';
import {LevelColumns, ceilingRuns, stationLevels} from '../src/world/levelGeometry';
import {planReactorKit, polyDist} from '../src/world/reactor/archKit';
import {ROOF_KIT, SLAB_HOLE_PAST, buildRoofSlab, roofKitStats} from '../src/world/reactor/roofKit';
import {ReactorArch} from '../src/world/reactor/arch';
import {WorldMaterials} from '../src/world/materials';
import {installCanvasShim} from './helpers/canvas2d';
import {fakeEnvTextures} from './helpers/openablesFixture';
import {PIT_SKY, buildPitSky} from '../src/world/reactor/gaslightSky';
import {REACTOR_FOG} from '../src/world/reactor/archInstall';
import {PIT_SHAFTS, pitShaftSpec, shaftAt} from '../src/world/gaslightRules';
import {archFixtureInfo} from './reactor-arch-fixture';
import {buildWorld} from '../src/world/builder';

installCanvasShim(false);

/** Both stair walls, single + twin towers (the probe: 9100 west single, 637474 / 1 / 42 twin). */
const SEEDS = [9100, 637474, 1, 42];
const cache = new Map<number, StationLayout>();
const level = (seed: number) => { let L = cache.get(seed); if (!L) cache.set(seed, (L = LEVELS.reactor.generate('main', {levelSeed: seed}))); return L; };
const centre = (i: number, w: number) => ({x: ((i % w) + 0.5) * CELL, z: (Math.floor(i / w) + 0.5) * CELL});
/** Point (x, z) under the slab mesh (its triangles in plan view); every triangle faces down. */
function slabCover(m: THREE.Mesh): (x: number, z: number) => boolean {
  const pos = m.geometry.getAttribute('position'), nrm = m.geometry.getAttribute('normal'), idx = m.geometry.index!;
  const T: number[][] = [];
  for (let f = 0; f < idx.count; f += 3) {
    const v = [idx.getX(f), idx.getX(f + 1), idx.getX(f + 2)];
    const A = new THREE.Vector3().fromBufferAttribute(pos, v[0]), B = new THREE.Vector3().fromBufferAttribute(pos, v[1]), C = new THREE.Vector3().fromBufferAttribute(pos, v[2]);
    expect(B.clone().sub(A).cross(C.clone().sub(A)).y).toBeLessThan(0); // wound to face down (the soffit seen from the pit)
    for (const k of v) expect(nrm.getY(k)).toBeCloseTo(-1, 6);
    T.push([A.x, A.z, B.x, B.z, C.x, C.z]);
  }
  const side = (ax: number, az: number, bx: number, bz: number, px: number, pz: number) => (bx - ax) * (pz - az) - (bz - az) * (px - ax);
  return (x, z) => T.some(([ax, az, bx, bz, cx, cz]) => {
    const d1 = side(ax, az, bx, bz, x, z), d2 = side(bx, bz, cx, cz, x, z), d3 = side(cx, cz, ax, az, x, z);
    return !((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0));
  });
}
const unit = (x: number, y: number, z: number) => { const l = Math.hypot(x, y, z); return {x: x / l, y: y / l, z: z / l}; };

describe('roof opening: the generator (real Reactors)', () => {
  for (const seed of SEEDS) {
    it(`seed ${seed}: one connected round opening centred on the core, its diameter, the solid roof everywhere else in the pit`, () => {
      const L = level(seed), info = L.reactor!, p = info.pit, g = L.levels[0].grid, W = g.w;
      const o = roofOpeningOf(info)!;
      expect(o).not.toBeNull();
      // centred on the core; 2.4 core radii across (the clamp does not bite on a real pit) and a substantial solid roof to every wall
      expect(o.x).toBeCloseTo(info.core.x, 3);
      expect(o.z).toBeCloseTo(info.core.z, 3);
      expect(2 * o.r).toBeCloseTo(2 * ROOF_OPENING.coreK * info.core.radius, 3);
      expect(2 * o.r).toBeGreaterThan(15);
      expect(2 * o.r).toBeLessThan(18.5);
      expect(polyDist(p.outline, o.x, o.z) - o.r - ROOF_OPENING.curb).toBeGreaterThanOrEqual(ROOF_OPENING.band);
      // the sky marking: the rim storey only, at the roof line, with exactly the opening's cells open
      const sky0 = L.levels[0].sky!;
      expect(L.levels.filter(l => l.sky).length).toBe(1);
      // Task studio-reactor-surface-ending-20261102 (lane ENDING, user: "This door should lead up a set of stairs, towards a surface
      // area … roughly situated around the hole on the roof"): supersedes "the mask = exactly the opening's cells at the roof line". The
      // open sky now also covers the walkable SURFACE plaza on the roof (layout.reactor.surface, levels[surface.level]): its band top is
      // the sky ceil and the opening's column rises through the deck to it; the pit cells keep their roof-line ceiling (< ceil: a real
      // roof). The opening itself is unchanged: sky.open minus the plaza's cells = exactly roofOpeningMask, checked below as before.
      const S = info.surface!;
      expect(S).toBeTruthy();
      expect(sky0).toMatchObject({y: p.rimY, ceil: S.ceil, top: p.roofY, outdoor: {level: S.level, y: S.parapetY}});
      expect(sky0.open).toBeInstanceOf(Uint8Array);
      expect(sky0.open!.length).toBe(g.w * g.h);
      const holeMask = roofOpeningMask(g.w, g.h, o), gS = L.levels[S.level].grid;
      sky0.open!.forEach((v, i) => expect(v, `cell ${i}`).toBe(holeMask[i] || (gS.cells[i] === FLOOR && gS.area[i] === S.areas.plaza) ? 1 : 0));
      for (let i = 0; i < holeMask.length; i++) if (holeMask[i]) expect(gS.cells[i]).toBe(SOLID); // the opening is no deck
      const sky = {...sky0, open: holeMask}; // the opening's cells (the checks below)
      const cells: number[] = [];
      sky.open!.forEach((v, i) => { if (v) cells.push(i); });
      // one 4-connected component, inside the pit, centred on the core, round: every cell touches the disc, the disc is covered
      const set = new Set(cells), seen = new Set<number>([cells[0]]), stack = [cells[0]];
      while (stack.length) { const i = stack.pop()!; for (const j of [i - 1, i + 1, i - W, i + W]) if (set.has(j) && !seen.has(j)) { seen.add(j); stack.push(j); } }
      expect(seen.size).toBe(cells.length);
      let sx = 0, sz = 0;
      for (const i of cells) {
        const c = centre(i, W);
        expect(inOutline(p.outline, c.x, c.z)).toBe(true);
        expect(Math.hypot(c.x - o.x, c.z - o.z)).toBeLessThan(o.r + CELL * Math.SQRT1_2 + 1e-6);
        sx += c.x; sz += c.z;
      }
      expect(Math.hypot(sx / cells.length - o.x, sz / cells.length - o.z)).toBeLessThan(0.25);
      const eqD = 2 * Math.sqrt((cells.length * CELL * CELL) / Math.PI);
      expect(eqD).toBeGreaterThan(2 * o.r);
      expect(eqD).toBeLessThan(2 * o.r + 1.2);
      for (let k = 0; k < 64; k++) { // the disc's own rim is open (no notch into the round hole)
        const a = (k / 64) * Math.PI * 2, [cx, cy] = g.cellOf(o.x + Math.cos(a) * (o.r - 0.01), o.z + Math.sin(a) * (o.r - 0.01));
        expect(sky.open![g.idx(cx, cy)]).toBe(1);
      }
      // THE SOLID ROOF. The grid: ceiling runs at the roof line never cover an opening cell (the mask), they cover the rest of the
      // pit's flat cells. The render: ONE slab mesh over the pit outline with the round hole covers every pit column outside the curb
      // (the open-well wall flights the builder never roofs included), and the arch hands the builder none of its roof-line runs.
      const levels = stationLevels(L), runs = ceilingRuns(levels, new LevelColumns(levels));
      const roofed = new Set<number>();
      for (const r of runs) if (Math.abs(r.y - p.roofY) < 0.01) for (let x = r.x0; x < r.x1; x++) roofed.add(r.row * W + x);
      const slab = buildRoofSlab(info, new THREE.MeshBasicMaterial(), {u: 1, v: 1}, L.levels.map(l => l.id))!;
      expect(slab.name).toBe('reactor-arch-roof');
      expect(slab.userData.levels).toEqual(L.levels.map(l => l.id));
      const covers = slabCover(slab);
      const arch = ReactorArch.for(L, new WorldMaterials(fakeEnvTextures(), 7, {w: 1.2, h: 0.19, d: 0.17}), L.levels)!;
      let pitRoof = 0, open = 0, legs = 0, overHole = 0, flights = 0, slabbed = 0;
      for (let i = 0; i < g.cells.length; i++) {
        const c = centre(i, W);
        if (!inOutline(p.outline, c.x, c.z)) continue;
        const atRoof = L.levels.some(lv => lv.grid.cells[i] !== SOLID && lv.grid.hasCeil(i) && lv.grid.ceil[i] >= p.roofY - 0.01);
        const d = Math.hypot(c.x - o.x, c.z - o.z);
        if (sky.open![i]) {
          if (atRoof) { open++; if (roofed.has(i)) overHole++; }
          else { legs++; expect(L.levels.every(lv => lv.grid.cells[i] === SOLID)).toBe(true); } // a tower leg's reserved column
        } else if (atRoof) {
          pitRoof++;
          if (L.levels.some(lv => lv.grid.rampIdx[i] >= 0)) flights++;
        }
        if (d > o.r + SLAB_HOLE_PAST + 0.05) { expect(covers(c.x, c.z), `slab at ${c.x},${c.z}`).toBe(true); slabbed++; }
        else if (d < o.r + SLAB_HOLE_PAST - 0.05) expect(covers(c.x, c.z)).toBe(false);
        if (atRoof && roofed.has(i)) expect(arch.ceilKey(0, -1, i, p.roofY)).toBe(false);
      }
      expect(open + legs).toBe(cells.length); // the opening is pit air up to the roof line (or a tower leg's solid column)
      expect(legs).toBeLessThan(cells.length * 0.03);
      expect(overHole).toBe(0);
      expect(flights).toBeGreaterThan(20); // wall flights reach the roof line: the slab spans them
      expect(pitRoof).toBeGreaterThan(open * 5); // a roof with a hole, not a hole with a rim
      expect(slabbed).toBeGreaterThan(pitRoof * 0.95);
      expect(arch.ceilKey(0, -1, cells[0], p.roofY - 8)).toBe('reactor-deck-under'); // deck undersides below stay the builder's
    }, 120_000);
  }

  it('rays: only those crossing the roof plane inside the opening leave into the sky; the roof stops every other one, walls stop the side', () => {
    let escaped = 0, stopped = 0;
    for (const seed of SEEDS.slice(0, 2)) {
      const L = level(seed), info = L.reactor!, p = info.pit, o = roofOpeningOf(info)!, lv = levelsOf(L), b = p.bounds;
      // eyes over the rim gallery / pit air at the rim, a tier and the core floor; upward rays in a cone
      for (const y of [1.7, info.tiers[2].baseY + 1.7, p.floorY + 1.7]) {
        for (let ex = b.x0 + 1.5; ex < b.x1 - 1; ex += 5.5) for (let ez = b.z0 + 1.5; ez < b.z1 - 1; ez += 5.5) {
          for (const [dx, dz] of [[0, 0], [0.35, 0.1], [-0.3, 0.25], [0.15, -0.4], [-0.6, -0.5], [0.8, 0.55]]) {
            const d = unit(dx, 1, dz), h = lv.raycast({x: ex, y, z: ez}, d, 400);
            const t = (p.roofY - y) / d.y, qx = ex + d.x * t, qz = ez + d.z * t, rq = Math.hypot(qx - o.x, qz - o.z);
            if (h.kind === 'none') {
              escaped++;
              expect(rq, `seed ${seed} eye ${ex},${y},${ez}`).toBeLessThan(o.r + CELL * Math.SQRT2 + 1e-3);
            } else {
              stopped++;
              if (h.kind === 'ceiling' && Math.abs(h.t * d.y + y - p.roofY) < 0.01) expect(rq).toBeGreaterThan(o.r - 1e-3);
            }
          }
        }
      }
      // straight up through the opening's centre: the sky; straight up beside the opening: the roof; sideways at the rim: a wall
      expect(lv.raycast({x: o.x, y: 1.7, z: o.z}, {x: 0, y: 1, z: 0}, 400).kind).toBe('none');
      const beside = lv.raycast({x: o.x + o.r + 3, y: 1.7, z: o.z}, {x: 0, y: 1, z: 0}, 400);
      expect(beside.kind).toBe('ceiling');
      expect(beside.t + 1.7).toBeCloseTo(p.roofY, 3);
      expect(lv.raycast({x: o.x, y: 4, z: o.z}, {x: 1, y: 0, z: 0}, 400).kind).toBe('wall');
      // a shallow ray toward the pit wall above the rim (into the old open top's corner): the roof / wall, never the sky
      expect(lv.raycast({x: o.x, y: 1.7, z: o.z}, unit(1, 0.3, 0), 400).kind).not.toBe('none');
    }
    expect(escaped).toBeGreaterThan(20);
    expect(stopped).toBeGreaterThan(escaped * 3);
  }, 120_000);

  it('the mask survives a re-frame (Track 2 growth): windowed with the grids', () => {
    const L = level(SEEDS[0]), g = L.grid, m = L.levels[0].sky!.open!;
    const R = reframe(L, -2, -3, g.w + 5, g.h + 7), m2 = R.levels[0].sky!.open!;
    expect(m2.length).toBe((g.w + 5) * (g.h + 7));
    let n = 0;
    m.forEach((v, i) => { if (!v) return; n++; const x = i % g.w, y = Math.floor(i / g.w); expect(m2[(y + 3) * (g.w + 5) + x + 2]).toBe(1); });
    expect([...m2].reduce((s, v) => s + v, 0)).toBe(n);
  }, 120_000);
});

describe('roof opening: the kit (girders under the slab, trimmed round the curb, the curb ring)', () => {
  const roofMembers = (plan: ReturnType<typeof planReactorKit>) => (plan.parts.get('ibeam|steelDark')?.list ?? []).filter(i => i.tag === 'roof');
  /** A member's plan footprint corners (unit box -0.5..0.5 through its matrix) and its y range. */
  const footprint = (m: THREE.Matrix4) => {
    const pts: THREE.Vector3[] = [];
    for (const x of [-0.5, 0.5]) for (const y of [-0.5, 0.5]) for (const z of [-0.5, 0.5]) pts.push(new THREE.Vector3(x, y, z).applyMatrix4(m));
    return pts;
  };
  /** Least distance from (cx, cz) to a member's footprint (sampled along its length and across its width). */
  const minDist = (m: THREE.Matrix4, cx: number, cz: number) => {
    let best = Infinity;
    for (let a = -0.5; a <= 0.5001; a += 0.02) for (const w of [-0.5, 0, 0.5]) {
      const q = new THREE.Vector3(w, 0, a).applyMatrix4(m);
      best = Math.min(best, Math.hypot(q.x - cx, q.z - cz));
    }
    return best;
  };

  for (const [name, get] of [['real seed 9100', () => level(9100).reactor!], ['real seed 1', () => level(1).reactor!], ['kit fixture', () => archFixtureInfo()]] as const) {
    it(`${name}: a girder grid under the slab, no member over the opening or through the trolley, trimmed into the curb`, () => {
      const info = get() as ReactorInfo, p = info.pit, o = roofOpeningOf(info)!;
      const plan = planReactorKit(info), st = roofKitStats(plan)!;
      expect(st.opening).toEqual(o);
      expect(st.girders).toBeGreaterThan(5);
      expect(st.beams).toBeGreaterThan(12);
      expect(st.trimmedAtCurb).toBeGreaterThanOrEqual(5); // >= 2 girders + 3 beams cross the ring zone
      expect(st.curb).toBe(true);
      expect(plan.stats.roofBeams).toBe(st.girders + st.beams);
      const list = roofMembers(plan);
      expect(list.length).toBe(st.girders + st.beams);
      const t = st.trolley;
      for (const inst of list) {
        const pts = footprint(inst.m);
        const y0 = Math.min(...pts.map(q => q.y)), y1 = Math.max(...pts.map(q => q.y));
        expect(y1).toBeLessThan(p.roofY); // under the slab
        expect(y0).toBeGreaterThan(p.roofY - ROOF_KIT.girderD - 0.1);
        // inside the pit (wall to wall)
        for (const q of pts) { expect(q.x).toBeGreaterThan(p.bounds.x0 - 0.3); expect(q.x).toBeLessThan(p.bounds.x1 + 0.3); expect(q.z).toBeGreaterThan(p.bounds.z0 - 0.3); expect(q.z).toBeLessThan(p.bounds.z1 + 0.3); }
        // never over the opening: at least the ring girder's width minus the tuck from its axis
        expect(minDist(inst.m, o.x, o.z)).toBeGreaterThan(o.r + ROOF_OPENING.curb - ROOF_KIT.tuck - 0.02);
        // never through the crane trolley's body (its keep-out box: the members' y range always overlaps the trolley's)
        if (t) {
          const x0 = Math.min(...pts.map(q => q.x)), x1 = Math.max(...pts.map(q => q.x)), z0 = Math.min(...pts.map(q => q.z)), z1 = Math.max(...pts.map(q => q.z));
          const ax = Math.abs(x1 - x0) > Math.abs(z1 - z0); // its length runs along x
          const w = ax ? (z1 - z0) / 2 : (x1 - x0) / 2, cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
          const overlapAcross = ax ? cz + w > t.z0 + 1e-6 && cz - w < t.z1 - 1e-6 : cx + w > t.x0 + 1e-6 && cx - w < t.x1 - 1e-6;
          const overlapAlong = ax ? x1 > t.x0 + 1e-6 && x0 < t.x1 - 1e-6 : z1 > t.z0 + 1e-6 && z0 < t.z1 - 1e-6;
          expect(overlapAcross && overlapAlong, `roof member through the trolley at ${cx.toFixed(2)},${cz.toFixed(2)}`).toBe(false);
        }
      }
      // the grid reaches the opening from every side (the ring is carried): member ends near the ring on all four sides
      const sides = new Set<string>();
      for (const inst of list) {
        const d = minDist(inst.m, o.x, o.z);
        if (d > o.r + ROOF_OPENING.curb + 0.5) continue;
        const c = new THREE.Vector3(0, 0, 0).applyMatrix4(inst.m);
        sides.add(Math.abs(c.x - o.x) > Math.abs(c.z - o.z) ? (c.x > o.x ? 'E' : 'W') : (c.z > o.z ? 'S' : 'N'));
      }
      expect(sides).toEqual(new Set(['N', 'S', 'E', 'W']));
      // the curb ring: two merged meshes on the opening radius; every face points out of its solid (winding = normal)
      const curb = plan.merged.filter(m => m.name.startsWith('reactor-roof-curb-'));
      expect(curb.map(m => [m.name, m.mat])).toEqual([['reactor-roof-curb-steel', 'steelDark'], ['reactor-roof-curb-concrete', 'concrete']]);
      let tris = 0;
      for (const m of curb) {
        let rMin = Infinity, rMax = 0, yMin = Infinity, yMax = -Infinity;
        for (const g of m.geos) {
          const pos = g.getAttribute('position'), nrm = g.getAttribute('normal'), idx = g.index!;
          for (let k = 0; k < pos.count; k++) {
            const r = Math.hypot(pos.getX(k) - o.x, pos.getZ(k) - o.z);
            rMin = Math.min(rMin, r); rMax = Math.max(rMax, r); yMin = Math.min(yMin, pos.getY(k)); yMax = Math.max(yMax, pos.getY(k));
          }
          const A = new THREE.Vector3(), B = new THREE.Vector3(), C = new THREE.Vector3(), N = new THREE.Vector3();
          for (let f = 0; f < idx.count; f += 3) {
            const [a, b, c] = [idx.getX(f), idx.getX(f + 1), idx.getX(f + 2)];
            A.fromBufferAttribute(pos, a); B.fromBufferAttribute(pos, b); C.fromBufferAttribute(pos, c);
            const face = B.clone().sub(A).cross(C.clone().sub(A));
            if (face.lengthSq() < 1e-12) continue;
            N.fromBufferAttribute(nrm, a).add(new THREE.Vector3().fromBufferAttribute(nrm, b)).add(new THREE.Vector3().fromBufferAttribute(nrm, c));
            expect(face.dot(N)).toBeGreaterThan(0);
            tris++;
          }
        }
        expect(rMin).toBeCloseTo(o.r, 2); // the inner face IS the opening's edge
        if (m.mat === 'steelDark') { expect(rMax).toBeCloseTo(o.r + ROOF_OPENING.curb, 2); expect(yMin).toBeCloseTo(p.roofY - ROOF_KIT.ringD, 4); expect(yMax).toBeCloseTo(p.roofY, 4); }
        else { expect(rMax).toBeCloseTo(o.r + ROOF_KIT.upstandT, 2); expect(yMin).toBeCloseTo(p.roofY, 4); expect(yMax).toBeCloseTo(p.roofY + ROOF_KIT.upstandH, 4); }
      }
      expect(tris).toBeLessThan(1000); // cheap: a few hundred triangles, two draws
      // the stepped grid hole hides above the closed ring box: every open cell lies within the ring girder's outer radius
      const mask = roofOpeningMask(400, 400, o);
      mask.forEach((v, i) => { if (!v) return; const c = centre(i, 400); expect(Math.hypot(c.x - o.x, c.z - o.z) + CELL * Math.SQRT1_2).toBeLessThan(o.r + ROOF_OPENING.curb); });
    }, 120_000);
  }

  it('the built world (real seed 9100): ONE roof slab mesh (no builder roof-line chunks), the curb meshes, the sky — a cheap roof', () => {
    const L = level(9100), info = L.reactor!, o = roofOpeningOf(info)!;
    const w = buildWorld(L as never, new WorldMaterials(fakeEnvTextures(), 7, {w: 1.2, h: 0.19, d: 0.17}), {});
    const count = new Map<string, number>();
    let roofTris = 0;
    w.group.traverse(m => {
      const mesh = m as THREE.Mesh;
      if (!mesh.isMesh) return;
      count.set(mesh.name, (count.get(mesh.name) ?? 0) + 1);
      if (/^reactor-arch-roof$|^reactor-roof-curb-/.test(mesh.name)) roofTris += (mesh.geometry.index ? mesh.geometry.index.count : mesh.geometry.getAttribute('position').count) / 3;
    });
    expect(count.get('reactor-arch-roof')).toBe(1); // (the builder's roof-line runs were ~17 per-level / per-chunk meshes)
    expect(count.get('reactor-roof-curb-steel')).toBe(1);
    expect(count.get('reactor-roof-curb-concrete')).toBe(1);
    expect(count.get('pit-sky')).toBe(1);
    expect(roofTris).toBeLessThan(1200);
    const slab = w.group.getObjectByName('reactor-arch-roof') as THREE.Mesh;
    expect(slab.material).toBe(w.reactorArch!.material('reactor-roof')); // the builder's own roof surface material
    expect(w.reactorArch!.pitSky!.opening).toEqual(o);
    const roofParts = w.reactorArch!.built!.stats.byPart['ibeam|steelDark'];
    expect(roofParts.meshes).toBeLessThanOrEqual(w.reactorArch!.plan!.tiers.length); // the roof steel joins the existing per-band mesh
  }, 180_000);

  it('no opening (the pit too narrow for the curb + the solid band): the roof stays closed — no curb, the beams run through, no sky', () => {
    const base = archFixtureInfo();
    const info: ReactorInfo = {...base, pit: {...base.pit, outline: [{x: 20, z: 20}, {x: 34, z: 20}, {x: 34, z: 56}, {x: 20, z: 56}], bounds: {x0: 20, z0: 20, x1: 34, z1: 56}}, core: {...base.core, x: 27, z: 38}};
    expect(roofOpeningOf(info)).toBeNull();
    const plan = planReactorKit(info), st = roofKitStats(plan)!;
    expect(st.curb).toBe(false);
    expect(st.trimmedAtCurb).toBe(0);
    expect(plan.merged.some(m => m.name.startsWith('reactor-roof-curb'))).toBe(false);
    expect(pitShaftSpec(info)).toBeNull();
    const g = new THREE.Group();
    expect(buildPitSky(g, info, [0])).toBeNull();
    expect(g.children.length).toBe(0);
  });
});

describe('roof opening: the sky and the shafts only through it', () => {
  it('the sky dome is centred over the opening at the roof line, inside the far plane from anywhere in the pit; the outside gas built', () => {
    const info = archFixtureInfo(), o = roofOpeningOf(info)!, g = new THREE.Group();
    const st = buildPitSky(g, info, [0, 1, 2])!;
    expect(st.opening).toEqual(o);
    const sky = g.getObjectByName('pit-sky') as THREE.Mesh;
    expect([sky.position.x, sky.position.y, sky.position.z]).toEqual([o.x, info.pit.roofY, o.z]);
    expect((sky.material as THREE.Material).depthWrite).toBe(false); // the slab / curb cover it: seen only through the opening
    for (const n of ['pit-exterior-gas', 'pit-exterior-gas-curtain']) expect(g.getObjectByName(n)).toBeDefined();
    for (const seed of SEEDS.slice(0, 2)) {
      const L = level(seed), p = L.reactor!.pit, oo = roofOpeningOf(L.reactor!)!, b = p.bounds;
      let worst = 0;
      for (const x of [b.x0, b.x1]) for (const z of [b.z0, b.z1]) worst = Math.max(worst, Math.hypot(x - oo.x, p.floorY - p.roofY, z - oo.z));
      expect(PIT_SKY.radius + worst).toBeLessThan(REACTOR_FOG.far);
    }
  });

  it('real layout: a point is in the shaft only when its sky ray crosses the roof inside the opening; a point whose sky ray leaves through the hole is lit', () => {
    const L = level(SEEDS[0]), info = L.reactor!, p = info.pit, o = roofOpeningOf(info)!, s = pitShaftSpec(info)!, lv = levelsOf(L);
    const d = PIT_SHAFTS.dir, up = unit(-d[0], -d[1], -d[2]);
    let lit = 0, dark = 0, escapedLit = 0;
    for (let y = p.floorY + 1; y < p.roofY - 0.5; y += 3.1) {
      for (let x = p.bounds.x0 + 0.7; x < p.bounds.x1; x += 1.9) for (let z = p.bounds.z0 + 0.7; z < p.bounds.z1; z += 1.9) {
        const t = p.roofY - y, qx = x - (d[0] / -d[1]) * t, qz = z - (d[2] / -d[1]) * t, rq = Math.hypot(qx - o.x, qz - o.z);
        const v = shaftAt(s, x, y, z);
        if (v > 0) { lit++; expect(rq).toBeLessThan(o.r); } else dark++;
        // where the level geometry lets the sky ray out (through the hole, nothing above), the shaft lights it
        const [cx, cy] = L.grid.cellOf(x, z);
        if (rq < o.r - 0.1 && L.levels.some(l => l.grid.cells[l.grid.idx(cx, cy)] !== SOLID && l.grid.floorOf(l.grid.idx(cx, cy)) < y && l.grid.ceil[l.grid.idx(cx, cy)] > y)) {
          if (lv.raycast({x, y, z}, up, 400).kind === 'none') { expect(v).toBeGreaterThan(0); escapedLit++; }
        }
      }
    }
    expect(lit).toBeGreaterThan(50);
    expect(dark).toBeGreaterThan(lit * 3); // one column, not the whole pit
    expect(escapedLit).toBeGreaterThan(20);
  }, 120_000);
});

describe('roof opening: LevelSky.open semantics (synthetic)', () => {
  /** A 12 x 12 one-storey room (floor 0, band top 6 = the sky's ceil), an open roof (Office-like) or a 2 x 2 opening at cells 5..6. */
  const world = (mask: boolean) => {
    const g = new Grid(12, 12);
    for (let y = 1; y < 11; y++) for (let x = 1; x < 11; x++) { const i = g.idx(x, y); g.cells[i] = FLOOR; g.area[i] = 0; g.floor[i] = 0; g.ceil[i] = 6; }
    const open = new Uint8Array(144);
    for (const [x, y] of [[5, 5], [6, 5], [5, 6], [6, 6]]) open[g.idx(x, y)] = 1;
    const lv: Level = {id: 0, role: 'main', grid: g, baseY: 0, sky: {y: 0, ceil: 6, top: 5, ...(mask ? {open} : {})}};
    return {g, levels: [lv], L: new Levels([lv])};
  };
  it('unmasked (the Office roof): every band top at the sky ceil is open and closed columns above `top` are open air — unchanged', () => {
    const {L, levels} = world(false);
    expect(L.raycast({x: 2.2, y: 1, z: 2.2}, {x: 0, y: 1, z: 0}, 50).kind).toBe('none');
    expect(L.raycast({x: 3, y: 5.5, z: 3}, {x: 1, y: 0, z: 0}, 50).kind).toBe('none'); // above the parapet top: open air
    const runs = ceilingRuns(levels, new LevelColumns(levels));
    expect(runs.length).toBe(0);
  });
  it('masked (the Reactor): only the opening\'s columns open; the rest is a ceiling; closed columns are solid at every height', () => {
    const {L, levels, g} = world(true);
    expect(L.raycast({x: 2.8, y: 1, z: 2.8}, {x: 0, y: 1, z: 0}, 50).kind).toBe('none'); // cell (5, 5) (CELL 0.5)
    const hit = L.raycast({x: 2.2, y: 1, z: 2.2}, {x: 0, y: 1, z: 0}, 50);
    expect(hit.kind).toBe('ceiling');
    expect(hit.t).toBeCloseTo(5, 6);
    expect(L.raycast({x: 3, y: 5.5, z: 3}, {x: 1, y: 0, z: 0}, 50).kind).toBe('wall'); // no open air above `top` any more
    const runs = ceilingRuns(levels, new LevelColumns(levels));
    let covered = 0;
    for (const r of runs) for (let x = r.x0; x < r.x1; x++) { covered++; expect(levels[0].sky!.open![r.row * g.w + x]).toBe(0); }
    expect(covered).toBe(100 - 4);
  });
});
