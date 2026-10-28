// Iteration 12 (ARCH), user feedback #1: "in the stair ways the bricks 'go diagonal' with the stairs, this is
// incorrect because the bricks would always be straight up and down, and not slope with the stairs in real life."
//
// Root cause: extractWallFaces gave stair-flight side walls a texture base that followed the pitch line
// (vb0 != vb1, base = pitch + skirt at each end), and the builder maps v = (y - base) / span per end, so every
// course, the charcoal base and the teal band ran parallel to the flight. Now every zone of a flight wall has a
// CONSTANT texture base: the landings' dados continue level into the stairwell, plain courses between, and only a
// raked skirting strip ('tileBase', two charcoal courses, coursed level) follows the treads.
import {describe, expect, it} from 'vitest';
import * as THREE from 'three';
import {installCanvasShim} from './helpers/canvas2d';
import {levelFixture} from './helpers/levelRenderFixture';
import {ARCHETYPES, generateStation, type StationLayout} from '../src/gen/station';
import {TEXTURE_FILES, type TextureKey} from '../src/assets/manifest';
import {WorldMaterials, type MatKey} from '../src/world/materials';
import {buildWorld} from '../src/world/builder';
import {
  LevelColumns, STAIR_BASE_H, extractWallFaces, stairWallBands, stairWallZones, stationLevels, TAG_AF, TAG_AC, type BuiltFace, type Piece,
} from '../src/world/levelGeometry';

function fakeEnvTextures(): Record<TextureKey, THREE.Texture> {
  const out = {} as Record<TextureKey, THREE.Texture>;
  for (const k of Object.keys(TEXTURE_FILES) as TextureKey[]) out[k] = new THREE.Texture({width: 64, height: 64} as unknown as HTMLImageElement);
  return out;
}
const TILE = 1.8;
const faces = (l: StationLayout): BuiltFace[] => { const lv = stationLevels(l); return extractWallFaces(l, lv, new LevelColumns(lv), {tileLowerHeight: TILE}); };
/** Every landing height a flight wall may anchor its courses to (+ the tile line above it). */
function anchors(l: StationLayout): number[] {
  const out = new Set<number>();
  for (const L of stationLevels(l)) for (const r of L.grid.ramps) for (const h of [r.h0, r.h1]) { out.add(h); out.add(h + TILE); }
  return [...out];
}

describe('stair-flight side walls: gravity-aligned courses (user feedback #1)', () => {
  it('zones: contiguous, constant bases, landing dados level; a flat cell gets its flat wall zones', () => {
    for (const [lo, hi] of [[0, 1.7], [1.7, 3.4], [-2, 0], [0, 1.0], [0, 2.04]]) {
      const z = stairWallBands('tile', lo, hi, TILE);
      expect(z[0].y0).toBe(-Infinity);
      expect(z[z.length - 1].y1).toBe(Infinity);
      for (let i = 1; i < z.length; i++) expect(z[i].y0).toBeCloseTo(z[i - 1].y1, 9);
      // Bottom landing's dado (base lo) at the bottom, the top landing's (base hi) from its skirting line up.
      expect(z[0]).toMatchObject({finish: 'tileLower', base: lo});
      expect(z.find(q => q.finish === 'tileLower' && q.base === hi)!.y0).toBeCloseTo(hi + STAIR_BASE_H, 9);
      expect(z[z.length - 1]).toMatchObject({finish: 'tileUpper', base: hi + TILE});
    }
    expect(stairWallBands('tile', 2, 2, TILE)).toEqual([{y0: -Infinity, y1: 2 + TILE, finish: 'tileLower', base: 2}, {y0: 2 + TILE, y1: Infinity, finish: 'tileUpper', base: 2 + TILE}]);
    expect(stairWallBands('paint', 0, 1.7, TILE).map(q => q.base)).toEqual([0, 1.7]);
    expect(stairWallBands('tunnel', 0, 1.7, TILE)).toEqual([{y0: -Infinity, y1: Infinity, finish: 'tunnel', base: 0}]);
  });

  it('zoned pieces tile the sloped piece exactly; the raked skirting follows the pitch, everything else is level', () => {
    // A flight wall over one 0.5 m cell edge: pitch 0.6 -> 0.9 (skirt 0.35 below), ceiling 2.5 above the pitch.
    const pitch = (u: number) => 0.6 + 0.3 * u;
    const p: Piece = {ua: 0, ub: 1, b0: 0.25, b1: 0.55, t0: 3.1, t1: 3.4, bt: TAG_AF, tt: TAG_AC};
    const out = stairWallZones(p, 'tile', pitch, 0, 1.7, TILE);
    const area = (q: {ua: number; ub: number; b0: number; b1: number; t0: number; t1: number}) => (q.ub - q.ua) * ((q.t0 - q.b0) + (q.t1 - q.b1)) / 2;
    expect(out.reduce((s, q) => s + area(q), 0)).toBeCloseTo(area(p), 9);
    const base = out.filter(q => q.finish === 'tileBase');
    expect(base.length).toBeGreaterThan(0);
    for (const q of base) { expect(q.t0).toBeCloseTo(pitch(q.ua) + STAIR_BASE_H, 9); expect(q.t1).toBeCloseTo(pitch(q.ub) + STAIR_BASE_H, 9); expect(q.base).toBe(0); }
    for (const q of out.filter(r => r.finish !== 'tileBase')) {
      // Above the skirting every boundary is level except the piece's own sloped edges.
      const bottomSloped = Math.abs(q.b1 - q.b0) > 1e-9, topSloped = Math.abs(q.t1 - q.t0) > 1e-9;
      if (bottomSloped) expect(q.b0 - pitch(q.ua)).toBeCloseTo(STAIR_BASE_H, 9);
      if (topSloped) expect(q.t1 - q.t0).toBeCloseTo((p.t1 - p.t0) * (q.ub - q.ua), 9);
      expect([0, 1.7, TILE, 1.7 + TILE]).toContain(q.base);
    }
    // A flat cell's piece (no pitch) is never raked.
    expect(stairWallZones({...p, b0: 1.2, b1: 1.5}, 'tile', null, 1.0, 1.0, TILE).every(q => q.finish !== 'tileBase')).toBe(true);
  });

  it('every family + fixture: published sloped faces have one constant texture base anchored at a landing', () => {
    const stations: [string, StationLayout][] = [['fixture', levelFixture().layout], ...ARCHETYPES.map(a => [a, generateStation(9001, {archetype: a})] as [string, StationLayout])];
    let sloped = 0, skirting = 0;
    for (const [name, l] of stations) {
      const ok = anchors(l);
      for (const f of faces(l)) {
        if (!f.slope) continue;
        sloped++;
        if (f.finish === 'tileBase') skirting++;
        expect(f.vb0, `${name} ${f.finish} @${f.x0},${f.z0}`).toBe(f.vb1);
        // Anchored at a landing height (or its tile line): the courses meet the landings' flat walls.
        if (/tile|paint/.test(f.finish)) expect(ok.some(a => Math.abs(a - f.vb0) < 1e-6), `${name} ${f.finish} base ${f.vb0}`).toBe(true);
      }
    }
    expect(sloped).toBeGreaterThan(100);
    expect(skirting).toBeGreaterThan(20);
  });

  it('built flight walls: texture V depends on world height only (same y -> same row, anywhere along the flight)', () => {
    const un = installCanvasShim(false);
    try {
      const mats = new WorldMaterials(fakeEnvTextures(), 7, {w: 1.2, h: 0.19, d: 0.17});
      // Two courses per tileBase repeat, like the plain upper courses.
      expect(mats.scale.tileBase.v).toBeCloseTo(0.2989, 3);
      expect(mats.scale.tileBase.v).toBeCloseTo(mats.scale.tileUpper.v, 6);
      for (const l of [levelFixture().layout, generateStation(9001, {archetype: 'deep'}), generateStation(1234, {archetype: 'island-ends'})]) {
        const w = buildWorld(l, mats, {});
        const ok = anchors(l);
        let checked = 0, slopedTris = 0;
        w.group.traverse(o => {
          const m = o as THREE.Mesh;
          const key = /^arch-(tileLower|tileUpper|tileBase|paint)@-1:/.exec(m.name)?.[1] as MatKey | undefined;
          if (!m.isMesh || !key) return;
          const span = mats.scale[key].v;
          const P = m.geometry.attributes.position, UV = m.geometry.attributes.uv, N = m.geometry.attributes.normal, I = m.geometry.index!;
          for (let t = 0; t < I.count; t += 3) {
            const ids = [I.getX(t), I.getX(t + 1), I.getX(t + 2)];
            if (Math.abs(N.getY(ids[0])) > 1e-3) continue; // walls only
            const ys = ids.map(i => P.getY(i));
            if (Math.max(...ys) - Math.min(...ys) < 1e-6) continue;
            // v * span - y is the (negated) texture base: constant over the triangle => rows are level.
            const bases = ids.map(i => P.getY(i) - UV.getY(i) * span);
            expect(Math.max(...bases) - Math.min(...bases), m.name).toBeLessThan(1e-4);
            // Anchored at a flight's landing (or its tile line), so courses meet the landings' flat walls.
            expect(ok.some(a => Math.abs(a - bases[0]) < 1e-3), `${m.name} base ${bases[0]}`).toBe(true);
            const xs = ids.map(i => P.getX(i)), zs = ids.map(i => P.getZ(i));
            if (Math.max(...xs) - Math.min(...xs) > 0.2 || Math.max(...zs) - Math.min(...zs) > 0.2) slopedTris++;
            checked++;
          }
        });
        expect(checked).toBeGreaterThan(50);
        expect(slopedTris).toBeGreaterThan(10);
      }
    } finally { un(); }
  });
});
