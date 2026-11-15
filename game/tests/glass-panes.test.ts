// Task baked-gi-visual-uplift-20261115-004324 (lane MIRROR): the glass-plane registry (world/glassPanes.ts) against the real base
// Subway — every glazing span the storefront builder draws and every booth pane is a pane of exactly one plane, with the
// generator's own extents; the merge is stable; a shot-out span is not intact.
import {describe, expect, it} from 'vitest';
import {LEVELS} from '../src/levels/registry';
import type {StationLayout} from '../src/gen/station';
import type {PropPlacement} from '../src/gen/props';
import {propShape} from '../src/gen/propShapes';
import {storefrontParts} from '../src/gen/storefronts';
import {GLASS_MERGE_EPS, GLAZING_BROKEN_H, boothGlassBoxes, collectGlassPlanes, type GlassPane, type GlassPlane} from '../src/world/glassPanes';

const SEEDS = [93, 7, 2024];
const subway = (seed: number): StationLayout => LEVELS.subway.generate('main', {levelSeed: seed >>> 0}) as StationLayout;
const layouts = new Map<number, StationLayout>();
const layoutOf = (seed: number): StationLayout => {
  let l = layouts.get(seed);
  if (!l) layouts.set(seed, (l = subway(seed)));
  return l;
};

/** The pane of `planes` that is this world box (thin along x or z), or null. */
function findPane(planes: readonly GlassPlane[], b: {x0: number; y0: number; z0: number; x1: number; y1: number; z1: number}): {plane: GlassPlane; pane: GlassPane} | null {
  const alongX = b.x1 - b.x0 > b.z1 - b.z0;
  const axis = alongX ? 'z' : 'x', coord = alongX ? (b.z0 + b.z1) / 2 : (b.x0 + b.x1) / 2, u0 = alongX ? b.x0 : b.z0, u1 = alongX ? b.x1 : b.z1;
  for (const plane of planes) {
    if (plane.axis !== axis || Math.abs(plane.coord - coord) > GLASS_MERGE_EPS) continue;
    for (const pane of plane.panes) {
      if (Math.abs(pane.u0 - u0) < 1e-9 && Math.abs(pane.u1 - u1) < 1e-9 && Math.abs(pane.y0 - b.y0) < 1e-9 && Math.abs(pane.y1 - b.y1) < 1e-9 && Math.abs(pane.coord - coord) < 1e-9) return {plane, pane};
    }
  }
  return null;
}

describe('glass planes of the base Subway', () => {
  it('holds every storefront glazing span with the generator box as its rectangle, and names the span blocker', () => {
    let spans = 0;
    for (const seed of SEEDS) {
      const L = layoutOf(seed), planes = collectGlassPlanes(L);
      for (const sf of L.storefronts) {
        for (const b of storefrontParts(L, sf, {anchorSign: true}).boxes) {
          if (b.m !== 'glassShopfront') continue;
          spans++;
          const hit = findPane(planes, b);
          expect(hit, `seed ${seed} storefront ${sf.id}`).not.toBeNull();
          const {plane, pane} = hit!;
          expect(pane.source).toBe('storefront');
          expect(pane.half).toBeCloseTo(0.01, 6); // the 2 cm glazing
          // the blocker of exactly this span (gen/storefronts.ts dressStorefront: one shopGlazing prop per span)
          expect(pane.prop?.kind).toBe('shopGlazing');
          expect(pane.prop?.shop).toBe(sf.id);
          const p = pane.prop as PropPlacement, mid = (pane.u0 + pane.u1) / 2;
          // (the blocker spans the whole cells of the span; the glass stops 7 cm short at a jamb)
          expect(Math.abs((plane.axis === 'z' ? p.x : p.z) - mid)).toBeLessThan(0.05);
          expect(Math.abs((plane.axis === 'z' ? p.hx : p.hz) - (pane.u1 - pane.u0) / 2)).toBeLessThan(0.05);
          // inside its plane's rectangle
          expect(pane.u0).toBeGreaterThanOrEqual(plane.u0); expect(pane.u1).toBeLessThanOrEqual(plane.u1);
          expect(pane.y0).toBeGreaterThanOrEqual(plane.y0); expect(pane.y1).toBeLessThanOrEqual(plane.y1);
          expect(pane.intact()).toBe(true);
        }
      }
    }
    expect(spans).toBeGreaterThan(3); // (the seeds really have glazed fronts)
  });

  it('holds the three panes of every booth, at the instanced boxes', () => {
    let booths = 0;
    const local = (propShape('booth') ?? []).filter(p => p.m === 'glass');
    expect(local.length).toBe(3);
    for (const seed of SEEDS) {
      const L = layoutOf(seed), planes = collectGlassPlanes(L);
      for (const p of L.props) {
        if (p.kind !== 'booth') continue;
        booths++;
        const boxes = boothGlassBoxes(p);
        expect(boxes.length).toBe(3);
        const c = Math.cos(p.rot), s = Math.sin(p.rot);
        boxes.forEach((b, i) => {
          // the instancing transform (world/builder.ts addProceduralProp: translate . rotateY(rot)) of the local box centre
          const [px, py, pz] = local[i].p;
          expect((b.x0 + b.x1) / 2).toBeCloseTo(p.x + px * c + pz * s, 6);
          expect((b.z0 + b.z1) / 2).toBeCloseTo(p.z - px * s + pz * c, 6);
          expect((b.y0 + b.y1) / 2).toBeCloseTo(p.y + py, 6);
          expect(b.y1 - b.y0).toBeCloseTo(local[i].s[1], 6);
          // inside the prop's footprint
          expect(b.x0).toBeGreaterThan(p.x - p.hx - 1e-6); expect(b.x1).toBeLessThan(p.x + p.hx + 1e-6);
          expect(b.z0).toBeGreaterThan(p.z - p.hz - 1e-6); expect(b.z1).toBeLessThan(p.z + p.hz + 1e-6);
          const hit = findPane(planes, b);
          expect(hit, `seed ${seed} booth pane ${i}`).not.toBeNull();
          expect(hit!.pane.source).toBe('booth');
          expect(hit!.pane.prop).toBe(p);
        });
      }
    }
    expect(booths).toBeGreaterThan(0);
  });

  it('merges into planes: one axis, one level, one coordinate; panes of one wall share a plane; nothing else is in', () => {
    for (const seed of SEEDS) {
      const L = layoutOf(seed), planes = collectGlassPlanes(L);
      let panes = 0;
      for (const pl of planes) {
        expect(pl.panes.length).toBeGreaterThan(0);
        panes += pl.panes.length;
        let u0 = Infinity, u1 = -Infinity, y0 = Infinity, y1 = -Infinity;
        for (const p of pl.panes) {
          expect(Math.abs(p.coord - pl.coord)).toBeLessThanOrEqual(GLASS_MERGE_EPS);
          expect(p.u1 - p.u0).toBeGreaterThanOrEqual(0.3); expect(p.y1 - p.y0).toBeGreaterThanOrEqual(0.3);
          u0 = Math.min(u0, p.u0); u1 = Math.max(u1, p.u1); y0 = Math.min(y0, p.y0); y1 = Math.max(y1, p.y1);
        }
        expect([pl.u0, pl.u1, pl.y0, pl.y1]).toEqual([u0, u1, y0, y1]);
        expect(pl.slot).toBeGreaterThanOrEqual(0);
      }
      // every pane comes from a drawn box: storefront spans + three per booth (+ decor panes), nothing invented
      const spans = L.storefronts.reduce((n, sf) => n + storefrontParts(L, sf, {anchorSign: true}).boxes.filter(b => b.m === 'glassShopfront').length, 0);
      const decor = L.decor.filter(b => b.m === 'glassShopfront' && Math.min(b.x1 - b.x0, b.z1 - b.z0) <= 0.06 && b.y1 - b.y0 >= 0.3).length;
      const booths = L.props.filter(p => p.kind === 'booth').length;
      expect(panes).toBeGreaterThanOrEqual(spans + booths * 3);
      expect(panes).toBeLessThanOrEqual(spans + booths * 3 + decor);
      // two distinct planes of one axis and slot are further apart than the merge distance
      for (let i = 0; i < planes.length; i++) for (let j = i + 1; j < planes.length; j++) {
        const a = planes[i], b = planes[j];
        if (a.axis === b.axis && a.slot === b.slot) expect(Math.abs(a.coord - b.coord)).toBeGreaterThan(GLASS_MERGE_EPS * 0.5);
      }
      // ids are unique
      expect(new Set(planes.map(p => p.id)).size).toBe(planes.length);
      // a storefront with two glazing spans (an entry in the middle): both spans in ONE plane
      for (const sf of L.storefronts) {
        const bs = storefrontParts(L, sf, {anchorSign: true}).boxes.filter(b => b.m === 'glassShopfront');
        if (bs.length < 2) continue;
        const owners = new Set(bs.map(b => findPane(planes, b)!.plane.id));
        expect(owners.size).toBe(1);
      }
    }
  });

  it('is deterministic: the same layout gives the same planes (and a fresh generation of the seed too)', () => {
    const digest = (planes: readonly GlassPlane[]): string => JSON.stringify(planes.map(p => [p.id, p.axis, p.slot, p.coord, p.half, p.u0, p.u1, p.y0, p.y1, p.panes.map(q => [q.u0, q.u1, q.y0, q.y1, q.coord, q.source, q.prop ? [q.prop.kind, q.prop.x, q.prop.z] : null])]));
    const L = layoutOf(93);
    const a = digest(collectGlassPlanes(L));
    expect(digest(collectGlassPlanes(L))).toBe(a);
    expect(digest(collectGlassPlanes(subway(93)))).toBe(a);
    // nothing was written to the layout
    const before = JSON.stringify(L.props.filter(p => p.kind === 'shopGlazing' || p.kind === 'booth'));
    collectGlassPlanes(L);
    expect(JSON.stringify(L.props.filter(p => p.kind === 'shopGlazing' || p.kind === 'booth'))).toBe(before);
  });

  it('a shot-out pane is not intact: by the layout (the blocker cut down to its plinth) and by the damage state callback', () => {
    const L = subway(93); // a private copy: this test changes prop heights
    const gone = new Set<PropPlacement>();
    const planes = collectGlassPlanes(L, {broken: p => gone.has(p)});
    const all = planes.flatMap(pl => pl.panes);
    const shop = all.find(p => p.source === 'storefront')!, booth = all.find(p => p.source === 'booth')!;
    expect(shop && booth).toBeTruthy();
    expect(all.every(p => p.intact())).toBe(true);
    // damage/propDamage.ts breakGlass on a shopGlazing blocker: prop.h = min(h, 0.3)
    const h = shop.prop!.h;
    shop.prop!.h = Math.min(h, GLAZING_BROKEN_H);
    expect(shop.intact()).toBe(false);
    expect(all.filter(p => !p.intact()).every(p => p.prop === shop.prop)).toBe(true);
    shop.prop!.h = h;
    expect(shop.intact()).toBe(true);
    // the damage system's state (booth glass: no layout record)
    gone.add(booth.prop!);
    expect(booth.intact()).toBe(false);
    const sameBooth = all.filter(p => p.prop === booth.prop);
    expect(sameBooth.length).toBe(3);
    expect(sameBooth.every(p => !p.intact())).toBe(true);
    expect(all.filter(p => p.prop !== booth.prop).every(p => p.intact())).toBe(true);
    gone.clear();
    expect(booth.intact()).toBe(true);
  });
});
