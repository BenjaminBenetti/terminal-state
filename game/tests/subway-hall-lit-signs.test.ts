// Task studio-subway-rework-m2-finishing-20261117-111246-01: a version-3 grand hall's DESTINATION plates are backlit boxes (the review:
// "lower ticket / service / waiting bays need to read as destinations rather than black silhouettes", without a global brightness change):
//  - the dresser marks its own plates lit (SignPlacement.lit: the ticket office fascia, the pocket name plates, the hung wayfinding boxes,
//    the clerestory tablets) and nothing else — a version-2 station has no lit plate;
//  - the builder draws lit faces on their own emissive sign-atlas page (aGlow per instance), every other plate exactly as before.

import * as THREE from 'three';
import {describe, expect, it} from 'vitest';
import {installCanvasShim} from './helpers/canvas2d';
import {fakeEnvTextures} from './helpers/openablesFixture';
import {generateStation} from '../src/gen/station';
import {SIGN_LIT, OFFICE_FASCIA} from '../src/gen/stationHallV3Dress';
import {WorldMaterials} from '../src/world/materials';
import {buildWorld, SIGN_GLOW} from '../src/world/builder';

installCanvasShim(false);
const mats = () => new WorldMaterials(fakeEnvTextures(), 7, {w: 1.2, h: 0.19, d: 0.17});
/** Grand-hall stations of the corpus (generateStation seeds). */
const SEEDS = [3, 4];

describe('v3 grand hall: backlit destination plates', () => {
  it('the dresser lights its own plates only (fascia, pockets, hung boxes, tablets); version 2 has none', () => {
    for (const seed of SEEDS) {
      const L = generateStation(seed, {layoutVersion: 3});
      const T = L.areas.find(a => a.role === 'grand-ticket-hall')!;
      const lit = L.signs.filter(s => s.lit);
      expect(lit.length, `seed ${seed}`).toBeGreaterThan(4);
      for (const s of lit) {
        expect(s.area).toBe(T.id);
        expect(s.lit!).toBeGreaterThan(0);
        expect(s.lit!).toBeLessThanOrEqual(1);
      }
      expect(lit.some(s => s.text === OFFICE_FASCIA.text && s.lit === SIGN_LIT.fascia), `seed ${seed} fascia`).toBe(true);
      expect(lit.some(s => s.hang), `seed ${seed} hung`).toBe(true);
      expect(lit.some(s => s.h), `seed ${seed} tablets`).toBe(true);
      // the gate plates (the version-2 rule) stay ordinary
      expect(L.signs.filter(s => s.text === 'TO TRAINS · ALL PLATFORMS' && !s.hang).every(s => !s.lit)).toBe(true);
      expect(generateStation(seed, {layoutVersion: 2}).signs.some(s => s.lit)).toBe(false);
    }
  });

  it('the builder draws lit faces on an emissive page with a per-instance glow; unlit plates keep the plain page', () => {
    const L = generateStation(SEEDS[0], {layoutVersion: 3});
    const w = buildWorld(L, mats(), {});
    const faces: THREE.InstancedMesh[] = [];
    w.group.traverse(o => { const m = o as THREE.InstancedMesh; if (m.isInstancedMesh && /^sign-face/.test(m.name)) faces.push(m); });
    const lit = faces.filter(m => m.name === 'sign-face-lit'), plain = faces.filter(m => m.name === 'sign-face');
    expect(lit.length).toBeGreaterThan(0);
    expect(plain.length).toBeGreaterThan(0);
    const litCount = L.signs.filter(s => s.lit).reduce((n, s) => n + (s.hang ? 2 : 1), 0);
    expect(lit.reduce((n, m) => n + m.count, 0)).toBe(litCount);
    for (const m of lit) {
      const g = m.geometry.getAttribute('aGlow');
      expect(g.count).toBe(m.count);
      for (let i = 0; i < g.count; i++) expect(g.getX(i)).toBeGreaterThan(0);
      const mat = m.material as THREE.Material & {emissiveNode?: unknown};
      expect(mat.name).toBe('sign-atlas-lit');
      expect(mat.emissiveNode).toBeTruthy();
    }
    for (const m of plain) {
      expect(m.geometry.getAttribute('aGlow')).toBeUndefined();
      expect((m.material as THREE.Material & {emissiveNode?: unknown}).emissiveNode ?? null).toBeNull();
    }
    expect(SIGN_GLOW).toBeGreaterThan(0);
    expect(SIGN_GLOW).toBeLessThanOrEqual(1);
  });
});
