// Task studio-subway-vertical-layout-20261118-022131-01: THE GREEN CAVERN'S BOUNCE CAST.
// User: "One look reads very green and strange ... Identify the affected look and actual source of the cast; correct it locally, including
// on existing stations where compatible, without recolouring the other looks or changing global lighting, fog, exposure or settings."
// The look is the cavern family's cavernGreen theme; the cast is the enhanced bounce through its painted rock (nearly every surface such a
// station's spaces see), which lit the neutral granite floor and wainscot off the white-light line (world/subwayFinish.ts
// CAVERN_BOUNCE_CHROMA). The fix is render-only and scoped to that theme:
//  - the green paint's LIGHT-BAKE albedo (userData.lightAlbedo: what the bounce, probes and traced torch take it to be) keeps its luminance
//    at 0.4 of its chroma, on every zone drawn in the paint (rock walls / roof and the field / upper / struct that share them);
//  - the drawn paint (material colours), every other finish of the green station and every material of every other theme are unchanged,
//    as is the albedo helper without the option (so no global lighting constant moves).

import {describe, expect, it} from 'vitest';
import {installCanvasShim} from './helpers/canvas2d';
import {fakeEnvTextures} from './helpers/openablesFixture';
import {STATION_THEMES} from '../src/gen/stationPlans';
import type {Area, StationIdentity, StationLayout} from '../src/gen/stationTypes';
import type {Level} from '../src/gen/levels';
import {WorldMaterials} from '../src/world/materials';
import {finishSchemeOf, type ArchZone, type FinishScheme, type ZoneFinish} from '../src/world/subwayFinish';
import {SubwayArch} from '../src/world/subwayArch';
import {SUBWAY_ARCH_KEYS, subwayArchAlbedo} from '../src/world/subwayArchTextures';
import {SUBWAY_ARCH_TEXTURES} from '../src/assets/subwayArchTextures.generated';

installCanvasShim(false);

type V3 = [number, number, number];
const ZONE_LIST: readonly ArchZone[] = ['plinth', 'dado', 'field', 'band', 'upper', 'ceil', 'floor', 'trim', 'struct', 'base', 'pier', 'accent', 'panel'];
const identity = (theme: string): StationIdentity => { const {label: _l, ...t} = STATION_THEMES[theme]; return {theme, ...t, plate: {...t.plate}}; };
const lum = (c: readonly number[]) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
const mats = () => new WorldMaterials(fakeEnvTextures(), 7, {w: 1.2, h: 0.19, d: 0.17});
const area = {id: 1, type: 'concourse', publicSpace: true, ceil: 4, x: 0, y: 0, w: 10, h: 10} as unknown as Area;
const hall = {id: 0, type: 'fare-hall', role: 'grand-ticket-hall', publicSpace: true, ceil: 9, x: 0, y: 0, w: 10, h: 10} as unknown as Area;
const layoutOf = (theme: string) => ({identity: identity(theme), areas: [hall, area], props: [], signs: [], lights: []} as unknown as StationLayout);

interface Mat { userData: Record<string, unknown>; color: {r: number; g: number; b: number} }
/** Every zone material a station of the theme draws: its key, its finish and the material. */
function zoneMaterials(theme: string): {key: string; finish: ZoneFinish; m: Mat}[] {
  const L = layoutOf(theme), arch = SubwayArch.for(L, mats(), [{} as Level])!;
  const out = new Map<string, {key: string; finish: ZoneFinish; m: Mat}>();
  const s = finishSchemeOf(L)!;
  for (const zone of ZONE_LIST) for (const a of [area, hall]) {
    const {key, finish} = arch.zoneFinish(zone, a);
    const m = arch.material(key) as unknown as Mat | undefined;
    if (m) out.set(key, {key, finish, m});
  }
  if (s.rock) for (const [key, finish] of [[arch.rockCeilKey(), s.rock.ceil], ['subway-rock-dado', s.rock.wall], ['subway-rock-struct', s.rock.wall]] as const) {
    const m = arch.material(key) as unknown as Mat | undefined;
    if (m) out.set(key, {key, finish, m});
  }
  return [...out.values()];
}
const same = (p: ZoneFinish, q: ZoneFinish) => p.tex === q.tex && String(p.tint) === String(q.tint);
const painted = (s: FinishScheme, f: ZoneFinish) => !!s.rock && (same(f, s.rock.wall) || same(f, s.rock.ceil));

describe('the green cavern bounce cast (render-only, cavernGreen only)', () => {
  it('only cavernGreen carries a bounce chroma; its drawn paint is the theme paint', () => {
    for (const theme of Object.keys(STATION_THEMES)) {
      const s = finishSchemeOf(layoutOf(theme))!;
      if (theme === 'cavernGreen') expect(s.rock?.bounceChroma, theme).toBe(0.4);
      else expect(s.rock?.bounceChroma, theme).toBeUndefined();
    }
    // the drawn paint stays the theme's own green (paintTint of its wall tint, unchanged)
    const g = finishSchemeOf(layoutOf('cavernGreen'))!;
    expect(g.rock!.wall.tex).toBe('rockPainted');
    expect(g.rock!.wall.tint![1]).toBeGreaterThan(g.rock!.wall.tint![0]);
  });

  it('green paint: light-bake albedo keeps its luminance at 0.4 of its chroma on every painted zone; drawn colours unchanged', () => {
    const s = finishSchemeOf(layoutOf('cavernGreen'))!;
    let paintedN = 0, otherN = 0;
    for (const {key, finish, m} of zoneMaterials('cavernGreen')) {
      const drawn = subwayArchAlbedo(finish.tex, finish.tint), got = m.userData.lightAlbedo as V3;
      if (painted(s, finish)) {
        expect(lum(got), key).toBeCloseTo(lum(drawn), 9);
        for (const [i, j] of [[1, 0], [1, 2], [0, 2]]) expect((got[i] - got[j]) / (drawn[i] - drawn[j]), key).toBeCloseTo(0.4, 9);
        paintedN++;
      } else { expect(got, key).toEqual(drawn); otherN++; }
    }
    // the rock walls and roof and the paint's field / upper / struct zones; granite / precast / enamel stay as drawn
    expect(paintedN).toBeGreaterThanOrEqual(4);
    expect(otherN).toBeGreaterThanOrEqual(4);
  });

  it('every other theme: every zone material bakes its finish as drawn (chroma 1)', () => {
    for (const theme of Object.keys(STATION_THEMES)) {
      if (theme === 'cavernGreen') continue;
      const ms = zoneMaterials(theme);
      expect(ms.length, theme).toBeGreaterThan(5);
      for (const {key, finish, m} of ms) expect(m.userData.lightAlbedo, `${theme} ${key}`).toEqual(subwayArchAlbedo(finish.tex, finish.tint));
    }
  });

  it('the drawn colour of a green painted material equals the other caverns\' recipe for its tint (colour untouched by the fix)', () => {
    const green = zoneMaterials('cavernGreen').find(e => e.key.startsWith('subway-rock-'))!;
    const s = finishSchemeOf(layoutOf('cavernGreen'))!;
    const t = green.finish.tint!;
    const c = green.m.color, mean = subwayArchAlbedo(green.finish.tex);
    const hasMap = green.m.userData.subwayArchSource !== null;
    const want = hasMap ? t : [0, 1, 2].map(i => mean[i] * t[i]);
    expect([c.r, c.g, c.b].map(v => +v.toFixed(5))).toEqual(want.map(v => +v.toFixed(5)));
    expect(painted(s, green.finish)).toBe(true);
  });

  it('the albedo helper is unchanged without the option (chroma 1 or absent)', () => {
    for (const key of SUBWAY_ARCH_KEYS) for (const t of [undefined, [1.1, 0.9, 0.8], [0.386, 0.694, 1.25], [1.25, 0.461, 0.293]] as (V3 | undefined)[]) {
      const m = SUBWAY_ARCH_TEXTURES[key].mean;
      const ref = [0, 1, 2].map(i => Math.min(0.8, m[i] * (t?.[i] ?? 1)));
      expect(subwayArchAlbedo(key, t, 1)).toEqual(subwayArchAlbedo(key, t));
      expect(subwayArchAlbedo(key, t).map(v => +v.toFixed(9))).toEqual(ref.map(v => +v.toFixed(9)));
    }
  });
});
