// Task studio-alpha-skyways-shops-20261107-054512-01 (primary): THE SKYWAYS MAJOR STORES' CONTRACT (gen/skyways/stores/).
//  - Version 2 (GAME77, the live build) regenerates byte for byte (fingerprints computed on main be3173d with the same function: areas
//    incl. purposes, props, pickups, enemies, the storefronts' sides) — a station entered at version 2 keeps its holders / poses / loot.
//  - Version 3: every anchor gets its store (the store spec's dresser and Skyways-scoped loot purposes), an OUTWARD storefront (its side
//    the hall wall: the fascia faces the lobby), and each family's purposes / finishes resolve.
import {describe, expect, it} from 'vitest';
import * as crypto from 'node:crypto';
import {LEVELS} from '../src/levels/registry';
import {SKYWAYS_STORES, SKYWAYS_STORES_MIN_VERSION} from '../src/gen/skyways/stores/index';
import {SKYWAYS_LAYOUT_VERSION} from '../src/gen/skyways/layoutVersion';
import {purposeById} from '../src/gen/purposes';
import {shopFrame, storefrontParts} from '../src/gen/storefronts';
import {CELL} from '../src/gen/grid';
import {SKYWAYS_SHOP_FAMILIES} from '../src/gen/skyways/skywaysTypes';
import type {StationLayout} from '../src/gen/stationTypes';

const GAME77_V2: Record<number, string> = {
  1: 'b8befca4d53d4f1e', 2: 'bbf78b80d8e04049', 3: '9b6b60d542552949', 4: 'b3265ddb888b2717', 5: 'f8e0af1ae4509b8f',
  6: '24f48cff21a37d7d', 7: '1e22ca26665b2e57', 8: '8f1b92934a1696bd', 707: '7365a28e2eda3873', 4242: '26b2be8056dd6110',
};
const gen = (seed: number, layoutVersion?: number) => LEVELS.skyways.generate('main', {levelSeed: seed, startWeapon: 'pistol', ...(layoutVersion !== undefined ? {layoutVersion} : {})} as never) as StationLayout;
function fingerprint(l: StationLayout): string {
  const fp = JSON.stringify({info: l.skyways, areas: l.areas.map(a => [a.x, a.y, a.w, a.h, a.label, a.type, a.ceil, a.level ?? 0, a.purpose ?? '']), props: l.props.map(p => [p.kind, p.x, p.z, p.y, p.rot, p.level ?? 0, p.variant ?? 0]),
    pickups: l.pickups.map(p => [p.itemId, p.x, p.z]), zombies: l.zombies.map(z => [z.x, z.z, z.archetype]), lights: l.lights.length, sf: l.storefronts.map(s => [s.side, s.ox, s.oy, s.anchor ?? '']), links: l.levelLinks.length});
  return crypto.createHash('sha256').update(fp).digest('hex').slice(0, 16);
}

describe('Skyways major stores: the contract', () => {
  it('version 2 (GAME77) regenerates exactly (fingerprints pinned on main be3173d)', () => {
    for (const [s, want] of Object.entries(GAME77_V2)) expect(fingerprint(gen(Number(s), 2)), `seed ${s}`).toBe(want);
  }, 600_000);

  it('the stores follow the layout version; every family has a spec whose purposes exist', () => {
    expect(SKYWAYS_LAYOUT_VERSION).toBeGreaterThanOrEqual(SKYWAYS_STORES_MIN_VERSION);
    for (const f of SKYWAYS_SHOP_FAMILIES) {
      const s = SKYWAYS_STORES[f];
      expect(s.family).toBe(f);
      for (const id of Object.values(s.purposes)) expect(purposeById(id), `${f}: purpose ${id}`).toBeTruthy();
    }
  });

  it('version 3: every anchor takes its store\'s purposes and an OUTWARD storefront (the fascia faces the lobby)', () => {
    let seen = 0;
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      const l = gen(seed, 3);
      for (const an of l.skyways!.anchors ?? []) {
        seen++;
        const P = SKYWAYS_STORES[an.family].purposes;
        expect(l.areas[an.floor].purpose, `${an.family} floor`).toBe(P.floor);
        for (const z of an.zones) expect(l.areas[z].purpose).toBe(P.zones ?? P.floor);
        const sf = l.storefronts[an.storefront];
        expect(sf.outward).toBe(true);
        // the fascia stands on the lobby side: its centre lies in the hall's area (the lobby), not in the shop
        const face = storefrontParts(l, sf).faces.find(f => f.kind === 'fascia')!;
        const g = l.levels[an.level].grid, fr = shopFrame(sf);
        const [cx, cy] = g.cellOf(face.x + (fr.alongX ? 0 : fr.sign * 0.3), face.z + (fr.alongX ? fr.sign * 0.3 : 0));
        expect(g.area[g.idx(cx, cy)], `${an.family} fascia in the lobby (seed ${seed})`).toBe(sf.hall);
      }
    }
    expect(seen).toBeGreaterThan(10);
  }, 600_000);

  it('version 3: no loose floor piles in a store (noFloorLoot on every store area; the level keeps its floor-supply count)', () => {
    for (const seed of [1, 3, 6]) {
      const l = gen(seed, 3), v2 = gen(seed, 2);
      const flagged = new Set(l.areas.filter(a => a.noFloorLoot).map(a => a.id));
      for (const an of l.skyways!.anchors ?? []) for (const id of [an.floor, ...an.zones, ...an.stock, ...(an.upper !== undefined ? [an.upper] : [])]) expect(flagged.has(id), `${an.family} area ${id}`).toBe(true);
      const onFloor = l.pickups.filter(p => flagged.has(p.area) && Math.abs(p.y - (l.areas[p.area].floorY ?? 0)) < 0.05);
      expect(onFloor, `seed ${seed}`).toEqual([]);
      expect(v2.areas.some(a => a.noFloorLoot)).toBe(false);
    }
  }, 600_000);

  it('version 2 anchors keep their record; the renderer turns their sign band to the lobby (anchorSign)', () => {
    const l = gen(4, 2);
    for (const an of l.skyways!.anchors ?? []) {
      const sf = l.storefronts[an.storefront];
      expect(sf.outward).toBeUndefined();
      const g = l.levels[an.level].grid;
      const old = storefrontParts(l, sf).faces.find(f => f.kind === 'fascia')!, now = storefrontParts(l, sf, {anchorSign: true}).faces.find(f => f.kind === 'fascia')!;
      const areaAt = (x: number, z: number) => { const [cx, cy] = g.cellOf(x, z); return g.area[g.idx(cx, cy)]; };
      // the old face stood inside the shop; the rendered one is on the lobby side (a cell past the wall row), facing the other way
      expect(areaAt(old.x, old.z)).not.toBe(sf.hall);
      const dx = now.x - old.x, dz = now.z - old.z;
      expect(Math.hypot(dx, dz)).toBeGreaterThan(CELL * 0.9);
      expect(Math.abs(Math.abs(now.rot - old.rot) - Math.PI)).toBeLessThan(1e-6);
    }
  });
});
